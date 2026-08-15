import { supabase } from './supabase'
import { isMatch } from './matching'
import type { StapleItem } from '../types'

export async function getStapleItems(): Promise<StapleItem[]> {
  const { data } = await supabase.from('staple_items').select('*').order('name', { ascending: true })
  return data ?? []
}

export async function addStapleItem(name: string) {
  const trimmed = name.trim()
  if (!trimmed) return
  const current = await getStapleItems()
  const exists = current.some((staple) => staple.name.toLowerCase() === trimmed.toLowerCase())
  if (exists) return
  await supabase.from('staple_items').insert({ name: trimmed })
}

export async function removeStapleItem(id: string) {
  await supabase.from('staple_items').delete().eq('id', id)
}

// A staple counts as missing once nothing in stock matches its name and it
// isn't already on the shopping list — no quantity threshold, since staples
// are about "do we have any at all", not "do we have enough".
export function getMissingStaples<T extends { name: string }>(
  staples: StapleItem[],
  foodItems: T[],
  shoppingList: T[],
): StapleItem[] {
  return staples.filter(
    (staple) =>
      !foodItems.some((item) => isMatch(staple.name, item.name)) &&
      !shoppingList.some((item) => isMatch(staple.name, item.name)),
  )
}
