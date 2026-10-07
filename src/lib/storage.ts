export function absolutePathFor(item: { stored_name?: string; id?: string; original_name?: string }) {
  return item.stored_name ?? item.original_name ?? item.id ?? "";
}
