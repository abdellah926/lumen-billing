import "server-only";

import { db } from "@/lib/db";
import { settings } from "@/lib/billing/settings";
import type { PlanId } from "@/lib/billing/schema";

/**
 * Subscription state.
 *
 * Deliberately separate from credits: a plan changes what you get, credits are a
 * metered balance that spends down. Coupling them would make "I cancelled but I still have
 * 40 credits I paid for" impossible to represent.
 *
 * The one rule that shapes this whole file: cancellation never reduces a quota below what
 * is already stored. A user who downgrades keeps their files and loses the ability to add
 * new ones. Deleting a user's data to fit them into a smaller plan is not a billing
 * strategy, it is data loss with a receipt.
 */

export type Subscription = {
  user_id: string;
  plan: PlanId;
  status: "active" | "past_due" | "canceled";
  extra_storage_bytes: number;
  renews_at: string | null;
  current_period_end: string | null;
  cancel_at_period_end: number;
  created_at: string;
  updated_at: string;
};

const nowIso = () => new Date().toISOString();

/** Every user has a subscription row. Created lazily on first read so signup needs no change. */
export function ensureSubscription(userId: string): Subscription {
  const existing = db()
    .prepare(`SELECT * FROM subscriptions WHERE user_id = ?`)
    .get(userId) as Subscription | undefined;
  if (existing) return existing;

  const now = nowIso();
  db()
    .prepare(
      `INSERT INTO subscriptions (user_id, plan, status, extra_storage_bytes, renews_at, current_period_end, cancel_at_period_end, created_at, updated_at)
       VALUES (?, 'free', 'active', 0, NULL, NULL, 0, ?, ?)`,
    )
    .run(userId, now, now);

  return db().prepare(`SELECT * FROM subscriptions WHERE user_id = ?`).get(userId) as Subscription;
}

/**
 * The plan actually in force right now.
 *
 * A cancelled subscription keeps its paid plan until `current_period_end`, and a period
 * that has run out falls back to free. Purchased extra storage is never revoked here; only
 * the plan's base quota changes.
 */
export function effectivePlan(sub: Subscription): PlanId {
  const ended =
    sub.current_period_end !== null && sub.current_period_end <= nowIso();
  if (sub.status === "canceled" && ended) return "free";
  if (sub.plan === "pro" && ended) return "free";
  return sub.plan;
}

export type QuotaView = {
  plan: PlanId;
  /** True when a paid plan is still running out its period after cancellation. */
  graceUntil: string | null;
  /** plan base + purchased bytes. The number the UI shows as the ceiling. */
  quotaBytes: number;
  planBytes: number;
  extraBytes: number;
  cancelAtPeriodEnd: boolean;
  renewsAt: string | null;
  currentPeriodEnd: string | null;
};

export function quotaView(sub: Subscription): QuotaView {
  const cfg = settings();
  const plan = effectivePlan(sub);
  const planBytes = plan === "pro" ? cfg.plan.pro_storage_bytes : cfg.plan.free_storage_bytes;
  const expired = sub.current_period_end !== null && sub.current_period_end <= nowIso();
  const grace = expired ? null : sub.current_period_end;

  return {
    plan,
    graceUntil: sub.cancel_at_period_end ? grace : null,
    quotaBytes: planBytes + sub.extra_storage_bytes,
    planBytes,
    extraBytes: sub.extra_storage_bytes,
    cancelAtPeriodEnd: Boolean(sub.cancel_at_period_end),
    renewsAt: sub.status === "active" && !expired ? sub.renews_at : null,
    currentPeriodEnd: sub.current_period_end,
  };
}

/** Adds purchased storage. Survives cancellation on purpose. */
export function addStorageBytes(userId: string, bytes: number): void {
  if (bytes <= 0) throw new Error("Purchased storage must be positive");
  // Purchased bytes are deliberately not given an expiry. Storage someone paid for outliving
  // the subscription that bought it is the point: it is what makes cancelling an honest act
  // rather than a confiscation. A `periodDays` argument here would have been a lie, because
  // nothing would have decremented the column when the period passed.
  ensureSubscription(userId);
  db()
    .prepare(
      `UPDATE subscriptions
       SET extra_storage_bytes = extra_storage_bytes + ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(bytes, nowIso(), userId);
}

/**
 * Cancels. `atPeriodEnd` keeps the paid plan until the period runs out; otherwise the drop
 * is immediate. Neither path touches stored bytes.
 *
 * The plan column keeps its current value when cancelling at period end. Writing "canceled"
 * there would destroy the information `effectivePlan` needs to honour the grace period, and
 * would also store a value that is not a PlanId.
 */
export function cancelSubscription(userId: string, atPeriodEnd: boolean): Subscription {
  const sub = ensureSubscription(userId);
  const plan = atPeriodEnd ? sub.plan : "free";
  const end = atPeriodEnd ? sub.current_period_end : new Date().toISOString();

  db()
    .prepare(
      `UPDATE subscriptions
       SET plan = ?, status = 'canceled', cancel_at_period_end = ?, current_period_end = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(plan, atPeriodEnd ? 1 : 0, end, nowIso(), userId);

  return db().prepare(`SELECT * FROM subscriptions WHERE user_id = ?`).get(userId) as Subscription;
}

export function setPlan(userId: string, plan: PlanId, periodDays: number): Subscription {
  ensureSubscription(userId);
  const now = nowIso();
  const end = new Date(Date.now() + periodDays * 86_400_000).toISOString();
  db()
    .prepare(
      `UPDATE subscriptions
       SET plan = ?, status = 'active', cancel_at_period_end = 0,
           current_period_end = ?, renews_at = ?, updated_at = ?
       WHERE user_id = ?`,
    )
    .run(plan, end, end, now, userId);
  return db().prepare(`SELECT * FROM subscriptions WHERE user_id = ?`).get(userId) as Subscription;
}
