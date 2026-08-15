// Groups items by category, ordering groups by their position in
// categoryOrder (rather than alphabetically) and keeping each group's
// existing relative order (stable sort) so callers can pre-sort within
// a category before grouping.
export function groupByCategory<T>(
  items: T[],
  getCategory: (item: T) => string | null,
  categoryOrder: string[],
  uncategorizedLabel = 'Ohne Kategorie',
): Array<[string, T[]]> {
  function rank(category: string | null): number {
    if (!category) return categoryOrder.length
    const index = categoryOrder.indexOf(category)
    return index === -1 ? categoryOrder.length : index
  }

  const sorted = [...items].sort((a, b) => rank(getCategory(a)) - rank(getCategory(b)))

  const groups = new Map<string, T[]>()
  for (const item of sorted) {
    const label = getCategory(item) || uncategorizedLabel
    const list = groups.get(label) ?? []
    list.push(item)
    groups.set(label, list)
  }

  return [...groups.entries()]
}
