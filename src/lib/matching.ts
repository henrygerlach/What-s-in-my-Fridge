function normalize(value: string): string {
  return value.toLowerCase().trim().replace(/\s+/g, ' ')
}

function singularize(value: string): string {
  return value.replace(/(en|er|e|n|s)$/, '')
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Plain .includes() would match "Milch" inside "Kokosmilch" — a different
// product fused into one compound word. Only count a substring match when it
// occurs at a word boundary (e.g. "Paprika" inside "rote Paprika"), not
// merely as a run of characters inside another word.
function containsWord(haystack: string, needle: string): boolean {
  if (!needle) return false
  const pattern = new RegExp(`(?:^|\\s)${escapeRegExp(needle)}(?:$|\\s)`)
  return pattern.test(haystack)
}

export function isMatch(ingredientName: string, foodItemName: string): boolean {
  const a = normalize(ingredientName)
  const b = normalize(foodItemName)
  if (!a || !b) return false
  if (a === b || containsWord(a, b) || containsWord(b, a)) return true

  const as = singularize(a)
  const bs = singularize(b)
  return as === bs || containsWord(as, bs) || containsWord(bs, as)
}
