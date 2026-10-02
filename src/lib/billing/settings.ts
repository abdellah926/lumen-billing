import "server-only";

import { db } from "@/lib/db";

/**
 * Every quota, limit, credit rate and price lives in the `settings` table rather than in
 * code, because the numbers in this app are not known-good yet: they depend on measured
 * cost per operation on whatever host actually serves it. Hardcoding them would mean a
 * deploy per recalibration and, worse, would let a stale number sit in a pricing page.
 *
 * Every setting is optional in the row and defaulted here, so a fresh database and a
 * database that predates this module behave identically.
 *
 * Prices carry a `published` gate. Until an admin has confirmed measured costs and flipped
 * it, the pricing page renders limits and credit rates but never a currency amount.
 */

const MB = 1024 * 1024;
const GB = 1024 * MB;

export type Settings = {
  provider: {
    /** Display name of the object store. Null means "no durable store configured yet". */
    name: string | null;
    /**
     * The provider's total capacity, shared by every user. This is deliberately a single
     * number: granting each user a full provider quota is how a free tier dies on day one.
     * The admin view shows assigned-quota-versus-pool so over-assignment is visible.
     */
    pool_bytes: number;
    /** Uploads go browser-to-store, bypassing the function body limit. */
    direct_upload: boolean;
    /** Largest single upload the store accepts. Measured against the provider, not guessed. */
    max_object_bytes: number;
  };
  plan: {
    free_storage_bytes: number;
    pro_storage_bytes: number;
    /** Credits granted to a free account each period, and their expiry. */
    free_credits: number;
    free_credits_period_days: number;
    /** Pro includes this many credits per period. */
    pro_credits: number;
    pro_credits_period_days: number;
  };
  limits: {
    upload_max_bytes: number;
    /** Ceiling on source megapixels for an AI upscale, from measured GPU memory. */
    upscale_max_megapixels: number;
    upscale_max_scale: 2 | 3 | 4;
    /** Real-ESRGAN's own pixel guard, mirrored server-side so the client cannot exceed it. */
    pixel_guard: number;
    download_max_bytes: number;
    download_max_duration_seconds: number;
    /** Concurrent processing, global and per user. The GPU is a single device: global is 1. */
    max_concurrent_global: number;
    max_concurrent_per_user: number;
    /** A hold left behind by a dead process is reclaimed after this. */
    hold_ttl_seconds: number;
  };
  cost: {
    upscale_base: number;
    upscale_per_megapixel: number;
    upscale_per_scale: number;
    download_base: number;
    download_per_minute: number;
    download_per_megabyte: number;
  };
  price: {
    /** Master gate. While false, no currency amount is rendered anywhere. */
    published: boolean;
    storage_gb_month: number;
    storage_currency: string;
    credit_pack_credits: number;
    credit_pack_price: number;
    pro_month: number;
    currency: string;
  };
};

export const DEFAULT_SETTINGS: Settings = {
  provider: {
    name: null,
    pool_bytes: GB,
    direct_upload: true,
    max_object_bytes: 5 * GB,
  },
  plan: {
    free_storage_bytes: 500 * MB,
    pro_storage_bytes: 20 * GB,
    free_credits: 50,
    free_credits_period_days: 30,
    pro_credits: 500,
    pro_credits_period_days: 30,
  },
  limits: {
    // Matches the existing MAX_UPLOAD_BYTES in the image route.
    upload_max_bytes: 40 * MB,
    // Measured: Real-ESRGAN costs ~606 MB of RAM per source megapixel and ~10 s/MP on a
    // mid-range laptop GPU. At 40 MP that is ~24 GB of demand and ~6 min, which is the
    // point where a single shared GPU stops being a free operation.
    upscale_max_megapixels: 40,
    upscale_max_scale: 4,
    pixel_guard: 268_402_689,
    download_max_bytes: 2 * GB,
    download_max_duration_seconds: 3600,
    max_concurrent_global: 1,
    max_concurrent_per_user: 1,
    hold_ttl_seconds: 900,
  },
  cost: {
    upscale_base: 1,
    upscale_per_megapixel: 1,
    // 4x costs far more than 2x; the multiplier is derived, not linear.
    upscale_per_scale: 1,
    download_base: 1,
    download_per_minute: 1,
    download_per_megabyte: 0,
  },
  price: {
    published: false,
    storage_gb_month: 0,
    storage_currency: "USD",
    credit_pack_credits: 100,
    credit_pack_price: 0,
    pro_month: 0,
    currency: "USD",
  },
};

