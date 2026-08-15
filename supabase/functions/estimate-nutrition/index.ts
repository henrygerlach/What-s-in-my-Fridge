// Supabase Edge Function: estimates a recipe's per-portion nutrition
// (kcal/protein/fat/carbs) from its title and ingredient list, so recipes get
// a nutrition value without the user having to look it up and enter it by
// hand.
// Deploy with `supabase functions deploy estimate-nutrition`.

import { extractJson } from '../_shared/extractJson.ts'
import { extractText } from '../_shared/anthropic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface IngredientInput {
  name: string
  quantity: number | null
  unit: string | null
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { title, portions, ingredients } = (await req.json()) as {
      title: string
      portions: number
      ingredients: IngredientInput[]
    }

    if (!title || !portions || !Array.isArray(ingredients)) {
      return new Response(JSON.stringify({ error: 'title, portions and ingredients are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const ingredientList = ingredients
      .map((i) => `- ${i.name}${i.quantity ? ` (${i.quantity}${i.unit ? ` ${i.unit}` : ''})` : ''}`)
      .join('\n')

    const prompt = `Schätze die Nährwerte pro Portion für dieses Rezept "${title}" (ergibt ${portions} Portionen):

${ingredientList}

Antworte ausschließlich mit JSON in diesem Format, alle Werte pro Portion und als Zahl (keine Strings, keine Einheiten): {"kcal": number, "protein_g": number, "fat_g": number, "carbs_g": number}`

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
    const parsed = JSON.parse(extractJson(text)) as {
      kcal?: unknown
      protein_g?: unknown
      fat_g?: unknown
      carbs_g?: unknown
    }

    const toNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

    return new Response(
      JSON.stringify({
        kcal: toNumber(parsed.kcal),
        protein_g: toNumber(parsed.protein_g),
        fat_g: toNumber(parsed.fat_g),
        carbs_g: toNumber(parsed.carbs_g),
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    )
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
