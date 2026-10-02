import "server-only";

import { existsSync, mkdirSync, renameSync, unlinkSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { DATA_DIR } from "@/lib/paths";
import { absolutePathFor } from "@/lib/storage";
import type { LibraryItem } from "@/lib/db";

/**
 * Resized, cached copies of library images.
 *
 * A library can hold 200 tiles and the originals can be enormous: one of them is
 * a 325 MB PNG whose bitmap is larger than a gigabyte of RAM once decoded. So
 * every image is served as a WebP derivative instead — 400px for the grid and
 * filmstrip, 2560px for the viewer. The measured result on that 325 MB file is
 * 401 KB, about 850x smaller, and the viewer is indistinguishable on screen.
 *
 * Two things make that fast rather than merely smaller:
 *
 *  - Encoding one is not free. Decoding a 325 MB PNG costs about 2.6 seconds, and
 *    that is decode-bound, so no WebP setting makes it faster. The cost is
 *    therefore paid ahead of the click, not during it: `warmDerivatives` builds
 *    what a visitor is about to need as soon as the library page renders, and
 *    again the moment an image is archived.
 *
 *  - The result is cached on disk, not in memory. A page render and a route
 *    handler are separate module graphs, so an in-process cache would be filled
 *    by one and missed by the other. Files also survive a restart, so the first
 *    open after a deploy is as instant as the hundredth.
 */

export const THUMB_SIZE = 400;

/**
 * The viewer size. Covers a 4K screen at 1:1 for anything under about 270 DPI
 * while staying small enough to decode instantly.
 */
export const VIEW_SIZE = 2560;

const DERIV_DIR = path.join(DATA_DIR, "derivatives");

/** Keys currently being encoded, so concurrent asks share one encode. */
const inFlight = new Map<string, Promise<string>>();

/** WebP quality per size. 72 is plenty for a 400px tile; the viewer gets 90. */
function qualityFor(size: number) {
  return size === THUMB_SIZE ? 72 : 90;
}

/** Where a given (item, size) derivative lives. Stable, so it can be reused. */
export function derivativeFile(id: string, size: number): string {
  return path.join(DERIV_DIR, `${id}-${size}.webp`);
}

/** True if the derivative is already on disk, so a warm can skip the work. */
function isBuilt(id: string, size: number) {
  return existsSync(derivativeFile(id, size));
}

/**
 * Return the path to a derivative, building it first if it is not there yet.
 *
 * Concurrent callers asking for the same size share a single encode, so a grid of
 * tiles pointing at one image does not start that image's resize repeatedly.
 */
export function ensureDerivative(abs: string, id: string, size: number): Promise<string> {
  const file = derivativeFile(id, size);
  if (existsSync(file)) return Promise.resolve(file);

  const running = inFlight.get(file);
  if (running) return running;

  const job = (async () => {
    mkdirSync(DERIV_DIR, { recursive: true });

    const body = await sharp(abs, { failOn: "none" })
      // Fit inside the box without enlarging a small original, which would only
      // add bytes and blur. `inside` keeps the aspect ratio.
      .resize(size, size, { fit: "inside", withoutEnlargement: true })
      // effort 2 measured the same output size as effort 4 to within 0.01 MB and
      // is marginally quicker; the encode is decode-bound either way.
      .webp({ quality: qualityFor(size), effort: 2 })
      .toBuffer();

    // Written to a scratch name and then renamed, so a reader never sees a
    // half-written file and a crash mid-encode leaves nothing that looks valid.
    const scratch = `${file}.${process.pid}.tmp`;
    await writeFile(scratch, body);
    renameSync(scratch, file);
    return file;
  })().finally(() => inFlight.delete(file));

  inFlight.set(file, job);
  return job;
}

/** Delete every cached size for an item, so a delete frees its disk too. */
export function forgetDerivatives(id: string) {
  for (const size of [THUMB_SIZE, VIEW_SIZE]) {
    try {
      unlinkSync(derivativeFile(id, size));
    } catch {
      // Already gone, or never built. Either way there is nothing to release.
    }
  }
}

/**
 * Build the derivatives a visitor is about to need, in the background.
 *
 * Called without `await` on purpose: it must never delay the page it is called
 * from. Per item the thumbnail goes first, because the grid is what is on screen
 * while this runs, so a tile is ready before the larger viewer copy of the same
 * image. A failure on any one file is swallowed — a corrupt original must not take
 * down the library page or leave an unhandled rejection behind.
 */
export function warmDerivatives(items: LibraryItem[]) {
  for (const item of items) {
    if (item.kind !== "image" || !item.mime.startsWith("image/")) continue;
    for (const size of [THUMB_SIZE, VIEW_SIZE]) {
      if (isBuilt(item.id, size)) continue;
      const abs = absolutePathFor(item);
      void ensureDerivative(abs, item.id, size).catch(() => {
        /* the request path reports a real error if it is ever asked */
      });
    }
  }
}
