// Maps the current time of day to the recipe category that's most relevant
// right now, so the "what can I cook" widget defaults to something you'd
// actually eat at that hour instead of a random mix.
export function currentMealCategory(date: Date = new Date()): string {
  const hour = date.getHours()
  if (hour < 11) return 'Frühstück'
  return 'Große Mahlzeit'
}

export const MEAL_CATEGORY_LABELS: Record<string, string> = {
  Frühstück: 'Frühstücksideen',
  'Große Mahlzeit': 'Was koche ich heute?',
}
