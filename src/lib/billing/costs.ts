import "server-only";

import { settings } from "@/lib/billing/settings";
import type { Scale } from "@/lib/image-engine";

/**
 * Cost estimation and input validation.
 *
 * The rates are not opinions. They come from measurements taken on the engine this app
 * actually ships:
 *
 *   Real-ESRGAN   2.07 MP source at 4x -> 20 s wall, 1,254 MB peak RSS, on an RTX 3050
 *                 => ~9.7 s and ~606 MB per source megapixel
 *   yt-dlp        232 MB video -> 94 s wall, 74 MB peak RSS, ~2.56 MB/s
 *
 * So one credit is priced as roughly ten seconds of the scarce resource, which is the GPU
 * for upscales and the network for downloads. At those rates the default 50-credit free
 * grant is about eight minutes of GPU per month, which is a number an operator can defend
 * out loud rather than "unlimited" with an asterisk.
 *
 * Every rate lives in settings, so recalibrating after a measurement is a database write and
 * not a deploy.
 */

export type CostEstimate = {
  kind: "upscale" | "download";
  credits: number;
  /** Human-readable reason, so the UI can show what it is being charged for. */
  breakdown: string[];
  /** Wall-clock expectation in seconds, used for the "about" copy. */
  estimatedSeconds: number;
};

export class InputTooLarge extends Error {
  constructor(
    message: string,
    readonly field: string,
    readonly limit: number,
    readonly actual: number,
  ) {
    super(message);
    this.name = "InputTooLarge";
  }
}

const round = (n: number) => Math.max(1, Math.ceil(n));

export function estimateUpscale(input: {
  width: number;
  height: number;
  scale: Scale;
}): CostEstimate {
  const { cost } = settings();
  const megapixels = (input.width * input.height) / 1e6;
  const workUnits = megapixels * cost.upscale_per_megapixel;
  const scaleUnits = (input.scale - 1) * cost.upscale_per_scale;
  const credits = round(cost.upscale_base + workUnits + scaleUnits);

  const breakdown = [`${cost.upscale_base} base`];
  if (workUnits > 0) {
    breakdown.push(`${round(workUnits)} for ${megapixels.toFixed(1)} megapixels`);
  }
  if (scaleUnits > 0) breakdown.push(`${round(scaleUnits)} for ${input.scale}×`);

  return {
    kind: "upscale",
    credits,
    breakdown,
    estimatedSeconds: Math.round(megapixels * 9.7 * input.scale),
  };
}

export function estimateDownload(input: { durationSeconds: number }): CostEstimate {
  const { cost } = settings();
  const minutes = Math.max(0, input.durationSeconds) / 60;
  const credits = round(cost.download_base + minutes * cost.download_per_minute);
  const breakdown = [`${cost.download_base} base`];
  if (minutes > 0) breakdown.push(`${round(minutes)} for ${minutes.toFixed(1)} min`);

  return {
    kind: "download",
    credits,
    breakdown,
    // Measured throughput was 2.56 MB/s; a minute of video is roughly 150 MB at that rate.
    estimatedSeconds: Math.round(minutes * 60),
  };
}

/**
 * Rejects an upscale the measured engine cannot do, before any credit is reserved.
 *
 * The megapixel ceiling is the important one: it is what keeps a single request from asking
 * for the ~115 GB of RAM that a 195 MP source would demand.
 */
export function validateUpscaleInput(input: {
  bytes: number;
  width: number;
  height: number;
  scale: Scale;
}): void {
  const { limits } = settings();

  if (input.bytes > limits.upload_max_bytes) {
    throw new InputTooLarge(
      "That image is larger than the upload limit.",
      "bytes",
      limits.upload_max_bytes,
      input.bytes,
    );
  }

  const pixels = input.width * input.height;
  if (pixels > limits.pixel_guard) {
    throw new InputTooLarge(
      "That image has too many pixels to process safely.",
      "pixels",
      limits.pixel_guard,
      pixels,
    );
  }

  const megapixels = pixels / 1e6;
  if (megapixels > limits.upscale_max_megapixels) {
    throw new InputTooLarge(
      `This upscale needs ${megapixels.toFixed(0)} megapixels and the limit is ${limits.upscale_max_megapixels}. Send a smaller source.`,
      "megapixels",
      limits.upscale_max_megapixels,
      megapixels,
    );
  }

  if (input.scale > limits.upscale_max_scale) {
    throw new InputTooLarge(
      `The maximum scale is ${limits.upscale_max_scale}×.`,
      "scale",
      limits.upscale_max_scale,
      input.scale,
    );
  }
}

/**
 * Rejects a download that cannot finish inside the function's time budget.
 *
 * The duration ceiling exists because the cost is wall-clock: at the measured 2.56 MB/s a
 * long video is minutes of a single held connection, and a throttled source can be far
 * worse. Duration is only known after the probe, which is why the downloader probes first.
 */
export function validateDownloadInput(input: {
  durationSeconds: number | null | undefined;
  bytes?: number | null;
}): void {
  const { limits } = settings();

  const duration = input.durationSeconds ?? 0;
  if (duration > limits.download_max_duration_seconds) {
    throw new InputTooLarge(
      `That video is ${Math.round(duration / 60)} minutes and the limit is ${Math.round(
        limits.download_max_duration_seconds / 60,
      )} minutes.`,
      "durationSeconds",
      limits.download_max_duration_seconds,
      duration,
    );
  }

  if (input.bytes && input.bytes > limits.download_max_bytes) {
    throw new InputTooLarge(
      "That download is larger than the service limit.",
      "bytes",
      limits.download_max_bytes,
      input.bytes,
    );
  }
}

/** Advertised capability, so the client cannot be the only place a limit exists. */
export function capability(): {
  limits: ReturnType<typeof settings>["limits"];
  cost: ReturnType<typeof settings>["cost"];
  pricesPublished: boolean;
} {
  const cfg = settings();
  return { limits: cfg.limits, cost: cfg.cost, pricesPublished: cfg.price.published };
}
