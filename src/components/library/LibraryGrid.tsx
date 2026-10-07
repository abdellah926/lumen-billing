export type ViewItem = {
  id: string;
  kind: string;
  title: string;
  original_name: string;
  mime: string;
  bytes: number;
  width?: number | null;
  height?: number | null;
  duration?: number | null;
  created_at: string;
};

export type FolderCount = {
  kind: string;
  folder: string;
  label: string;
  count: number;
  bytes: number;
};

export function LibraryGrid({ items, folders }: { items: ViewItem[]; folders: FolderCount[] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
      {items.map((item) => (
        <div key={item.id} className="border-obsidian-700 bg-obsidian-900/80 rounded-[var(--radius-lg)] border p-4">
          <p className="truncate text-[15px] font-medium text-chalk">{item.title}</p>
          <p className="text-mist mt-1 text-[12px]">{item.kind}</p>
        </div>
      ))}
      {items.length === 0 && (
        <div className="border-obsidian-700 rounded-[var(--radius-lg)] border border-dashed p-6 text-sm text-mist">
          No files in this folder.
        </div>
      )}
      {folders.length > 0 && <div className="sr-only">{folders.length} folders</div>}
    </div>
  );
}
