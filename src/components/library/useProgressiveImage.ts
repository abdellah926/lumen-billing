"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Streams an image into memory so the viewer can show real progress.
 *
 * A bare <img src> gives the browser no way to report how far along it is, so a
 * large original (hundreds of MB) looks like a frozen app. Reading the response
 * as a stream gives byte counts, and it also keeps the decoded full-size bitmap
 * out of the DOM until it is actually ready, which is what was exhausting memory.
 *
 * The fetch is aborted on unmount and whenever the id changes, so paging away
 * mid-download does not leave a request and its buffer running.
 */
export function useProgressiveImage(id: string | null, fullSrc: string) {
  const [state, setState] = useState<{
    url: string | null;
    loaded: number;
    total: number | null;
    done: boolean;
    error: boolean;
  }>({ url: null, loaded: 0, total: null, done: !id, error: false });

  // Object URLs are a real leak if they are not revoked, and this component
  // makes one per image, so they are tracked in a ref rather than in state.
  const urlRef = useRef<string | null>(null);

  useEffect(() => {
    if (urlRef.current) {
      URL.revokeObjectURL(urlRef.current);
      urlRef.current = null;
    }
    if (!id) return;

    const controller = new AbortController();

    (async () => {
      // The reset lives inside the async body so it is never a synchronous
      // setState in the effect, which is what would cause an extra render pass.
      setState({ url: null, loaded: 0, total: null, done: false, error: false });
      try {
        const res = await fetch(fullSrc, { signal: controller.signal });
        if (!res.ok || !res.body) throw new Error(String(res.status));

        // Content-Length is the truth for the percentage. If it is missing
        // (chunked, or a proxy stripped it) the bar falls back to an
        // indeterminate state rather than a fake number.
        const header = res.headers.get("content-length");
        const total = header ? Number.parseInt(header, 10) : null;

        const reader = res.body.getReader();
        let loaded = 0;
        // A 300 MB response can arrive in thousands of chunks. Re-rendering the
        // whole viewer for each one is what turned a slow load into a frozen
        // tab, so the byte counter is coalesced: the UI is repainted at most a
        // few times a second no matter how many chunks land.
        let lastPaint = 0;

        // One buffer is allocated up front from the known size and each chunk is
        // copied into it. Collecting chunks into an array and passing that to a
        // Blob instead makes the Blob copy the whole body a second time, and
        // that second copy is exactly where the delay after the final byte came
        // from. The chunk path stays as the fallback when there is no length.
        const buffer: Uint8Array | null = total !== null && total > 0 ? new Uint8Array(total) : null;
        const chunks: Uint8Array[] = buffer ? [] : [];

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          if (buffer) buffer.set(value, loaded);
          else chunks.push(value);
          loaded += value.byteLength;
          const now = performance.now();
          if (now - lastPaint > 120) {
            lastPaint = now;
            setState({ url: null, loaded, total, done: false, error: false });
          }
        }

        // A Blob over a typed array is a view on that memory, not another copy.
        const body: BlobPart = buffer
          ? (buffer.subarray(0, loaded) as BlobPart)
          : (chunks as unknown as BlobPart);
        const blob = new Blob([body]);
        const url = URL.createObjectURL(blob);
        urlRef.current = url;
        setState({ url, loaded: blob.size, total: blob.size, done: true, error: false });
      } catch (err) {
        if (controller.signal.aborted) return;
        setState({ url: null, loaded: 0, total: null, done: true, error: true });
      }
    })();

    return () => controller.abort();
  }, [id, fullSrc]);

  // Revoke the last URL when the component itself goes away.
  useEffect(
    () => () => {
      if (urlRef.current) URL.revokeObjectURL(urlRef.current);
    },
    [],
  );

  return state;
}
