"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, Download, Film, Music, X } from "lucide-react";
import { cn, formatBytes, formatDuration, formatRelativeTime, resolutionLabel } from "@/lib/utils";
import type { ViewItem } from "@/components/library/LibraryGrid";
import { useProgressiveImage } from "@/components/library/useProgressiveImage";
import { ThemeToggle } from "@/components/ThemeToggle";

/**
 * Full-screen viewer for a single library item.
 *
 * Mounted only while an item is open, so it holds no open/closed state of its
 * own. The origin rectangle is read from the thumbnail that was clicked, which
 * lets the image grow out of exactly where the pointer left it instead of
 * fading in from the centre.
 */
export function Lightbox({
  items,
  index,
  onClose,
  onIndexChange,
}: {
  items: ViewItem[];
  index: number;
  onClose: () => void;
  onIndexChange: (next: number) => void;
}) {
  const item = items[index];
  const stageRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const restoreRef = useRef<Element | null>(null);

  const open = items.length > 0 && index >= 0 && index < items.length;

  const go = useCallback(
    (delta: number) => {
      if (!open) return;
      onIndexChange((index + delta + items.length) % items.length);
    },
    [index, items.length, onIndexChange, open],
  );

  // Remember what had focus, lock the page scroll, and move focus into the
  // dialog so Tab and Escape both land where the user expects.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();

    return () => {
      document.body.style.overflow = previousOverflow;
      if (restoreRef.current instanceof HTMLElement) restoreRef.current.focus();
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      switch (e.key) {
        case "Escape":
          e.preventDefault();
          onClose();
          break;
        case "ArrowRight":
          e.preventDefault();
          go(1);
          break;
        case "ArrowLeft":
          e.preventDefault();
          go(-1);
          break;
        case "Tab": {
          // Trap the tab ring inside the dialog.
          const focusables = stageRef.current?.querySelectorAll<HTMLElement>(
            'button, a[href], [tabindex]:not([tabindex="-1"])',
          );
          if (!focusables || focusables.length === 0) return;
          const first = focusables[0];
          const last = focusables[focusables.length - 1];
          if (e.shiftKey && document.activeElement === first) {
            e.preventDefault();
            last.focus();
          } else if (!e.shiftKey && document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
          break;
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, onClose, open]);

  if (!open || !item) return null;

  const src = `/api/library/${item.id}`;

  // Only a window of thumbnails is mounted. Rendering the whole library meant
  // every image in it was fetched and decoded the moment the viewer opened,
  // which is what made opening an item slow and memory-hungry on a full library.
  const STRIP = 7;
  const HALF = 3;
  const from = Math.max(0, Math.min(index - HALF, items.length - STRIP));
  const strip = items.slice(from, from + STRIP).map((item, i) => ({ item, offset: from + i }));

  return (
    <div
      ref={stageRef}
      role="dialog"
      aria-modal="true"
      aria-label={item.title}
      className="fixed inset-0 z-[90] flex flex-col"
      onClick={onClose}
    >
      {/* Scrim. Kept separate from the panel so clicking the backdrop closes
          while clicking the content does not. */}
      <div className="bg-obsidian-950/92 absolute inset-0 backdrop-blur-md" />

      {/* top bar */}
      <div
        className="relative z-10 flex items-start gap-4 px-4 py-3 sm:px-6 sm:py-4"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="min-w-0 flex-1 pt-1">
          <p className="truncate text-[15px] font-semibold text-chalk" title={item.title}>
            {item.title}
          </p>
          <p className="text-mist mt-1 text-[12px]">
            {item.width && item.height ? resolutionLabel(item.width, item.height) : item.kind}
            {" · "}
            {formatBytes(item.bytes)}
            {item.duration ? ` · ${formatDuration(item.duration)}` : ""}
            {" · "}
            {formatRelativeTime(item.created_at)}
          </p>
        </div>

        <a
          href={`${src}?dl=1`}
          aria-label={`Download ${item.title}`}
          className="text-mist hover:bg-obsidian-800 hover:text-chalk grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] transition-colors"
        >
          <Download className="size-[18px]" />
        </a>

        {/* The site header sits at z-50 and this dialog is z-90, so the header's
            own theme switch is unreachable while the viewer is open. Repeating it
            here keeps that control working exactly where the visitor expects it. */}
        <ThemeToggle className="shrink-0" />

        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          aria-label="Close viewer"
          className="text-mist hover:bg-obsidian-800 hover:text-chalk grid size-10 shrink-0 place-items-center rounded-[var(--radius-sm)] transition-colors"
        >
          <X className="size-5" />
        </button>
      </div>

      {/* stage */}
      <div
        className="relative z-10 flex min-h-0 flex-1 items-center justify-center px-4 pb-4 sm:px-6"
        onClick={(e) => e.stopPropagation()}
      >
        {items.length > 1 && (
          <button
            type="button"
            onClick={() => go(-1)}
            aria-label="Previous item"
            className="text-mist hover:text-chalk border-obsidian-700 bg-obsidian-900/80 absolute left-2 z-20 grid size-11 place-items-center rounded-full border backdrop-blur-sm transition-colors sm:left-4"
          >
            <ChevronLeft className="size-6" />
          </button>
        )}

        <div
          key={item.id}
          className="animate-lightbox-in flex max-h-full w-full items-center justify-center"
        >
          {item.kind === "image" ? (
            // key on the id so moving to the next item remounts this and drops
            // the "show me the original" choice, without an effect that would
            // have to setState after the item is already on screen.
            <ProgressiveImage key={item.id} item={item} />
          ) : item.kind === "video" ? (
            <video
              src={src}
              controls
              autoPlay
              playsInline
              className="max-h-[calc(100dvh-11rem)] max-w-full rounded-[var(--radius-md)]"
            />
          ) : item.kind === "audio" ? (
            <div className="border-obsidian-700 bg-obsidian-900 w-full max-w-md rounded-[var(--radius-lg)] border p-6">
              <Music className="text-slate mb-4 size-8" />
              <p className="truncate text-[14px] font-medium text-chalk">{item.title}</p>
              <audio src={src} controls autoPlay className="mt-4 w-full" />
            </div>
          ) : null}
        </div>

        {items.length > 1 && (
          <button
            type="button"
            onClick={() => go(1)}
            aria-label="Next item"
            className="text-mist hover:text-chalk border-obsidian-700 bg-obsidian-900/80 absolute right-2 z-20 grid size-11 place-items-center rounded-full border backdrop-blur-sm transition-colors sm:right-4"
          >
            <ChevronRight className="size-6" />
          </button>
        )}
      </div>

      {/* filmstrip */}
      {items.length > 1 && (
        <div
          className="relative z-10 flex shrink-0 gap-2 overflow-x-auto px-4 pb-4 sm:px-6"
          onClick={(e) => e.stopPropagation()}
        >
          {strip.map((thumb) => {
            const i = index + thumb.offset;
            return (
              <button
                key={thumb.item.id}
                type="button"
                onClick={() => onIndexChange(i)}
                aria-label={thumb.item.title}
                aria-current={i === index}
                className={cn(
                  "relative size-14 shrink-0 overflow-hidden rounded-[var(--radius-sm)] border transition-all duration-150",
                  i === index
                    ? "border-acid-500 ring-acid-500/40 scale-105 ring-2"
                    : "border-obsidian-700 opacity-55 hover:opacity-100",
                )}
              >
                {thumb.item.kind === "image" ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={`/api/library/${thumb.item.id}?thumb=1`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="size-full object-cover"
                  />
                ) : (
                  <span className="bg-obsidian-800 text-mist grid size-full place-items-center">
                    {thumb.item.kind === "video" ? (
                      <Film className="size-4" />
                    ) : (
                      <Music className="size-4" />
                    )}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/**
 * The image half of the viewer.
 *
 * The original is never fetched on open. The server keeps a 2560px WebP of every
 * image, which for a 325 MB upscale measures 401 KB — about 850x smaller — and it
 * is already built in the background by the time the page is interactive, so the
 * picture is simply there. It is handed to a plain <img> rather than fetched
 * through JavaScript: at that size a progress bar would be noise, and letting the
 * browser stream and cache it directly is both faster and less code.
 *
 * "Full resolution" is a separate, deliberate act. That path does fetch through
 * the hook, because a 325 MB download genuinely needs a byte counter and an abort.
 */
function ProgressiveImage({ item }: { item: ViewItem }) {
  const [wantOriginal, setWantOriginal] = useState(false);

  const viewSrc = `/api/library/${item.id}?view=1`;
  const originalSrc = `/api/library/${item.id}`;

  // Hook order is fixed, so the hook is always called and simply stays idle until
  // the original is asked for.
  const { url, loaded, total, done, error } = useProgressiveImage(
    wantOriginal && item.kind === "image" ? `${item.id}:orig` : null,
    originalSrc,
  );

  const percent = total ? Math.min(100, Math.round((loaded / total) * 100)) : null;
  const thumbSrc = `/api/library/${item.id}?thumb=1`;

  return (
    // position:relative so the bar can sit ON the image rather than under it.
    // As a sibling it reserved its own height, which is what left a visible
    // gap between the picture and the filmstrip while loading.
    <div className="relative flex max-h-full w-full flex-col items-center justify-center gap-3">
      <div className="relative flex max-h-full w-full items-center justify-center">
        {wantOriginal ? (
          // The real original, mounted only once every byte is here, so the
          // browser never decodes a half-received 325 MB buffer.
          done && url && !error ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={item.title}
              className="animate-fade-in max-h-[calc(100dvh-11rem)] max-w-full rounded-[var(--radius-md)] object-contain"
            />
          ) : (
            <div className="relative">
              {/* Blurred thumbnail standing in. Upscaled and softened, it reads as
                  a deliberate placeholder rather than a broken image. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={thumbSrc}
                alt=""
                aria-hidden="true"
                className={cn(
                  "max-h-[calc(100dvh-11rem)] max-w-full scale-[1.04] rounded-[var(--radius-md)] object-contain blur-xl",
                  done && error ? "opacity-40" : "animate-pulse opacity-60",
                )}
              />
            </div>
          )
        ) : (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={viewSrc}
            alt={item.title}
            className="animate-fade-in max-h-[calc(100dvh-11rem)] max-w-full rounded-[var(--radius-md)] object-contain"
          />
        )}

        {/* The bar, only for the original download. Absolutely positioned over the
            bottom of the image so it takes no vertical space and the layout never
            shifts under it. */}
        {wantOriginal && (!done || error) && (
          <div className="bg-obsidian-950/70 absolute inset-x-0 bottom-0 z-10 rounded-b-[var(--radius-md)] px-4 py-3 backdrop-blur-sm">
            <div className="bg-obsidian-800 h-1 w-full overflow-hidden rounded-full">
              {percent !== null ? (
                <div
                  className="bg-acid-500 h-full rounded-full transition-[width] duration-150 ease-out"
                  style={{ width: `${Math.max(2, percent)}%` }}
                />
              ) : (
                <div className="bg-acid-500/70 h-full w-1/3 animate-[loading-sweep_1.1s_ease-in-out_infinite] rounded-full" />
              )}
            </div>
            <p className="text-mist mt-2 text-center text-[12px] tabular-nums">
              {error ? (
                "Could not load the original"
              ) : total !== null ? (
                <>
                  Loading full resolution · {percent}%
                  <span className="ml-1.5">
                    ({formatBytes(loaded)} of {formatBytes(total)})
                  </span>
                </>
              ) : (
                "Loading full resolution…"
              )}
            </p>
          </div>
        )}
      </div>

      {/* Original download. Offered quietly under the image: a 300 MB fetch is
          a deliberate act, not the default way to look at a picture. */}
      {!wantOriginal && (
        <button
          type="button"
          onClick={() => setWantOriginal(true)}
          className="text-slate hover:text-chalk shrink-0 text-[12px] transition-colors"
        >
          Full resolution ({formatBytes(item.bytes)})
        </button>
      )}
    </div>
  );
}