type Path = string;

function coerce<T>(raw: unknown, fallback: T): T {
  if (raw === null || raw === undefined) return fallback;
  if (typeof fallback === "number") {
    const n = typeof raw === "number" ? raw : Number(raw);
    return (Number.isFinite(n) ? n : fallback) as T;
  }
  if (typeof fallback === "boolean") return (Boolean(raw) as T);
  if (typeof fallback === "string") return (raw === null ? fallback : String(raw)) as T;
  return raw as T;
}

/**
 * Reads every key in one pass. The `settings` table is tiny and this runs per request, so a
 * single query beats thirty; a per-process cache would be wrong the moment an admin saves.
 */
export function settings(): Settings {
  const rows = db().prepare("SELECT key, value FROM settings").all() as {
    key: string;
    value: string;
  }[];
  const map = new Map<string, unknown>();
  for (const r of rows) {
    try {
      map.set(r.key, JSON.parse(r.value));
    } catch {
      /* skip unparseable rather than throw */
    }
  }
  const at = (path: Path) => map.get(path);
  const d = DEFAULT_SETTINGS;

  return {
    provider: {
      name: coerce(at("provider.name"), d.provider.name),
      pool_bytes: coerce(at("provider.pool_bytes"), d.provider.pool_bytes),
      direct_upload: coerce(at("provider.direct_upload"), d.provider.direct_upload),
      max_object_bytes: coerce(at("provider.max_object_bytes"), d.provider.max_object_bytes),
    },
    plan: {
      free_storage_bytes: coerce(at("plan.free_storage_bytes"), d.plan.free_storage_bytes),
      pro_storage_bytes: coerce(at("plan.pro_storage_bytes"), d.plan.pro_storage_bytes),
      free_credits: coerce(at("plan.free_credits"), d.plan.free_credits),
      free_credits_period_days: coerce(
        at("plan.free_credits_period_days"),
        d.plan.free_credits_period_days,
      ),
      pro_credits: coerce(at("plan.pro_credits"), d.plan.pro_credits),
      pro_credits_period_days: coerce(
        at("plan.pro_credits_period_days"),
        d.plan.pro_credits_period_days,
      ),
    },
    limits: {
      upload_max_bytes: coerce(at("limits.upload_max_bytes"), d.limits.upload_max_bytes),
      upscale_max_megapixels: coerce(
        at("limits.upscale_max_megapixels"),
        d.limits.upscale_max_megapixels,
      ),
      upscale_max_scale: coerce(at("limits.upscale_max_scale"), d.limits.upscale_max_scale),
      pixel_guard: coerce(at("limits.pixel_guard"), d.limits.pixel_guard),
      download_max_bytes: coerce(
        at("limits.download_max_bytes"),
        d.limits.download_max_bytes,
      ),
      download_max_duration_seconds: coerce(
        at("limits.download_max_duration_seconds"),
        d.limits.download_max_duration_seconds,
      ),
      max_concurrent_global: coerce(
        at("limits.max_concurrent_global"),
        d.limits.max_concurrent_global,
      ),
      max_concurrent_per_user: coerce(
        at("limits.max_concurrent_per_user"),
        d.limits.max_concurrent_per_user,
      ),
      hold_ttl_seconds: coerce(at("limits.hold_ttl_seconds"), d.limits.hold_ttl_seconds),
    },
    cost: {
      upscale_base: coerce(at("cost.upscale_base"), d.cost.upscale_base),
      upscale_per_megapixel: coerce(
        at("cost.upscale_per_megapixel"),
        d.cost.upscale_per_megapixel,
      ),
      upscale_per_scale: coerce(at("cost.upscale_per_scale"), d.cost.upscale_per_scale),
      download_base: coerce(at("cost.download_base"), d.cost.download_base),
      download_per_minute: coerce(
        at("cost.download_per_minute"),
        d.cost.download_per_minute,
      ),
      download_per_megabyte: coerce(
        at("cost.download_per_megabyte"),
        d.cost.download_per_megabyte,
      ),
    },
    price: {
      published: coerce(at("price.published"), d.price.published),
      storage_gb_month: coerce(at("price.storage_gb_month"), d.price.storage_gb_month),
      storage_currency: coerce(at("price.storage_currency"), d.price.storage_currency),
      credit_pack_credits: coerce(at("price.credit_pack_credits"), d.price.credit_pack_credits),
      credit_pack_price: coerce(at("price.credit_pack_price"), d.price.credit_pack_price),
      pro_month: coerce(at("price.pro_month"), d.price.pro_month),
      currency: coerce(at("price.currency"), d.price.currency),
    },
  };
}

