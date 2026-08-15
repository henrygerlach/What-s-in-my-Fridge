// Claude sometimes wraps JSON replies in a markdown code fence even when asked
// not to; strip that before parsing.
export function extractJson(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  return (fenced ? fenced[1] : text).trim()
}
