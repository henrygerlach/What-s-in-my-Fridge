export interface ParsedDecimal {
  // The parsed number, or null when the input was blank (i.e. "not provided").
  value: number | null
  // False when the input was non-blank but still not a valid number — the
  // caller should flag this rather than silently save it as empty.
  valid: boolean
}

// Accepts both "." and "," as the decimal separator — many keyboards default
// to comma — and normalizes to a plain float. A blank input is valid (means
// "no quantity given"); anything else that doesn't parse is flagged invalid
// instead of silently becoming null.
export function parseDecimal(input: string): ParsedDecimal {
  const trimmed = input.trim()
  if (!trimmed) return { value: null, valid: true }

  const normalized = trimmed.replace(',', '.')
  const parsed = Number(normalized)
  return isNaN(parsed) ? { value: null, valid: false } : { value: parsed, valid: true }
}
