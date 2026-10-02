import "server-only";

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { settings } from "@/lib/billing/settings";
import { ensureSubscription, quotaView, type QuotaView } from "@/lib/billing/subscriptions";

/**
 * Storage accounting.
 *
 * `SUM(library_items.bytes)` is the truth about what is stored, and it stays that way: no
 * counter column to drift, no reconciliation job. What it cannot answer on its own is "is
 * there room right now", because between two requests the number is stale.
 *
 * So reservations sit on top of it. An upload reserves its bytes before writing, which
 * closes the window where two concurrent uploads each read the pre-upload total and each
 * decide there is room. A reservation is committed (bytes became a real row) or released
 * (the request died) — never silently dropped.
 *
 * The provider's free allowance is a single shared pool, tracked separately from every user
 * quota. Handing each user the full provider quota is how a free tier dies on its first busy
 * day, so `poolSnapshot` exists to make over-assignment visible before it bites.
 */

export class StorageQuotaExceeded extends Error {
  constructor(
    readonly required: number,
    readonly available: number,
    readonly quotaBytes: number,
    readonly usedBytes: number,
  ) {
    super(
      available <= 0
        ? "Your library is full. Delete a file or add storage to keep going."
        : `That needs ${required} more bytes and you have ${available} free.`,
    );
    this.name = "StorageQuotaExceeded";
  }
}

/**
 * A programming error in the caller, not a user-facing billing state. Kept distinct from
 * StorageQuotaExceeded so a malformed request is never shown to a user as "your library is
 * full", which would point them at the wrong problem.
 */
export class InvalidStorageRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidStorageRequest";
  }
}

/** What a reservation returns: the handle to release or settle, plus the claimed size. */
export type StorageReservation = {
  id: string;
  bytes: number;
  expiresAt: string;
};

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;
const nowIso = () => new Date().toISOString();

/** Bytes actually stored, counted by the library table rather than a cached total. */
export function storedBytes(userId: string): number {
  const row = db()
    .prepare(`SELECT COALESCE(SUM(bytes), 0) AS n FROM library_items WHERE user_id = ?`)
    .get(userId) as { n: number };
  return Number(row.n);
}

export function reservedBytes(userId: string): number {
  const row = db()
    .prepare(
      `SELECT COALESCE(SUM(bytes), 0) AS n FROM storage_reservations WHERE user_id = ? AND state = 'held'`,
    )
    .get(userId) as { n: number };
  return Number(row.n);
}

export type StorageSnapshot = QuotaView & {
  usedBytes: number;
  heldBytes: number;
  /** Used plus in-flight reservations: what the quota is actually measured against. */
  committedBytes: number;
  remainingBytes: number;
  /** How far past the quota the account already is. Only ever positive after a downgrade. */
  overByBytes: number;
  /**
   * False when the account is already over quota. The user keeps viewing, downloading and
   * deleting; only new uploads stop.
   */
  canUpload: boolean;
};

export function storageSnapshot(userId: string): StorageSnapshot {
  const sub = ensureSubscription(userId);
  const view = quotaView(sub);
  const used = storedBytes(userId);
  const held = reservedBytes(userId);
  const committedBytes = used + held;
  const remaining = view.quotaBytes - committedBytes;

  return {
    ...view,
    usedBytes: used,
    heldBytes: held,
    committedBytes,
    remainingBytes: remaining,
    overByBytes: remaining < 0 ? -remaining : 0,
    canUpload: remaining > 0,
  };
}

/**
 * Claims room for an upload. Idempotent per jobId, and it takes the write lock before
 * reading, so the check and the claim cannot be interleaved by another request.
 */
