// Supabase Edge Function: sends a screenshot of a recipe (e.g. from Instagram
// or a recipe website) to the LLM's vision capability and gets back a
// structured recipe, so it can be prefilled into the recipe form for review.
// Deploy with `supabase functions deploy parse-recipe-screenshot`.

import { extractJson } from '../_shared/extractJson.ts'
import { extractText } from '../_shared/anthropic.ts'
import { UNIT_CONVERSION_PROMPT, GRAMS_PER_UNIT_PROMPT, normalizeUnit, normalizeGramsPerUnit } from '../_shared/units.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RECIPE_CATEGORY_OPTIONS = ['Frühstück', 'Große Mahlzeit', 'Snack']

// Mirrors src/lib/constants.ts TAG_GROUPS. Deno edge functions can't import
// from src, so this is intentionally kept in sync by hand.
interface TagGroup {
  label: string
  multi: boolean
  options: string[]
}

const TAG_GROUPS: TagGroup[] = [
  { label: 'Art', multi: false, options: ['Fleisch', 'Fisch', 'Vegetarisch', 'Vegan'] },
  { label: 'Zubereitungszeit', multi: false, options: ['< 10 Min.', '10–20 Min.', '20–40 Min.', '> 40 Min.'] },
  {
    label: 'Eigenschaften',
    multi: true,
    options: ['Günstig', 'Kinderfreundlich', 'Meal Prep', 'Resteverwertung', 'Scharf'],
  },
]

// Keeps only recognized tags, and enforces the same single-select behavior
// per group that the UI's toggleTag does — at most one tag from a
// multi: false group (e.g. only one prep-time bucket).
function normalizeTags(rawTags: unknown): string[] {
  if (!Array.isArray(rawTags)) return []
  const candidates = rawTags.filter((tag): tag is string => typeof tag === 'string')

  const tags: string[] = []
  for (const group of TAG_GROUPS) {
    const inGroup = candidates.filter((tag) => group.options.includes(tag))
    tags.push(...(group.multi ? inGroup : inGroup.slice(0, 1)))
  }
  return tags
}

interface ParsedIngredient {
  name: string
  quantity: number | null
  unit: string | null
  grams_per_unit: number | null
}

interface ParsedRecipe {
  title: string
  category: string | null
  portions: number | null
  instructions: string
  ingredients: ParsedIngredient[]
  tags: string[]
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { image } = (await req.json()) as { image: string }

    if (!image || typeof image !== 'string') {
      return new Response(JSON.stringify({ error: 'image is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const prompt = `Das Bild zeigt einen Screenshot eines Kochrezepts, z. B. von Instagram, TikTok oder einer Rezept-Website. Extrahiere das Rezept aus Titel, Bildunterschrift und sichtbarem Text.

Antworte ausschließlich mit JSON in diesem Format:
{
  "title": string,
  "category": "Frühstück" | "Große Mahlzeit" | "Snack" | null,
  "portions": number | null,
  "instructions": string,
  "ingredients": [{"name": string, "quantity": number | null, "unit": string | null, "grams_per_unit": number | null}],
  "tags": string[]
}

Ignoriere Werbetexte, Hashtags, Nutzernamen, Kommentare und Like-Zahlen. Falls kein Rezept erkennbar ist, setze title auf einen leeren String.

Falls im Bild keine Portionsangabe erkennbar ist, gehe von 4 Portionen aus und setze "portions" entsprechend. Falls für eine Zutat keine Mengenangabe im Bild erkennbar ist, ergänze eine realistische Menge passend zur erkannten (oder angenommenen) Portionsanzahl, anstatt quantity und unit auf null zu setzen. Falls keine oder nur unvollständige Zubereitungsschritte im Bild erkennbar sind, ergänze plausible, zu den Zutaten passende Zubereitungsschritte.

Wähle für "category" immer die am besten passende der drei Optionen – fast jedes Rezept lässt sich sinnvoll zuordnen (herzhafte/warme Gerichte i. d. R. als "Große Mahlzeit"). Setze category nur auf null, wenn wirklich keine der drei Optionen passt.

Schätze außerdem passende Tags für "tags" aus diesen Gruppen, jeweils exakt in dieser Schreibweise:
${TAG_GROUPS.map((group) => `- ${group.label} (${group.multi ? 'mehrere möglich' : 'maximal einer'}): ${group.options.map((o) => `"${o}"`).join(', ')}`).join('\n')}
Bei "Art" und "Zubereitungszeit" wähle immer genau einen passenden Wert – jedes Rezept lässt sich anhand seiner Zutaten (enthält Fleisch/Fisch, oder rein pflanzlich?) und anhand von Anzahl/Komplexität der Zubereitungsschritte grob einordnen. Bei "Eigenschaften" wähle dagegen nur Tags, die eindeutig erkennbar sind (z. B. "Scharf" nur bei klar scharfen Zutaten wie Chili) – lass diese Gruppe leer, wenn nichts eindeutig zutrifft. Gib "tags" als flaches Array aller ausgewählten Werte aus allen Gruppen zurück.

${UNIT_CONVERSION_PROMPT}

${GRAMS_PER_UNIT_PROMPT}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 2048,
        messages: [
          {
            role: 'user',
            content: [
              { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: image } },
              { type: 'text', text: prompt },
            ],
          },
        ],
      }),
    })

    if (!response.ok) {
      const errorText = await response.text()
      return new Response(JSON.stringify({ error: 'LLM request failed', details: errorText }), {
        status: 502,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const data = await response.json()
    const text = extractText(data) || '{}'
    const raw = JSON.parse(extractJson(text)) as ParsedRecipe

    const recipe = {
      title: raw.title ?? '',
      category: RECIPE_CATEGORY_OPTIONS.includes(raw.category ?? '') ? raw.category : null,
      portions: typeof raw.portions === 'number' && raw.portions > 0 ? raw.portions : 4,
      instructions: raw.instructions ?? '',
      ingredients: (raw.ingredients ?? []).map((ingredient) => ({
        name: ingredient.name,
        quantity: typeof ingredient.quantity === 'number' ? ingredient.quantity : null,
        unit: normalizeUnit(ingredient.unit),
        grams_per_unit: normalizeGramsPerUnit(ingredient.grams_per_unit),
      })),
      tags: normalizeTags(raw.tags),
    }

    return new Response(JSON.stringify({ recipe }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
