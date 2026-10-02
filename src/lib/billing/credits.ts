import "server-only";

import { randomBytes } from "node:crypto";
import { db } from "@/lib/db";
import { settings } from "@/lib/billing/settings";
import type { CreditSource } from "@/lib/billing/schema";

/**
 * Processing credits.
 *
 * A credit is one unit of metered work: one AI upscale, one download. It is separate from
 * storage because both operations consume GPU and network time whether or not the user keeps
 * the result, so charging storage alone would let a free account spend the whole project's
 * compute for nothing.
 *
 * The model is a bucket list rather than a single balance:
 *
 *   balance = sum(granted - spent, unexpired) - sum(held)
 *
 * That buys two things one integer cannot express: a grant that expires on its own date
 * while a purchase grant still has months left, and a reservation that is provisional until
 * it is either spent once or released.
 *
 * Spending draws the earliest-expiring bucket first, so credits a user paid for are never
 * spent while credits that were about to expire sit untouched.
 */

export class InsufficientCredits extends Error {
  constructor(
    readonly required: number,
    readonly available: number,
  ) {
    super(
      available <= 0
        ? "You have no processing credits left. Add credits to keep going."
        : `That needs ${required} credits and you have ${available}.`,
    );
    this.name = "InsufficientCredits";
  }
}

/**
 * A programming error in the caller, not a user-facing billing state. Kept distinct from
 * InsufficientCredits so a malformed request can never be reported to a user as "you cannot
 * afford this", which would send them to buy credits for a bug.
 */
export class InvalidBillingRequest extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidBillingRequest";
  }
}

export type CreditBucket = {
  id: string;
  user_id: string;
  source: CreditSource;
  granted: number;
  spent: number;
  expires_at: string | null;
  created_at: string;
};

export type CreditSnapshot = {
  /** Spendable right now: unexpired grants minus live holds. */
  balance: number;
  /** Reserved by in-flight operations; already subtracted from balance. */
  held: number;
  lifetimeGranted: number;
  lifetimeSpent: number;
  buckets: (CreditBucket & { remaining: number; active: boolean })[];
  /** Soonest expiry among buckets that still hold a balance. */
  nextExpiry: string | null;
};

export type CreditHold = {
  id: string;
  user_id: string;
  job_id: string;
  amount: number;
  state: string;
  created_at: string;
  updated_at: string;
};

const id = (prefix: string) => `${prefix}_${randomBytes(12).toString("hex")}`;
const nowIso = () => new Date().toISOString();

/**
 * Unexpired buckets with a balance, soonest expiry first. A NULL expiry sorts last so a
 * never-expiring grant is only spent after everything expiring has been used.
 */
function activeBuckets(userId: string): CreditBucket[] {
  return db()
    .prepare(
      `SELECT * FROM credit_buckets
       WHERE user_id = ? AND spent < granted AND (expires_at IS NULL OR expires_at > ?)
       ORDER BY CASE WHEN expires_at IS NULL THEN 1 ELSE 0 END, expires_at ASC, created_at ASC`,
    )
    .all(userId, nowIso()) as CreditBucket[];
}

