export function pageMetadata(input: {
  title?: string;
  description?: string;
  path?: string;
  noIndex?: boolean;
  keywords?: string[];
}) {
  return {
    title: input.title ?? "Lumen",
    description: input.description ?? "Lumen media tools",
    alternates: input.path ? { canonical: input.path } : undefined,
    robots: input.noIndex ? { index: false, follow: false } : undefined,
    keywords: input.keywords ?? [],
  };
}