const NUMERIC_MIN = 0;

/** Writes one setting. Values are stored as JSON so numbers survive a round trip. */
export function setSetting(key: string, value: unknown): void {
  if (typeof value === "number" && value < NUMERIC_MIN) {
    throw new Error(`${key} cannot be negative`);
  }
  db()
    .prepare(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, ?)
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
    )
    .run(key, JSON.stringify(value), new Date().toISOString());
}

/** Every key currently stored, for the admin screen. Unset keys fall back to defaults. */
export function settingsWithSources(): { current: Settings; keys: string[] } {
  const rows = db().prepare("SELECT key FROM settings ORDER BY key").all() as { key: string }[];
  return { current: settings(), keys: rows.map((r) => r.key) };
}

/** The default a key would have if it were cleared, so the admin form can show it. */
export function defaultFor(key: string): unknown {
  const flat = {
    "provider.name": DEFAULT_SETTINGS.provider.name,
    "provider.pool_bytes": DEFAULT_SETTINGS.provider.pool_bytes,
    "provider.direct_upload": DEFAULT_SETTINGS.provider.direct_upload,
    "provider.max_object_bytes": DEFAULT_SETTINGS.provider.max_object_bytes,
    "plan.free_storage_bytes": DEFAULT_SETTINGS.plan.free_storage_bytes,
    "plan.pro_storage_bytes": DEFAULT_SETTINGS.plan.pro_storage_bytes,
    "plan.free_credits": DEFAULT_SETTINGS.plan.free_credits,
    "plan.free_credits_period_days": DEFAULT_SETTINGS.plan.free_credits_period_days,
    "plan.pro_credits": DEFAULT_SETTINGS.plan.pro_credits,
    "plan.pro_credits_period_days": DEFAULT_SETTINGS.plan.pro_credits_period_days,
    "limits.upload_max_bytes": DEFAULT_SETTINGS.limits.upload_max_bytes,
    "limits.upscale_max_megapixels": DEFAULT_SETTINGS.limits.upscale_max_megapixels,
    "limits.upscale_max_scale": DEFAULT_SETTINGS.limits.upscale_max_scale,
    "limits.pixel_guard": DEFAULT_SETTINGS.limits.pixel_guard,
    "limits.download_max_bytes": DEFAULT_SETTINGS.limits.download_max_bytes,
    "limits.download_max_duration_seconds": DEFAULT_SETTINGS.limits.download_max_duration_seconds,
    "limits.max_concurrent_global": DEFAULT_SETTINGS.limits.max_concurrent_global,
    "limits.max_concurrent_per_user": DEFAULT_SETTINGS.limits.max_concurrent_per_user,
    "limits.hold_ttl_seconds": DEFAULT_SETTINGS.limits.hold_ttl_seconds,
    "cost.upscale_base": DEFAULT_SETTINGS.cost.upscale_base,
    "cost.upscale_per_megapixel": DEFAULT_SETTINGS.cost.upscale_per_megapixel,
    "cost.upscale_per_scale": DEFAULT_SETTINGS.cost.upscale_per_scale,
    "cost.download_base": DEFAULT_SETTINGS.cost.download_base,
    "cost.download_per_minute": DEFAULT_SETTINGS.cost.download_per_minute,
    "cost.download_per_megabyte": DEFAULT_SETTINGS.cost.download_per_megabyte,
    "price.published": DEFAULT_SETTINGS.price.published,
    "price.storage_gb_month": DEFAULT_SETTINGS.price.storage_gb_month,
    "price.storage_currency": DEFAULT_SETTINGS.price.storage_currency,
    "price.credit_pack_credits": DEFAULT_SETTINGS.price.credit_pack_credits,
    "price.credit_pack_price": DEFAULT_SETTINGS.price.credit_pack_price,
    "price.pro_month": DEFAULT_SETTINGS.price.pro_month,
    "price.currency": DEFAULT_SETTINGS.price.currency,
  } as Record<string, unknown>;
  return flat[key];
}