export function heldCredits(userId: string): number {
  const row = db()
    .prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM credit_holds WHERE user_id = ? AND state = 'held'`)
    .get(userId) as { n: number };
  return Number(row.n);
}

export function creditBalance(userId: string): number {
  let available = 0;
  for (const b of activeBuckets(userId)) available += b.granted - b.spent;
  return Math.max(0, available - heldCredits(userId));
}

export function creditSnapshot(userId: string): CreditSnapshot {
  const buckets = db()
    .prepare(`SELECT * FROM credit_buckets WHERE user_id = ? ORDER BY created_at ASC`)
    .all(userId) as CreditBucket[];
  const now = nowIso();

  let balance = 0;
  let lifetimeGranted = 0;
  let lifetimeSpent = 0;
  let nextExpiry: string | null = null;

  for (const b of buckets) {
    const remaining = b.granted - b.spent;
    lifetimeGranted += b.granted;
    lifetimeSpent += b.spent;
    const active = remaining > 0 && (b.expires_at === null || b.expires_at > now);
    if (!active) continue;
    balance += remaining;
    if (b.expires_at && (nextExpiry === null || b.expires_at < nextExpiry)) {
      nextExpiry = b.expires_at;
    }
  }

  return {
    balance: Math.max(0, balance - heldCredits(userId)),
    held: heldCredits(userId),
    lifetimeGranted,
    lifetimeSpent,
    nextExpiry,
    buckets: buckets.map((b) => ({
      ...b,
      remaining: b.granted - b.spent,
      active: b.granted - b.spent > 0 && (b.expires_at === null || b.expires_at > now),
    })),
  };
}

/**
 * Grants credits. Idempotent on `idempotencyKey`: a replayed purchase webhook inserts
 * nothing, because the ledger's UNIQUE constraint rejects the duplicate key.
 */
export function grantCredits(input: {
  userId: string;
  amount: number;
  source: CreditSource;
  expiresInDays?: number | null;
  reason: string;
  idempotencyKey: string;
}): { bucketId: string; granted: boolean } {
  if (input.amount <= 0) throw new Error("A credit grant must be positive");
  const conn = db();
  const bucketId = id("bkt");

  conn.exec("BEGIN IMMEDIATE");
  try {
    const seen = conn
      .prepare(`SELECT bucket_id FROM credit_ledger WHERE idempotency_key = ?`)
      .get(input.idempotencyKey) as { bucket_id: string } | undefined;
    if (seen) {
      conn.exec("COMMIT");
      return { bucketId: seen.bucket_id, granted: false };
    }

    const expiresAt =
      input.expiresInDays == null
        ? null
        : new Date(Date.now() + input.expiresInDays * 86_400_000).toISOString();

    conn
      .prepare(
        `INSERT INTO credit_buckets (id, user_id, source, granted, spent, expires_at, created_at)
         VALUES (?, ?, ?, ?, 0, ?, ?)`,
      )
      .run(bucketId, input.userId, input.source, input.amount, expiresAt, nowIso());

    conn
      .prepare(
        `INSERT INTO credit_ledger (id, user_id, bucket_id, job_id, delta, reason, idempotency_key, created_at)
         VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
      )
      .run(id("led"), input.userId, bucketId, input.amount, input.reason, input.idempotencyKey, nowIso());

    conn.exec("COMMIT");
    return { bucketId, granted: true };
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Reserves credits for a job. Idempotent per job: a second call with the same jobId
 * returns the existing hold rather than reserving twice, so a retried request cannot
 * double-charge before the first one has even finished.
 *
 * BEGIN IMMEDIATE takes the write lock up front, which is what makes the
 * balance-then-insert sequence safe against two concurrent requests both seeing the same
 * balance and both passing.
 */
export function reserveCredits(input: {
  userId: string;
  jobId: string;
  amount: number;
}): CreditHold {
  const { jobId, amount } = input;

  // job_id carries the UNIQUE index that makes this idempotent. An empty id would collide
  // with every other empty-id request and resolve to the existing no-op hold, letting work
  // start for free. Fail loudly instead.
  if (typeof jobId !== "string" || jobId.trim() === "") {
    throw new InvalidBillingRequest("a credit hold requires a job id");
  }
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new InvalidBillingRequest("a credit hold must be a positive whole number of credits");
  }

  const conn = db();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const existing = conn
      .prepare(`SELECT * FROM credit_holds WHERE job_id = ?`)
      .get(input.jobId) as CreditHold | undefined;
    if (existing) {
      conn.exec("COMMIT");
      return existing;
    }

    let available = 0;
    for (const b of activeBuckets(input.userId)) available += b.granted - b.spent;
    const alreadyHeld = Number(
      (
        conn
          .prepare(`SELECT COALESCE(SUM(amount), 0) AS n FROM credit_holds WHERE user_id = ? AND state = 'held'`)
          .get(input.userId) as { n: number }
      ).n,
    );
    const spendable = Math.max(0, available - alreadyHeld);

    if (input.amount > spendable) {
      conn.exec("ROLLBACK");
      throw new InsufficientCredits(input.amount, spendable);
    }

    const hold: CreditHold = {
      id: id("hld"),
      user_id: input.userId,
      job_id: input.jobId,
      amount: input.amount,
      state: "held",
      created_at: nowIso(),
      updated_at: nowIso(),
    };
    conn
      .prepare(
        `INSERT INTO credit_holds (id, user_id, job_id, amount, state, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'held', ?, ?)`,
      )
      .run(hold.id, hold.user_id, hold.job_id, hold.amount, hold.created_at, hold.updated_at);

    conn.exec("COMMIT");
    return hold;
  } catch (err) {
    try {
      conn.exec("ROLLBACK");
    } catch {
      /* already rolled back by the throw above */
    }
    throw err;
  }
}

/**
 * Turns a hold into a real charge, drawing down buckets earliest-expiry-first and writing
 * one ledger row per bucket touched. Idempotent: a hold that is no longer `held` is a
 * no-op, so a success callback replayed after a crash cannot spend twice.
 */
