import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/ToastContext'
import { isIngredientAvailable } from '../lib/stock'
import PageHeader from '../components/PageHeader'
import AvailabilityMeter from '../components/AvailabilityMeter'
import type { FoodItem } from '../types'

interface SuggestedIngredient {
  name: string
  quantity: number | null
  unit: string | null
}

interface Suggestion {
  title: string
  category: string | null
  portions: number | null
  description: string
  instructions: string
  ingredients: SuggestedIngredient[]
}

export default function SuggestRecipe() {
  const [prompt, setPrompt] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [suggestions, setSuggestions] = useState<Suggestion[]>([])
  const [foodItems, setFoodItems] = useState<FoodItem[]>([])
  const [savingIndex, setSavingIndex] = useState<number | null>(null)
  const navigate = useNavigate()
  const showToast = useToast()

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!prompt.trim()) return
    setLoading(true)
    setError(null)

    const { data: items, error: fetchError } = await supabase.from('food_items').select('*')
    if (fetchError) {
      setError('Inventar konnte nicht geladen werden.')
      setLoading(false)
      return
    }

    setFoodItems(items ?? [])
    const inventory = (items ?? []).map((item) => ({ name: item.name, quantity: item.quantity, unit: item.unit }))

    const { data, error: invokeError } = await supabase.functions.invoke('suggest-recipes', {
      body: { inventory, prompt: prompt.trim() },
    })

    setLoading(false)
    if (invokeError || !data?.suggestions) {
      setError('Rezeptvorschläge konnten nicht geladen werden.')
      return
    }
    setSuggestions(data.suggestions)
  }

  async function handleCreate(suggestion: Suggestion, index: number) {
    setSavingIndex(index)

    const { data: recipe, error } = await supabase
      .from('recipes')
      .insert({
        title: suggestion.title,
        instructions: suggestion.instructions,
        category: suggestion.category,
        portions: suggestion.portions,
        photo_url: null,
      })
      .select()
      .single()

    if (error || !recipe) {
      setSavingIndex(null)
      showToast('Fehler beim Speichern')
      return
    }

    if (suggestion.ingredients.length > 0) {
      await supabase.from('recipe_ingredients').insert(
        suggestion.ingredients.map((ingredient) => ({
          recipe_id: recipe.id,
          name: ingredient.name,
          quantity: ingredient.quantity,
          unit: ingredient.unit,
        })),
      )
    }

    setSavingIndex(null)
    showToast(`${suggestion.title} gespeichert`)
    navigate(`/recipes/${recipe.id}`)
  }

  return (
    <div className="page">
      <PageHeader title="KI-Vorschlag" back="/recipes" />

      <form onSubmit={handleSubmit} className="flex flex-col gap-3">
        <div>
          <label htmlFor="suggest-prompt" className="label">
            Was möchtest du kochen?
          </label>
          <textarea
            id="suggest-prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="z. B. proteinreiches Frühstück aus vorhandenen Zutaten"
            rows={3}
            className="field mt-1.5"
          />
        </div>
        <button type="submit" disabled={loading || !prompt.trim()} className="btn btn-primary">
          {loading ? 'Lädt Vorschläge...' : 'Vorschläge holen'}
        </button>
      </form>

      {error && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">{error}</p>
      )}

      <div className="mt-4 flex flex-col gap-3">
        {suggestions.map((suggestion, index) => {
          const available = suggestion.ingredients.filter((ingredient) =>
            isIngredientAvailable(ingredient, foodItems),
          ).length
          return (
          <div key={index} className="card p-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="truncate text-lg font-bold text-ink">{suggestion.title}</h2>
                {suggestion.category && <span className="tag mt-1">{suggestion.category}</span>}
              </div>
              <AvailabilityMeter available={available} total={suggestion.ingredients.length} />
            </div>
            <p className="mt-2 text-sm text-ink-muted">{suggestion.description}</p>
            {suggestion.portions && <p className="mt-1 text-xs text-ink-faint">Für {suggestion.portions} Portionen</p>}
            <ul className="mt-3 flex flex-col gap-1.5">
              {suggestion.ingredients.map((ingredient, i) => {
                const inStock = isIngredientAvailable(ingredient, foodItems)
                return (
                  <li key={i} className="flex items-center gap-2.5">
                    <span
                      aria-hidden
                      className={`h-2.5 w-2.5 shrink-0 rounded-xs ${inStock ? 'bg-full' : 'border border-rule bg-shelf'}`}
                    />
                    <span className={`min-w-0 truncate text-sm ${inStock ? 'text-ink' : 'text-ink-faint'}`}>
                      {ingredient.name}
                    </span>
                    {ingredient.quantity != null && (
                      <span className="measure shrink-0">
                        {ingredient.quantity}
                        {ingredient.unit ? ` ${ingredient.unit}` : ''}
                      </span>
                    )}
                  </li>
                )
              })}
            </ul>
            <button
              type="button"
              onClick={() => handleCreate(suggestion, index)}
              disabled={savingIndex === index}
              className="btn btn-primary mt-3 w-full"
            >
              {savingIndex === index ? 'Speichert...' : 'Als Rezept speichern'}
            </button>
          </div>
          )
        })}
      </div>
    </div>
  )
}
