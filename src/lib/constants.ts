import type { Location } from '../types'

export const LOCATION_LABELS: Record<Location, string> = {
  fridge: 'Kühlschrank',
  pantry: 'Vorrat',
  freezer: 'Gefrierfach',
}

export const LOCATION_OPTIONS: Array<{ value: Location; label: string }> = [
  { value: 'fridge', label: LOCATION_LABELS.fridge },
  { value: 'pantry', label: LOCATION_LABELS.pantry },
  { value: 'freezer', label: LOCATION_LABELS.freezer },
]

// The cold chain, ambient to deep freeze. Storage location is the one item
// property that never changes while an item sits there, so it earns a
// permanent colour instead of a word repeated on every row.
export const LOCATION_DOT_CLASS: Record<Location, string> = {
  pantry: 'bg-pantry',
  fridge: 'bg-fridge',
  freezer: 'bg-freezer',
}

export const CATEGORY_OPTIONS = [
  'Obst & Gemüse',
  'Milchprodukte & Eier',
  'Fleisch & Fisch',
  'Brot & Backwaren',
  'Getränke',
  'Tiefkühl',
  'Konserven & Grundnahrungsmittel',
  'Gewürze & Saucen',
  'Süßigkeiten & Snacks',
  'Sonstiges',
]

// No EL/TL: those get converted to their ml equivalent instead, so every
// unit here is an exact, unambiguous measurement.
export const UNIT_OPTIONS = ['Stück', 'g', 'kg', 'ml', 'l', 'Packung', 'Dose', 'Glas', 'Bund', 'Prise']

// Units without a fixed weight (unlike g/kg/ml/l, which are exact
// measurements). A can of tomatoes and a can of coconut milk don't weigh
// the same, so items using these can optionally record a grams-per-unit
// factor to make them comparable to weight-based stock/recipes.
export const CONTAINER_UNITS = ['Stück', 'Packung', 'Dose', 'Glas', 'Bund', 'Prise']

export const RECIPE_CATEGORY_OPTIONS = ['Frühstück', 'Große Mahlzeit', 'Snack']

export const CATEGORY_ICONS: Record<string, string> = {
  'Obst & Gemüse': '🥦',
  'Milchprodukte & Eier': '🥛',
  'Fleisch & Fisch': '🥩',
  'Brot & Backwaren': '🍞',
  Getränke: '🥤',
  Tiefkühl: '🧊',
  'Konserven & Grundnahrungsmittel': '🥫',
  'Gewürze & Saucen': '🧂',
  'Süßigkeiten & Snacks': '🍬',
  Sonstiges: '📦',
}

export const RECIPE_CATEGORY_ICONS: Record<string, string> = {
  Frühstück: '🍳',
  'Große Mahlzeit': '🍲',
  Snack: '🍿',
}

export const UNCATEGORIZED_ICON = '🗂️'

// Predefined recipe tags, grouped by facet. Groups with multi: false behave
// like a radio group (picking one option replaces any other tag from that
// same group), multi: true groups behave like checkboxes.
export interface TagGroup {
  label: string
  multi: boolean
  options: string[]
}

export const TAG_GROUPS: TagGroup[] = [
  { label: 'Art', multi: false, options: ['Fleisch', 'Fisch', 'Vegetarisch', 'Vegan'] },
  { label: 'Zubereitungszeit', multi: false, options: ['< 10 Min.', '10–20 Min.', '20–40 Min.', '> 40 Min.'] },
  {
    label: 'Eigenschaften',
    multi: true,
    options: ['Günstig', 'Kinderfreundlich', 'Meal Prep', 'Resteverwertung', 'Scharf'],
  },
]

const CATEGORY_KEYWORDS: Array<[string, string]> = [
  ['milch', 'Milchprodukte & Eier'],
  ['dairy', 'Milchprodukte & Eier'],
  ['eier', 'Milchprodukte & Eier'],
  ['egg', 'Milchprodukte & Eier'],
  ['fleisch', 'Fleisch & Fisch'],
  ['meat', 'Fleisch & Fisch'],
  ['fisch', 'Fleisch & Fisch'],
  ['fish', 'Fleisch & Fisch'],
  ['brot', 'Brot & Backwaren'],
  ['bread', 'Brot & Backwaren'],
  ['bakery', 'Brot & Backwaren'],
  ['getränk', 'Getränke'],
  ['beverage', 'Getränke'],
  ['drink', 'Getränke'],
  ['tiefkühl', 'Tiefkühl'],
  ['frozen', 'Tiefkühl'],
  ['konserve', 'Konserven & Grundnahrungsmittel'],
  ['canned', 'Konserven & Grundnahrungsmittel'],
  ['gewürz', 'Gewürze & Saucen'],
  ['spice', 'Gewürze & Saucen'],
  ['sauce', 'Gewürze & Saucen'],
  ['süß', 'Süßigkeiten & Snacks'],
  ['sweet', 'Süßigkeiten & Snacks'],
  ['snack', 'Süßigkeiten & Snacks'],
  ['obst', 'Obst & Gemüse'],
  ['fruit', 'Obst & Gemüse'],
  ['gemüse', 'Obst & Gemüse'],
  ['vegetable', 'Obst & Gemüse'],
]

export function guessCategory(rawCategory: string): string {
  const lower = rawCategory.toLowerCase()
  const match = CATEGORY_KEYWORDS.find(([keyword]) => lower.includes(keyword))
  return match ? match[1] : ''
}