export function commitCredits(holdOrJobId: string): boolean {
  const conn = db();
  conn.exec("BEGIN IMMEDIATE");
  try {
    const hold = (
      holdOrJobId.startsWith("hld_")
        ? conn.prepare(`SELECT * FROM credit_holds WHERE id = ?`).get(holdOrJobId)
        : conn.prepare(`SELECT * FROM credit_holds WHERE job_id = ?`).get(holdOrJobId)
    ) as CreditHold | undefined;

    if (!hold || hold.state !== "held") {
      conn.exec("COMMIT");
      return false;
    }

    let remaining = hold.amount;
    for (const b of activeBuckets(hold.user_id)) {
      if (remaining <= 0) break;
      const available = b.granted - b.spent;
      const take = Math.min(available, remaining);
      if (take <= 0) continue;

      conn.prepare(`UPDATE credit_buckets SET spent = spent + ? WHERE id = ?`).run(take, b.id);
      conn
        .prepare(
          `INSERT INTO credit_ledger (id, user_id, bucket_id, job_id, delta, reason, idempotency_key, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          id("led"),
          hold.user_id,
          b.id,
          hold.job_id,
          -take,
          "processing",
          `job:${hold.job_id}:spend:${b.id}`,
          nowIso(),
        );
      remaining -= take;
    }

    // A shortfall here means buckets expired between reserve and commit. The hold still
    // settles, and the difference is recorded so the loss is visible rather than silent.
    if (remaining > 0) {
      conn
        .prepare(
          `INSERT INTO credit_ledger (id, user_id, bucket_id, job_id, delta, reason, idempotency_key, created_at)
           VALUES (?, ?, NULL, ?, ?, ?, ?, ?)`,
        )
        .run(
          id("led"),
          hold.user_id,
          hold.job_id,
          0,
          `shortfall:${remaining}`,
          `job:${hold.job_id}:shortfall`,
          nowIso(),
        );
    }

    conn
      .prepare(`UPDATE credit_holds SET state = 'committed', updated_at = ? WHERE id = ?`)
      .run(nowIso(), hold.id);
    conn.exec("COMMIT");
    return true;
  } catch (err) {
    conn.exec("ROLLBACK");
    throw err;
  }
}

/**
 * Releases a hold without spending it. This is the refund path: the work failed, or the
 * result was discarded, and the user's balance must be whole again. No ledger row is
 * written because no credit actually moved; the hold row's state is the record.
 */
export function releaseCredits(holdOrJobId: string): boolean {
  const conn = db();
  const hold = (
    holdOrJobId.startsWith("hld_")
      ? conn.prepare(`SELECT * FROM credit_holds WHERE id = ?`).get(holdOrJobId)
      : conn.prepare(`SELECT * FROM credit_holds WHERE job_id = ?`).get(holdOrJobId)
  ) as CreditHold | undefined;
  if (!hold || hold.state !== "held") return false;
  conn
    .prepare(`UPDATE credit_holds SET state = 'released', updated_at = ? WHERE id = ?`)
    .run(nowIso(), hold.id);
  return true;
}

/**
 * Grants the periodic free allowance, at most once per period.
 *
 * The idempotency key is derived from the user and the period boundary rather than a random
 * value, so calling this on every page load is free: only the first call of each period can
 * match, and every later one collides on the ledger's UNIQUE constraint.
 */
export function ensurePeriodGrant(userId: string, plan: "free" | "pro"): void {
  const cfg = settings();
  const amount = plan === "pro" ? cfg.plan.pro_credits : cfg.plan.free_credits;
  const days = plan === "pro" ? cfg.plan.pro_credits_period_days : cfg.plan.free_credits_period_days;
  if (amount <= 0) return;

  const since = new Date(Date.now() - days * 86_400_000);
  const period = Math.floor(since.getTime() / (days * 86_400_000));
  grantCredits({
    userId,
    amount,
    source: "free_grant",
    expiresInDays: days,
    reason: `free_allowance:${plan}`,
    idempotencyKey: `grant:${userId}:${plan}:${period}`,
  });
}

/**
 * Reclaims holds left behind by a process that died mid-operation. Called before any balance
 * is read, so a crashed request cannot strand a user's credits forever.
 */
export function sweepStaleHolds(ttlSeconds: number): number {
  const cutoff = new Date(Date.now() - ttlSeconds * 1000).toISOString();
  const conn = db();
  const res = conn
    .prepare(
      `UPDATE credit_holds SET state = 'released', updated_at = ?
       WHERE state = 'held' AND created_at < ?`,
    )
    .run(nowIso(), cutoff);
  return Number(res.changes);
}
