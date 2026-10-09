/** Build each navigation target from explicit filters so cleared values cannot leak back in. */
export function registerHref(base: string, filters: { tab?: string; search?: string; after?: string | null } = {}): string {
  const query = new URLSearchParams();
  if (filters.tab) query.set("tab", filters.tab);
  if (filters.search) query.set("search", filters.search);
  if (filters.after) query.set("after", filters.after);
  return `${base}${query.size ? `?${query}` : ""}`;
}
