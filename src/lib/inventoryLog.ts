import { supabase } from './supabase'
import type { Location } from '../types'

export type InventorySource = 'manual' | 'receipt' | 'photo' | 'shopping'

export interface InventoryLogEntry {
  id: string
  name: string
  category: string | null
  quantity: number | null
  unit: string | null
  location: Location
  source: InventorySource
  logged_at: string
}

export interface LogInventoryAdditionInput {
  name: string
  category: string | null
  quantity: number | null
  unit: string | null
  location: Location
  source: InventorySource
}

export async function logInventoryAddition(input: LogInventoryAdditionInput) {
  await supabase.from('inventory_log').insert(input)
}

export async function loadRecentInventoryLog(sinceIso: string): Promise<InventoryLogEntry[]> {
  const { data } = await supabase
    .from('inventory_log')
    .select('*')
    .gte('logged_at', sinceIso)
    .order('logged_at', { ascending: false })
  return data ?? []
}
