import { useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/ToastContext'
import { isIngredientAvailable } from '../lib/stock'
import BackLink from '../components/BackLink'
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
    <div className="p-4">
      <div className="flex items-center gap-2">
        <BackLink to="/recipes" />
        <h1 className="text-xl font-semibold">KI-Vorschlag</h1>
      </div>

      <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
        <div>
          <label className="text-sm text-gray-600">Was möchtest du kochen?</label>
          <textarea
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            placeholder="z. B. proteinreiches Frühstück aus vorhandenen Zutaten"
            rows={3}
            className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
          />
        </div>
        <button
          type="submit"
          disabled={loading || !prompt.trim()}
          className="rounded-lg bg-black py-3 text-sm font-semibold text-white disabled:opacity-50"
        >
          {loading ? 'Lädt Vorschläge...' : 'Vorschläge holen'}
        </button>
      </form>

      {error && <p className="mt-3 text-sm text-red-600">{error}</p>}

      <div className="mt-4 flex flex-col gap-3">
        {suggestions.map((suggestion, index) => {
          const available = suggestion.ingredients.filter((ingredient) =>
            isIngredientAvailable(ingredient, foodItems),
          ).length
          return (
          <div key={index} className="rounded-lg border border-gray-200 p-3">
            <div className="flex items-center justify-between gap-2">
              <h2 className="font-semibold text-gray-900">{suggestion.title}</h2>
              <div className="flex shrink-0 items-center gap-2">
                {suggestion.ingredients.length > 0 && (
                  <span
                    className={`whitespace-nowrap text-xs font-medium ${
                      available === suggestion.ingredients.length ? 'text-green-600' : 'text-gray-500'
                    }`}
                  >
                    {available}/{suggestion.ingredients.length} vorhanden
                  </span>
                )}
                {suggestion.category && (
                  <span className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-600">
                    {suggestion.category}
                  </span>
                )}
              </div>
            </div>
            <p className="mt-1 text-sm text-gray-600">{suggestion.description}</p>
            {suggestion.portions && <p className="mt-1 text-xs text-gray-400">Für {suggestion.portions} Portionen</p>}
            <ul className="mt-2 flex flex-col gap-1 text-xs text-gray-500">
              {suggestion.ingredients.map((ingredient, i) => (
                <li key={i}>
                  {ingredient.name}
                  {ingredient.quantity
                    ? ` – ${ingredient.quantity}${ingredient.unit ? ` ${ingredient.unit}` : ''}`
                    : ''}
                </li>
              ))}
            </ul>
            <button
              type="button"
              onClick={() => handleCreate(suggestion, index)}
              disabled={savingIndex === index}
              className="mt-3 w-full rounded-lg bg-black py-2 text-sm font-semibold text-white disabled:opacity-50"
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
