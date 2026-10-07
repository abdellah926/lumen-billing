export type PlanId = "free" | "pro";
export type CreditSource = "welcome" | "purchase" | "admin" | "system" | "free_grant";
export type SubscriptionState = "active" | "trial" | "cancelled";

export type QuotaView = {
  userId: string;
  plan: PlanId;
  quotaBytes: number;
  credits: number;
  active: boolean;
};

export function migrateBilling(db: { exec: (sql: string) => void }) {
  db.exec(`CREATE TABLE IF NOT EXISTS billing_settings (id TEXT PRIMARY KEY);`);
}
