import { isMatch } from './matching'

interface IngredientLike {
  name: string
  quantity: number | null
  unit: string | null
  grams_per_unit?: number | null
}

const WEIGHT_TO_GRAMS: Record<string, number> = { g: 1, kg: 1000 }
const VOLUME_TO_ML: Record<string, number> = { ml: 1, l: 1000 }

// Converts a quantity to grams: directly for g/kg, or via a per-item
// grams-per-unit factor for container units like Dose/Packung/Stück (e.g.
// "2 Dose" with grams_per_unit 400 -> 800g). Returns null when neither is
// available, i.e. the weight of this quantity is genuinely unknown.
function toGrams(quantity: number, unit: string | null, gramsPerUnit: number | null | undefined): number | null {
  if (unit && unit in WEIGHT_TO_GRAMS) return quantity * WEIGHT_TO_GRAMS[unit]
  if (gramsPerUnit != null) return quantity * gramsPerUnit
  return null
}

export function toComparableQuantity(
  quantity: number,
  fromUnit: string | null,
  toUnit: string | null,
  fromGramsPerUnit?: number | null,
  toGramsPerUnit?: number | null,
): number | null {
  if (fromUnit === toUnit) return quantity

  if (fromUnit && toUnit) {
    if (fromUnit in WEIGHT_TO_GRAMS && toUnit in WEIGHT_TO_GRAMS) {
      return (quantity * WEIGHT_TO_GRAMS[fromUnit]) / WEIGHT_TO_GRAMS[toUnit]
    }
    if (fromUnit in VOLUME_TO_ML && toUnit in VOLUME_TO_ML) {
      return (quantity * VOLUME_TO_ML[fromUnit]) / VOLUME_TO_ML[toUnit]
    }
  }

  // Fall back to grams as a pivot unit, using a per-item grams-per-unit
  // factor on whichever side isn't already a plain weight unit. This is
  // what lets e.g. "1 Dose" (400g) and "400 g" be compared, or even "1
  // Dose" and "1 Packung" once both have a factor recorded.
  const grams = toGrams(quantity, fromUnit, fromGramsPerUnit)
  if (grams == null) return null

  if (toUnit && toUnit in WEIGHT_TO_GRAMS) return grams / WEIGHT_TO_GRAMS[toUnit]
  if (toGramsPerUnit != null) return grams / toGramsPerUnit
  return null
}

// An ingredient counts as available only if enough of it is in stock for the
// quantity requested (the recipe's defined amount, or a locally scaled
// amount for a chosen portion count). Falls back to simple presence when
// quantities or units can't be meaningfully compared (e.g. one side has no
// quantity recorded, or the units are incompatible like "Stück" vs "g").
// Generic over the stock source: works for food_items in the fridge just as
// well as entries already on the shopping list.
export function isIngredientAvailable(ingredient: IngredientLike, stock: IngredientLike[]): boolean {
  const matches = stock.filter((item) => isMatch(ingredient.name, item.name))
  if (matches.length === 0) return false
  if (ingredient.quantity == null) return true

  let total = 0
  let hasComparableStock = false
  for (const item of matches) {
    if (item.quantity == null) continue
    const comparable = toComparableQuantity(
      item.quantity,
      item.unit,
      ingredient.unit,
      item.grams_per_unit,
      ingredient.grams_per_unit,
    )
    if (comparable == null) continue
    total += comparable
    hasComparableStock = true
  }

  if (!hasComparableStock) return true
  return total >= ingredient.quantity
}

export function getMissingIngredients<T extends IngredientLike>(ingredients: T[], stock: IngredientLike[]): T[] {
  return ingredients.filter((ingredient) => !isIngredientAvailable(ingredient, stock))
}

interface StockItem extends IngredientLike {
  id: string
}

export interface StockUpdate {
  id: string
  quantity: number
}

// Computes how much to deduct from each matching food item to cover the given
// ingredient amounts, converting between compatible units (g/kg, ml/l) the
// same way isIngredientAvailable does, and drawing down multiple matches in
// order until each ingredient's amount is covered. Ingredients with no
// quantity, or matches with no comparable quantity, are left untouched since
// there's nothing well-defined to subtract. A resulting quantity <= 0 means
// the item is fully used up — the caller should delete that row.
export function computeStockDeductions(ingredients: IngredientLike[], foodItems: StockItem[]): StockUpdate[] {
  const remaining = new Map(foodItems.map((item) => [item.id, item.quantity]))

  for (const ingredient of ingredients) {
    if (ingredient.quantity == null) continue
    let needed = ingredient.quantity

    const matches = foodItems.filter((item) => isMatch(ingredient.name, item.name))
    for (const item of matches) {
      if (needed <= 0.0001) break
      const currentQuantity = remaining.get(item.id)
      if (currentQuantity == null || currentQuantity <= 0) continue

      const availableInIngredientUnit = toComparableQuantity(
        currentQuantity,
        item.unit,
        ingredient.unit,
        item.grams_per_unit,
        ingredient.grams_per_unit,
      )
      if (availableInIngredientUnit == null) continue

      const takeInIngredientUnit = Math.min(availableInIngredientUnit, needed)
      const takeInItemUnit =
        toComparableQuantity(
          takeInIngredientUnit,
          ingredient.unit,
          item.unit,
          ingredient.grams_per_unit,
          item.grams_per_unit,
        ) ?? 0

      remaining.set(item.id, currentQuantity - takeInItemUnit)
      needed -= takeInIngredientUnit
    }
  }

  const updates: StockUpdate[] = []
  for (const item of foodItems) {
    const newQuantity = remaining.get(item.id)
    if (newQuantity != null && newQuantity !== item.quantity) {
      updates.push({ id: item.id, quantity: Math.round(newQuantity * 100) / 100 })
    }
  }
  return updates
}
