// Supabase Edge Function: classifies a batch of food item names into
// categories in a single LLM call, so that adding several missing recipe
// ingredients to the shopping list at once sorts them into the same
// category groups the inventory uses, instead of dumping them all into
// "Ohne Kategorie".
// Deploy with `supabase functions deploy classify-items`.

import { extractJson } from '../_shared/extractJson.ts'
import { extractText } from '../_shared/anthropic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const CATEGORY_OPTIONS = [
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

const MAX_NAMES = 50

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { names } = (await req.json()) as { names: string[] }

    if (!Array.isArray(names) || names.length === 0) {
      return new Response(JSON.stringify({ error: 'names is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const trimmedNames = names.slice(0, MAX_NAMES).map((name) => String(name))
    const itemList = trimmedNames.map((name, i) => `${i}. ${name}`).join('\n')

    const prompt = `Ordne jedem dieser Lebensmittel eine Kategorie zu:

${itemList}

Kategorie muss für jedes Lebensmittel exakt einer dieser Werte sein: ${CATEGORY_OPTIONS.map((c) => `"${c}"`).join(', ')}.
Wähle immer die wahrscheinlichste Kategorie, auch wenn der Name mehrdeutig ist – lass kein Lebensmittel ohne Kategorie.

Antworte ausschließlich mit einem JSON-Array in der exakt gleichen Reihenfolge wie oben, ein Eintrag pro Lebensmittel:
[{"category": string}, ...]`

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
        messages: [{ role: 'user', content: prompt }],
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
    const text = extractText(data) || '[]'
    const parsed = JSON.parse(extractJson(text)) as Array<{ category?: string }>

    // Defend against the LLM returning the wrong array length by index-
    // matching only as far as both arrays go; anything missing falls back
    // to an empty category rather than throwing.
    const categories = trimmedNames.map((_, i) => {
      const category = parsed[i]?.category
      return category && CATEGORY_OPTIONS.includes(category) ? category : ''
    })

    return new Response(JSON.stringify({ categories }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
