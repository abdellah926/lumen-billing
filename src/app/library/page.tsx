import Link from "next/link";
import { redirect } from "next/navigation";
import { Coins, HardDrive, LogOut, Sparkles } from "lucide-react";
import { currentUser } from "@/lib/auth";
import { logoutAction } from "@/lib/actions/auth";
import {
  FOLDER_KIND,
  FOLDER_LABEL,
  FOLDER_ORDER,
  listLibrary,
  libraryStats,
  type Folder,
} from "@/lib/db";
import { pageMetadata } from "@/lib/seo";
import { warmDerivatives } from "@/lib/derivatives";
import { formatBytes } from "@/lib/utils";
import { storageSnapshot } from "@/lib/billing/quota";
import { creditSnapshot } from "@/lib/billing/credits";
import { Button, ButtonLink, Card } from "@/components/ui/Button";
import { LibraryGrid, type FolderCount, type ViewItem } from "@/components/library/LibraryGrid";
import { WelcomeNote } from "@/components/library/WelcomeNote";
import { UsageStrip } from "@/components/billing/UsageStrip";

export const metadata = pageMetadata({
  title: "Your Library",
  description: "Every image, video, and file you have generated or downloaded, filed automatically.",
  path: "/library",
  noIndex: true,
});

export default async function LibraryPage({
  searchParams,
}: {
  searchParams: Promise<{ welcome?: string }>;
}) {
  const user = await currentUser();
  if (!user) redirect("/login?next=/library");

  const { welcome } = await searchParams;

  const items = listLibrary(user.id, { limit: 200 });
  const stats = libraryStats(user.id);

  // The library already knows its own byte total, but the quota ceiling lives in billing, and
  // the two must be read from the same place the tools read or the strip becomes a guess.
  const billing = storageSnapshot(user.id);
  const credits = creditSnapshot(user.id);

  // Start building the resized copies now, without awaiting. Decoding a large
  // original costs a couple of seconds, so doing it here means it is already in
  // memory by the time someone clicks a tile and the viewer opens at once. The
  // page itself does not wait on any of it.
  warmDerivatives(items);

  const folders: FolderCount[] = FOLDER_ORDER.map((folder: Folder) => ({
    kind: FOLDER_KIND[folder],
    folder,
    label: FOLDER_LABEL[folder],
    count: stats.byFolder[folder]?.count ?? 0,
    bytes: stats.byFolder[folder]?.bytes ?? 0,
  }));

  const view: ViewItem[] = items.map((i) => ({
    id: i.id,
    kind: i.kind,
    title: i.title,
    original_name: i.original_name,
    mime: i.mime,
    bytes: i.bytes,
    width: i.width,
    height: i.height,
    duration: i.duration,
    created_at: i.created_at,
  }));

  return (
    <div className="mx-auto max-w-[1240px] px-5 pt-12 pb-20 sm:px-8">
      {welcome === "1" && <WelcomeNote />}

      <UsageStrip
        usedBytes={stats.bytes}
        remainingBytes={billing.remainingBytes}
        quotaBytes={billing.quotaBytes}
        overByBytes={billing.overByBytes}
        credits={credits.balance}
        canUpload={billing.canUpload}
      />

      {/* header */}
      <div className="flex flex-wrap items-end justify-between gap-6">
        <div className="min-w-0">
          <h1 className="text-h1 font-bold">Your library</h1>
          <p className="text-mist mt-2.5 text-[15px]">
            Signed in as <span className="text-chalk">{user.email}</span>
          </p>
        </div>

        <div className="flex items-center gap-2.5">
          <ButtonLink href="/library/billing" tier="secondary" size="sm">
            <Coins className="size-4" />
            Usage
          </ButtonLink>
          <ButtonLink href="/upscaler" tier="primary" size="sm">
            <Sparkles className="size-4" />
            New upscale
          </ButtonLink>
          <form action={logoutAction}>
            <Button type="submit" tier="ghost" size="sm">
              <LogOut className="size-4" />
              Sign out
            </Button>
          </form>
        </div>
      </div>

      {/* storage summary */}
      {stats.total > 0 && (
        <div className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {folders
            .filter((f) => f.count > 0)
            .map((f) => (
              <Card key={f.folder} className="px-5 py-4">
                <p className="text-mono-caps text-slate">{f.label}</p>
                <p className="font-display text-acid-500 mt-2 text-2xl font-bold tabular-nums">
                  {f.count}
                </p>
                <p className="text-slate mt-1 text-[12px]">{formatBytes(f.bytes)}</p>
              </Card>
            ))}
          <Card className="px-5 py-4">
            <p className="text-mono-caps text-slate">Total</p>
            <p className="font-display text-chalk mt-2 text-2xl font-bold tabular-nums">
              {formatBytes(stats.bytes)}
            </p>
            <p className="text-slate mt-1 flex items-center gap-1.5 text-[12px]">
              <HardDrive className="size-3" />
              on this machine
            </p>
          </Card>
        </div>
      )}

      {/* grid */}
      <div className="mt-10">
        {stats.total === 0 ? (
          <div className="border-obsidian-700 rounded-[var(--radius-lg)] border border-dashed p-14 text-center">
            <h2 className="font-display text-xl font-semibold">Nothing filed yet</h2>
            <p className="text-mist mx-auto mt-3 max-w-md text-[15px] leading-relaxed">
              Turn on &ldquo;save to my library&rdquo; in either tool and every result lands
              here automatically, filed by type. No downloads folder required.
            </p>
            <div className="mt-7 flex flex-wrap justify-center gap-2.5">
              <ButtonLink href="/upscaler" tier="primary">
                Upscale something
              </ButtonLink>
              <ButtonLink href="/downloader" tier="secondary">
                Download media
              </ButtonLink>
            </div>
          </div>
        ) : (
          <LibraryGrid items={view} folders={folders} />
        )}
      </div>

      <p className="text-slate mt-12 text-[12px] leading-relaxed">
        Files live in <code className="text-mist">storage/{user.id.slice(0, 8)}/</code> on this
        machine. Deleting an item removes the file, not just the row.{" "}
        <Link href="/privacy" className="text-mist underline">
          How this is stored
        </Link>
        .
      </p>
    </div>
  );
}
