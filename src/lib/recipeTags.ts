import { supabase } from './supabase'

// Guesses recipe tags from just the title via the LLM — best-effort, so a
// network/parsing failure just yields no suggestions rather than blocking
// anything.
export async function guessRecipeTags(title: string): Promise<string[]> {
  const trimmed = title.trim()
  if (!trimmed) return []

  const { data, error } = await supabase.functions.invoke('guess-recipe-tags', { body: { title: trimmed } })
  if (error || !Array.isArray(data?.tags)) return []
  return data.tags
}
