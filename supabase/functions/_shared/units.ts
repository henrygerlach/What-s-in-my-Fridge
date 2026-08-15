// Mirrors src/lib/constants.ts UNIT_OPTIONS. Deno edge functions can't import
// from src, so this is intentionally kept in sync by hand.
// No EL/TL: those get converted to their ml equivalent instead, so every unit
// here is an exact, unambiguous measurement.
export const UNIT_OPTIONS = ['Stück', 'g', 'kg', 'ml', 'l', 'Packung', 'Dose', 'Glas', 'Bund', 'Prise']

// Mirrors src/lib/constants.ts CONTAINER_UNITS — units without a fixed
// weight, where a grams_per_unit estimate is meaningful.
export const CONTAINER_UNITS = ['Stück', 'Packung', 'Dose', 'Glas', 'Bund', 'Prise']

export const UNIT_CONVERSION_PROMPT = `Falls eine Zutat in Esslöffeln (EL), Teelöffeln (TL) oder Tassen angegeben ist, rechne sie stattdessen in ml um (1 EL ≈ 15 ml, 1 TL ≈ 5 ml, 1 Tasse ≈ 240 ml). Verwende für "unit" ausschließlich einen dieser Werte oder null: ${UNIT_OPTIONS.map((u) => `"${u}"`).join(', ')}.`

// Container units like Dose/Packung/Glas/Stück/Bund have no fixed weight —
// this asks the LLM to estimate one anyway from general product knowledge
// (e.g. a can of tomatoes ≈ 400g), so stock matching can later compare
// "1 Dose" against a recipe or fridge entry given in g/kg without the user
// having to type the conversion in by hand. The user still sees and can
// correct the value in the form before saving.
export const GRAMS_PER_UNIT_PROMPT = `Falls "unit" einer dieser Werte ist: ${CONTAINER_UNITS.map((u) => `"${u}"`).join(', ')} — schätze zusätzlich "grams_per_unit": das typische Gewicht in Gramm für eine Einheit dieses konkreten Produkts (z. B. bei "Dose" Kokosmilch ca. 400, bei "Stück" Ei ca. 60), als Zahl. Falls keine plausible Schätzung möglich ist, oder "unit" bereits g, kg, ml oder l ist, setze "grams_per_unit" auf null.`

export function normalizeUnit(unit: string | null | undefined): string | null {
  return unit && UNIT_OPTIONS.includes(unit) ? unit : null
}

export function normalizeGramsPerUnit(value: unknown): number | null {
  return typeof value === 'number' && value > 0 ? value : null
}
