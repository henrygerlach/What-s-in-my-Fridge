// Supabase Edge Function: sends a photo of a supermarket receipt to the LLM's
// vision capability and gets back a structured list of purchased food items,
// so the app can bulk-add them to the inventory after user review.
// Deploy with `supabase functions deploy parse-receipt`.

import { extractJson } from '../_shared/extractJson.ts'
import { extractText } from '../_shared/anthropic.ts'
import { UNIT_CONVERSION_PROMPT, GRAMS_PER_UNIT_PROMPT, normalizeUnit, normalizeGramsPerUnit } from '../_shared/units.ts'

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

interface ParsedItem {
  name: string
  quantity: number | null
  unit: string | null
  grams_per_unit: number | null
  category: string
  location: string
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

    const prompt = `Das Bild zeigt einen Kassenbon von einem Supermarkt. Extrahiere alle gekauften Lebensmittel.

Für jedes Item:
- name: kurzer, generischer Name ohne Markennamen oder Werbetext (z. B. "Vollmilch" statt Bonzeile wie "MILCH 3,5% 1L")
- quantity: Menge als Zahl, falls auf dem Bon erkennbar, sonst null
- unit: passende Einheit, sonst null
- category: exakt einer dieser Werte: ${CATEGORY_OPTIONS.map((c) => `"${c}"`).join(', ')}
- location: exakt einer dieser Werte: "fridge" (Kühlschrank), "pantry" (Vorrat), "freezer" (Gefrierfach)

Ignoriere Pfand, Rabatte, Tüten, Bonuspunkte und alles, was kein Lebensmittel ist.

Antworte ausschließlich mit JSON in diesem Format:
[{"name": string, "quantity": number | null, "unit": string | null, "grams_per_unit": number | null, "category": string, "location": string}]

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
        max_tokens: 4096,
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
    const text = extractText(data) || '[]'
    const raw = JSON.parse(extractJson(text)) as ParsedItem[]

    const items = raw
      .filter((item) => item.name && item.name.trim())
      .map((item) => ({
        name: item.name.trim(),
        quantity: typeof item.quantity === 'number' ? item.quantity : null,
        unit: normalizeUnit(item.unit),
        grams_per_unit: normalizeGramsPerUnit(item.grams_per_unit),
        category: CATEGORY_OPTIONS.includes(item.category) ? item.category : '',
        location: LOCATION_OPTIONS.includes(item.location) ? item.location : 'fridge',
      }))

    return new Response(JSON.stringify({ items }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
