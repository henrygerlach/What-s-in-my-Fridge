// Supabase Edge Function: proxies AI recipe suggestions to the LLM so the API
// key never reaches the client. Given the current inventory and a short user
// prompt, returns full recipes (title, category, ingredients, instructions)
// that can be saved directly as a recipe.
// Deploy with `supabase functions deploy suggest-recipes`
// and set the secret with `supabase secrets set ANTHROPIC_API_KEY=...`.

import { extractJson } from '../_shared/extractJson.ts'
import { extractText } from '../_shared/anthropic.ts'
import { UNIT_CONVERSION_PROMPT, normalizeUnit } from '../_shared/units.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RECIPE_CATEGORY_OPTIONS = ['Frühstück', 'Große Mahlzeit', 'Snack']

interface InventoryItem {
  name: string
  quantity: number | null
  unit: string | null
}

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

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { inventory, prompt: userPrompt } = (await req.json()) as {
      inventory: InventoryItem[]
      prompt: string
    }

    if (!Array.isArray(inventory) || !userPrompt || typeof userPrompt !== 'string') {
      return new Response(JSON.stringify({ error: 'inventory and prompt are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const inventoryList =
      inventory
        .map((item) => `${item.name}${item.quantity != null ? ` (${item.quantity}${item.unit ?? ''} vorhanden)` : ''}`)
        .join(', ') || 'kein Inventar hinterlegt'

    const prompt = `Du bist ein Kochassistent. Das aktuelle Lebensmittel-Inventar mit vorhandenen Mengen: ${inventoryList}.

Nutzeranfrage: "${userPrompt}"

Schlage 1-3 passende Rezepte vor, die möglichst die vorhandenen Zutaten in den vorhandenen Mengen nutzen. Wenn eine Zutat nur in geringerer Menge vorhanden ist als das Rezept eigentlich braucht, zähl sie trotzdem als Zutat auf, aber bevorzuge Rezepte, bei denen die vorhandenen Mengen tatsächlich ausreichen. Antworte ausschließlich mit JSON in diesem Format:
[{
  "title": string,
  "category": "Frühstück" | "Große Mahlzeit" | "Snack",
  "portions": number,
  "description": string,
  "instructions": string,
  "ingredients": [{"name": string, "quantity": number | null, "unit": string | null}]
}]

${UNIT_CONVERSION_PROMPT}`

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
    const raw = JSON.parse(extractJson(text)) as Suggestion[]

    const suggestions: Suggestion[] = raw.map((item) => ({
      title: item.title,
      category: RECIPE_CATEGORY_OPTIONS.includes(item.category ?? '') ? item.category : null,
      portions: typeof item.portions === 'number' && item.portions > 0 ? item.portions : null,
      description: item.description ?? '',
      instructions: item.instructions ?? '',
      ingredients: (item.ingredients ?? []).map((ingredient) => ({
        name: ingredient.name,
        quantity: typeof ingredient.quantity === 'number' ? ingredient.quantity : null,
        unit: normalizeUnit(ingredient.unit),
      })),
    }))

    return new Response(JSON.stringify({ suggestions }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
