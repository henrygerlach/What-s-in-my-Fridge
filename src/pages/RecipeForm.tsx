import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/ToastContext'
import { RECIPE_CATEGORY_OPTIONS, UNIT_OPTIONS, CONTAINER_UNITS, TAG_GROUPS } from '../lib/constants'
import type { TagGroup } from '../lib/constants'
import { parseDecimal } from '../lib/parseDecimal'
import { guessRecipeTags } from '../lib/recipeTags'
import { estimateNutrition } from '../lib/nutrition'
import PageHeader from '../components/PageHeader'

interface IngredientRow {
  name: string
  quantity: string
  unit: string
  gramsPerUnit: string
}

function emptyRow(): IngredientRow {
  return { name: '', quantity: '', unit: '', gramsPerUnit: '' }
}

function removeFromSet(set: Set<number>, value: number): Set<number> {
  if (!set.has(value)) return set
  const next = new Set(set)
  next.delete(value)
  return next
}

interface PrefillData {
  title?: string
  category?: string | null
  portions?: number | null
  instructions?: string
  ingredients?: Array<{ name: string; quantity: number | null; unit: string | null; grams_per_unit?: number | null }>
  tags?: string[]
}

export default function RecipeForm() {
  const { id } = useParams()
  const location = useLocation()
  const isEdit = Boolean(id)
  const navigate = useNavigate()
  const showToast = useToast()

  const [loading, setLoading] = useState(isEdit)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('')
  const [portions, setPortions] = useState('')
  const [instructions, setInstructions] = useState('')
  const [ingredients, setIngredients] = useState<IngredientRow[]>([emptyRow()])
  const [tags, setTags] = useState<string[]>([])
  const [existingPhotoUrl, setExistingPhotoUrl] = useState<string | null>(null)
  const [photo, setPhoto] = useState<File | null>(null)
  const [saving, setSaving] = useState(false)
  const [invalidQuantityRows, setInvalidQuantityRows] = useState<Set<number>>(new Set())
  const [invalidGramsRows, setInvalidGramsRows] = useState<Set<number>>(new Set())
  const [guessingTags, setGuessingTags] = useState(false)

  useEffect(() => {
    if (!id) return
    let cancelled = false

    async function load() {
      const [{ data: recipeRow }, { data: ingredientRows }] = await Promise.all([
        supabase.from('recipes').select('*').eq('id', id).single(),
        supabase.from('recipe_ingredients').select('*').eq('recipe_id', id),
      ])
      if (cancelled) return

      if (recipeRow) {
        setTitle(recipeRow.title)
        setCategory(recipeRow.category ?? '')
        setPortions(recipeRow.portions ? String(recipeRow.portions) : '')
        setInstructions(recipeRow.instructions)
        setExistingPhotoUrl(recipeRow.photo_url)
        setTags(recipeRow.tags ?? [])
      }
      if (ingredientRows && ingredientRows.length > 0) {
        setIngredients(
          ingredientRows.map((row) => ({
            name: row.name,
            quantity: row.quantity != null ? String(row.quantity) : '',
            unit: row.unit ?? '',
            gramsPerUnit: row.grams_per_unit != null ? String(row.grams_per_unit) : '',
          })),
        )
      }
      setLoading(false)
    }

    load()
    return () => {
      cancelled = true
    }
  }, [id])

  // Prefill from an AI-parsed recipe (e.g. imported from a screenshot),
  // passed via router state when navigating here to create a new recipe.
  useEffect(() => {
    if (id) return
    const prefill = location.state as PrefillData | null
    if (!prefill) return

    if (prefill.title) setTitle(prefill.title)
    if (prefill.category) setCategory(prefill.category)
    if (prefill.portions) setPortions(String(prefill.portions))
    if (prefill.instructions) setInstructions(prefill.instructions)
    if (prefill.tags && prefill.tags.length > 0) setTags(prefill.tags)
    if (prefill.ingredients && prefill.ingredients.length > 0) {
      setIngredients(
        prefill.ingredients.map((ingredient) => ({
          name: ingredient.name,
          quantity: ingredient.quantity != null ? String(ingredient.quantity) : '',
          unit: ingredient.unit ?? '',
          gramsPerUnit: ingredient.grams_per_unit != null ? String(ingredient.grams_per_unit) : '',
        })),
      )
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  // Auto-guess tags from the title via the LLM, debounced while typing.
  // Only fires while no tags are set yet, so it never overwrites a manual
  // selection (or an already-tagged recipe being edited) — it just saves
  // having to pick tags by hand for a freshly typed name.
  useEffect(() => {
    const trimmed = title.trim()
    if (trimmed.length < 3 || tags.length > 0) return

    const timeoutId = window.setTimeout(async () => {
      setGuessingTags(true)
      const guessed = await guessRecipeTags(trimmed)
      setGuessingTags(false)
      setTags((current) => (current.length === 0 ? guessed : current))
    }, 600)

    return () => window.clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title])

  function updateIngredient(index: number, patch: Partial<IngredientRow>) {
    setIngredients((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
    if ('quantity' in patch) setInvalidQuantityRows((current) => removeFromSet(current, index))
    if ('gramsPerUnit' in patch) setInvalidGramsRows((current) => removeFromSet(current, index))
  }

  function removeIngredient(index: number) {
    setIngredients((rows) => rows.filter((_, i) => i !== index))
    // Indexes shift after removal, so stale flags could point at the wrong
    // row — simplest to just clear them; they're re-derived on next submit.
    setInvalidQuantityRows(new Set())
    setInvalidGramsRows(new Set())
  }

  function toggleTag(tag: string, group: TagGroup) {
    setTags((current) => {
      if (current.includes(tag)) return current.filter((t) => t !== tag)
      if (group.multi) return [...current, tag]
      // Single-select group: picking an option replaces any other tag
      // already selected from that same group (e.g. only one prep-time tag).
      return [...current.filter((t) => !group.options.includes(t)), tag]
    })
  }

  function removeTag(tag: string) {
    setTags((current) => current.filter((t) => t !== tag))
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!title.trim()) return

    // Only rows with a name are actually saved, so only validate those —
    // an untouched blank row's leftover garbage shouldn't block saving.
    const namedRows = ingredients
      .map((row, index) => ({ row, index }))
      .filter(({ row }) => row.name.trim())

    const invalidQuantity = new Set<number>()
    const invalidGrams = new Set<number>()
    const parsedRows = namedRows.map(({ row, index }) => {
      const quantity = parseDecimal(row.quantity)
      const gramsPerUnit = parseDecimal(row.gramsPerUnit)
      if (!quantity.valid) invalidQuantity.add(index)
      if (!gramsPerUnit.valid) invalidGrams.add(index)
      return {
        name: row.name.trim(),
        quantity: quantity.value,
        unit: row.unit.trim() || null,
        grams_per_unit: gramsPerUnit.value,
      }
    })

    setInvalidQuantityRows(invalidQuantity)
    setInvalidGramsRows(invalidGrams)

    if (invalidQuantity.size > 0 || invalidGrams.size > 0) {
      showToast('Bitte die markierten Mengenangaben korrigieren')
      return
    }

    setSaving(true)

    let photoUrl = existingPhotoUrl
    if (photo) {
      const path = `${crypto.randomUUID()}-${photo.name}`
      const { data: uploadData, error: uploadError } = await supabase.storage.from('recipe-photos').upload(path, photo)
      if (!uploadError && uploadData) {
        photoUrl = supabase.storage.from('recipe-photos').getPublicUrl(uploadData.path).data.publicUrl
      }
    }

    const recipePayload = {
      title: title.trim(),
      instructions,
      photo_url: photoUrl,
      category: category || null,
      portions: portions ? Number(portions) : null,
      tags,
    }

    if (isEdit && id) {
      const { error } = await supabase.from('recipes').update(recipePayload).eq('id', id)
      if (error) {
        setSaving(false)
        showToast('Fehler beim Speichern')
        return
      }

      // Replace the ingredient set wholesale rather than diffing row by row.
      await supabase.from('recipe_ingredients').delete().eq('recipe_id', id)
      if (parsedRows.length > 0) {
        await supabase
          .from('recipe_ingredients')
          .insert(parsedRows.map((row) => ({ ...row, recipe_id: id })))
      }

      setSaving(false)
      showToast(`${title.trim()} aktualisiert`)
      navigate(`/recipes/${id}`)
      return
    }

    const { data: recipe, error } = await supabase.from('recipes').insert(recipePayload).select().single()

    if (error || !recipe) {
      setSaving(false)
      showToast('Fehler beim Speichern')
      return
    }

    if (parsedRows.length > 0) {
      const { data: insertedIngredients } = await supabase
        .from('recipe_ingredients')
        .insert(parsedRows.map((row) => ({ ...row, recipe_id: recipe.id })))
        .select()

      if (insertedIngredients && insertedIngredients.length > 0) {
        // Fired in the background, not awaited: the LLM round trip
        // shouldn't delay navigating away from the save. RecipeDetail's
        // realtime subscription on `recipes` picks up the update once it
        // lands.
        void estimateNutrition(recipe.title, insertedIngredients, recipe.portions ?? 1).then((estimate) => {
          if (!estimate) return
          return supabase
            .from('recipes')
            .update({
              kcal_per_portion: estimate.kcal,
              protein_g_per_portion: estimate.protein_g,
              fat_g_per_portion: estimate.fat_g,
              carbs_g_per_portion: estimate.carbs_g,
            })
            .eq('id', recipe.id)
        })
      }
    }

    setSaving(false)
    showToast(`${title.trim()} gespeichert`)
    navigate(`/recipes/${recipe.id}`)
  }

  if (loading) {
    return <div className="page text-sm text-ink-faint">Lädt...</div>
  }

  return (
    <div className="page">
      <PageHeader
        title={isEdit ? 'Rezept bearbeiten' : 'Neues Rezept'}
        back={isEdit && id ? `/recipes/${id}` : '/recipes'}
      />

      <form onSubmit={handleSubmit} className="flex flex-col gap-4">
        <div>
          <label htmlFor="recipe-title" className="label">
            Titel
          </label>
          <input
            id="recipe-title"
            required
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="field mt-1.5"
          />
        </div>

        <div>
          <label htmlFor="recipe-category" className="label">
            Kategorie
          </label>
          <select
            id="recipe-category"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
            className="field mt-1.5"
          >
            <option value="">– keine Kategorie –</option>
            {RECIPE_CATEGORY_OPTIONS.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </div>

        <div>
          <span className="label">
            Tags
            {guessingTags && <span className="ml-1.5 font-normal normal-case text-ink-faint">wird vorgeschlagen...</span>}
          </span>
          {tags.length > 0 && (
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {tags.map((tag) => (
                <span key={tag} className="tag gap-1 pr-1">
                  {tag}
                  <button
                    type="button"
                    onClick={() => removeTag(tag)}
                    className="px-1 text-ink-faint hover:text-danger"
                    aria-label={`Tag ${tag} entfernen`}
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
          <div className="mt-2 flex flex-col gap-2.5">
            {TAG_GROUPS.map((group) => (
              <div key={group.label}>
                <p className="shelf-label">{group.label}</p>
                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {group.options.map((option) => (
                    <button
                      key={option}
                      type="button"
                      disabled={guessingTags}
                      onClick={() => toggleTag(option, group)}
                      aria-pressed={tags.includes(option)}
                      className={`chip ${tags.includes(option) ? 'chip-on' : ''}`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="recipe-portions" className="label">
            Portionen
          </label>
          <input
            id="recipe-portions"
            type="number"
            inputMode="numeric"
            min={1}
            value={portions}
            onChange={(e) => setPortions(e.target.value)}
            className="field-num mt-1.5 w-24"
          />
        </div>

        <div>
          <span className="label">Zutaten</span>
          <div className="mt-1.5 flex flex-col gap-2">
            {ingredients.map((row, index) => (
              <div key={index} className="card flex flex-col gap-2 p-2">
                <div className="flex gap-2">
                  <input
                    placeholder="Name"
                    value={row.name}
                    onChange={(e) => updateIngredient(index, { name: e.target.value })}
                    aria-label="Zutat"
                    className="field min-w-0 flex-1"
                  />
                  <input
                    placeholder="Menge"
                    inputMode="decimal"
                    value={row.quantity}
                    onChange={(e) => updateIngredient(index, { quantity: e.target.value })}
                    aria-label="Menge"
                    aria-invalid={invalidQuantityRows.has(index)}
                    className={`field-num w-20 ${invalidQuantityRows.has(index) ? 'border-danger' : ''}`}
                  />
                  <select
                    value={row.unit}
                    onChange={(e) => updateIngredient(index, { unit: e.target.value })}
                    aria-label="Einheit"
                    className="field w-24 px-2"
                  >
                    <option value="">–</option>
                    {UNIT_OPTIONS.map((option) => (
                      <option key={option} value={option}>
                        {option}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => removeIngredient(index)}
                    className="btn-icon h-11 w-7 text-lg text-ink-faint hover:text-danger"
                    aria-label="Zutat entfernen"
                  >
                    ×
                  </button>
                </div>
                {invalidQuantityRows.has(index) && (
                  <p className="text-xs text-danger">
                    Ungültige Menge – bitte mit Punkt oder Komma eingeben (z. B. 1.5 oder 1,5)
                  </p>
                )}
                {CONTAINER_UNITS.includes(row.unit) && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-ink-muted">1 {row.unit} entspricht ca.</span>
                    <input
                      placeholder="400"
                      inputMode="decimal"
                      value={row.gramsPerUnit}
                      onChange={(e) => updateIngredient(index, { gramsPerUnit: e.target.value })}
                      aria-label={`Gramm pro ${row.unit}`}
                      aria-invalid={invalidGramsRows.has(index)}
                      className={`field-num min-h-10 w-20 text-sm ${invalidGramsRows.has(index) ? 'border-danger' : ''}`}
                    />
                    <span className="text-xs text-ink-muted">g (optional)</span>
                  </div>
                )}
                {invalidGramsRows.has(index) && (
                  <p className="text-xs text-danger">
                    Ungültiger Wert – bitte mit Punkt oder Komma eingeben (z. B. 400 oder 1,5)
                  </p>
                )}
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={() => setIngredients((rows) => [...rows, emptyRow()])}
            className="btn btn-quiet btn-sm mt-2 w-full"
          >
            + Zutat hinzufügen
          </button>
        </div>

        <div>
          <label htmlFor="recipe-instructions" className="label">
            Zubereitung
          </label>
          <textarea
            id="recipe-instructions"
            value={instructions}
            onChange={(e) => setInstructions(e.target.value)}
            rows={6}
            className="field mt-1.5 leading-relaxed"
          />
        </div>

        <div>
          <label htmlFor="recipe-photo" className="label">
            Foto (optional)
          </label>
          {existingPhotoUrl && !photo && (
            <img src={existingPhotoUrl} alt="" className="mt-1.5 mb-2 aspect-[16/10] w-full rounded-xl object-cover" />
          )}
          <input
            id="recipe-photo"
            type="file"
            accept="image/*"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
            className="mt-1.5 w-full text-sm text-ink-muted file:mr-3 file:min-h-10 file:rounded-lg file:border-0
                       file:bg-shelf file:px-3 file:text-sm file:font-medium file:text-ink"
          />
        </div>

        <button type="submit" disabled={saving || !title.trim()} className="btn btn-primary mt-1">
          {saving ? 'Speichert...' : 'Speichern'}
        </button>
      </form>
    </div>
  )
}
