// Supabase Edge Function: asks the LLM to classify a food item's category and
// storage location from its name, so the app can auto-fill those fields.
// Deploy with `supabase functions deploy classify-item`.

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

const LOCATION_OPTIONS = ['fridge', 'pantry', 'freezer']

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { name } = (await req.json()) as { name: string }

    if (!name || typeof name !== 'string') {
      return new Response(JSON.stringify({ error: 'name is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const prompt = `Ordne das Lebensmittel "${name}" einer Kategorie und einem Lagerort zu.

Kategorie muss exakt einer dieser Werte sein: ${CATEGORY_OPTIONS.map((c) => `"${c}"`).join(', ')}.
Lagerort muss exakt einer dieser Werte sein: "fridge" (Kühlschrank), "pantry" (Vorrat), "freezer" (Gefrierfach).

Antworte ausschließlich mit JSON in diesem Format: {"category": string, "location": string}`

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': Deno.env.get('ANTHROPIC_API_KEY') ?? '',
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5',
        max_tokens: 200,
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
    const text = extractText(data) || '{}'
    const parsed = JSON.parse(extractJson(text))

    const category = CATEGORY_OPTIONS.includes(parsed.category) ? parsed.category : ''
    const location = LOCATION_OPTIONS.includes(parsed.location) ? parsed.location : 'fridge'

    return new Response(JSON.stringify({ category, location }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