export function reserveStorage(input: {
  userId: string;
  bytes: number;
  jobId: string;
  ttlSeconds?: number;
}): StorageReservation {
  const { bytes, jobId } = input;

  // job_id carries the UNIQUE index that makes this idempotent, and a request that reuses a
  // job id returns the first reservation instead of claiming more space. An empty id would
  // therefore collide with every other empty-id request and silently resolve to a no-op,
  // reporting success while nothing was reserved. Fail loudly instead.
  if (typeof jobId !== "string" || jobId.trim() === "") {
    throw new InvalidStorageRequest("a storage reservation requires a job id");
  }
  if (!Number.isSafeInteger(bytes) || bytes <= 0) {
    throw new InvalidStorageRequest("a storage reservation must be a positive whole number of bytes");
  }

  const cfg = settings();
  const ttl = input.ttlSeconds ?? cfg.limits.hold_ttl_seconds;
  const conn = db();

  conn.exec("BEGIN IMMEDIATE");
  try {
    // A replay returns the original claim, including its expiry, rather than a fresh window:
    // retrying a request must not silently extend how long the space stays held.
    const existing = conn
      .prepare(`SELECT id, bytes, expires_at AS expiresAt FROM storage_reservations WHERE job_id = ?`)
      .get(jobId) as StorageReservation | undefined;
    if (existing) {
      conn.exec("COMMIT");
      return existing;
    }

    const sub = ensureSubscription(input.userId);
    const quota = quotaView(sub).quotaBytes;

    const used = Number(
      (conn.prepare(`SELECT COALESCE(SUM(bytes), 0) AS n FROM library_items WHERE user_id = ?`).get(input.userId) as { n: number }).n,
    );
    const held = Number(
      (conn.prepare(`SELECT COALESCE(SUM(bytes), 0) AS n FROM storage_reservations WHERE user_id = ? AND state = 'held'`).get(input.userId) as { n: number }).n,
    );
    const available = quota - used - held;

    // Reclaim reservations abandoned by a process that died before releasing them.
    conn
      .prepare(
        `UPDATE storage_reservations SET state = 'released'
         WHERE state = 'held' AND expires_at < ?`,
      )
      .run(nowIso());

    if (input.bytes > available) {
      conn.exec("ROLLBACK");
      throw new StorageQuotaExceeded(input.bytes, Math.max(0, available), quota, used);
    }

    const reservation = {
      id: id("srs"),
      bytes: input.bytes,
      expiresAt: new Date(Date.now() + ttl * 1000).toISOString(),
    };
    conn
      .prepare(
        `INSERT INTO storage_reservations (id, user_id, job_id, bytes, state, created_at, expires_at)
         VALUES (?, ?, ?, ?, 'held', ?, ?)`,
      )
      .run(
        reservation.id,
        input.userId,
        input.jobId,
        reservation.bytes,
        nowIso(),
        reservation.expiresAt,
      );

    conn.exec("COMMIT");
    return reservation;
  } catch (err) {
    try {
      conn.exec("ROLLBACK");
    } catch {
      /* already rolled back */
    }
    throw err;
  }
}

/**
 * Settles a reservation after the upload outcome is known. `committed` means the bytes are
 * now a real library row, so the reservation is retired and the table becomes the only
 * record. Both branches are idempotent.
 */
export function settleStorage(holdOrJobId: string, committed: boolean): boolean {
  const conn = db();
  const row = (
    holdOrJobId.startsWith("srs_")
      ? conn.prepare(`SELECT id FROM storage_reservations WHERE id = ?`).get(holdOrJobId)
      : conn.prepare(`SELECT id FROM storage_reservations WHERE job_id = ?`).get(holdOrJobId)
  ) as { id: string } | undefined;
  if (!row) return false;

  const res = conn
    .prepare(`UPDATE storage_reservations SET state = ? WHERE id = ? AND state = 'held'`)
    .run(committed ? "committed" : "released", row.id);
  return Number(res.changes) > 0;
}

export type PoolSnapshot = {
  providerName: string | null;
  poolBytes: number;
  /** Sum of every account's ceiling. May exceed the pool; that is the warning. */
  assignedBytes: number;
  usedBytes: number;
  availableBytes: number;
  overAssigned: boolean;
  userCount: number;
  /** How many accounts have paid storage attached. */
  payingUsers: number;
};

export function poolSnapshot(): PoolSnapshot {
  const cfg = settings();
  const used = Number(
    (db().prepare(`SELECT COALESCE(SUM(bytes), 0) AS n FROM library_items`).get() as { n: number }).n,
  );
  const users = Number(
    (db().prepare(`SELECT COUNT(*) AS n FROM users`).get() as { n: number }).n,
  );
  const paying = Number(
    (
      db()
        .prepare(`SELECT COUNT(*) AS n FROM subscriptions WHERE extra_storage_bytes > 0`)
        .get() as { n: number }
    ).n,
  );
  const assigned = Number(
    (
      db()
        .prepare(
          `SELECT COALESCE(SUM(CASE WHEN plan = 'pro' THEN ? ELSE ? END + extra_storage_bytes), 0) AS n FROM subscriptions`,
        )
        .get(cfg.plan.pro_storage_bytes, cfg.plan.free_storage_bytes) as { n: number }
    ).n,
  );

  return {
    providerName: cfg.provider.name,
    poolBytes: cfg.provider.pool_bytes,
    assignedBytes: assigned,
    usedBytes: used,
    availableBytes: Math.max(0, cfg.provider.pool_bytes - used),
    overAssigned: assigned > cfg.provider.pool_bytes,
    userCount: users,
    payingUsers: paying,
  };
}
