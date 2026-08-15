// AI-generated instructions are often numbered ("1. ... 2. ...") but written
// as one continuous string with no real line breaks. Split on real newlines
// first (manually typed recipes), and fall back to splitting before each
// numbered step so both render as a proper step list.
export function splitInstructionSteps(text: string): string[] {
  const trimmed = text.trim()
  if (!trimmed) return []

  const byNewline = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
  if (byNewline.length > 1) return byNewline

  const byNumber = trimmed
    .split(/(?=\d+\.\s)/)
    .map((step) => step.trim())
    .filter(Boolean)
  if (byNumber.length > 1) return byNumber

  return [trimmed]
}
