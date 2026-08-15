// Formats a past ISO timestamp as a short German relative label (e.g. "vor 3
// Tagen"), used anywhere an exact date is less useful than "how long ago".
export function formatRelativeTime(isoDate: string): string {
  const then = new Date(isoDate).getTime()
  const diffMs = Date.now() - then
  const diffMinutes = Math.floor(diffMs / 60000)

  if (diffMinutes < 1) return 'gerade eben'
  if (diffMinutes < 60) return `vor ${diffMinutes} Min.`

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `vor ${diffHours} Std.`

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays === 1) return 'gestern'
  if (diffDays < 7) return `vor ${diffDays} Tagen`

  const diffWeeks = Math.floor(diffDays / 7)
  if (diffWeeks < 5) return `vor ${diffWeeks} ${diffWeeks === 1 ? 'Woche' : 'Wochen'}`

  const diffMonths = Math.floor(diffDays / 30)
  if (diffMonths < 12) return `vor ${diffMonths} ${diffMonths === 1 ? 'Monat' : 'Monaten'}`

  const diffYears = Math.floor(diffDays / 365)
  return `vor ${diffYears} ${diffYears === 1 ? 'Jahr' : 'Jahren'}`
}
