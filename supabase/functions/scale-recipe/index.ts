// Supabase Edge Function: rewrites a recipe's instruction text for a new
// portion count. Ingredient quantities are scaled with plain client-side math
// (they're structured numbers), but quantities mentioned inside the freeform
// instructions text need the LLM to find and adjust them without disturbing
// the rest of the wording.
// Deploy with `supabase functions deploy scale-recipe`.

import { extractText } from '../_shared/anthropic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { instructions, originalPortions, newPortions } = (await req.json()) as {
      instructions: string
      originalPortions: number
      newPortions: number
    }

    if (!instructions || !originalPortions || !newPortions) {
      return new Response(JSON.stringify({ error: 'instructions, originalPortions and newPortions are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const factor = (newPortions / originalPortions).toFixed(3)

    const prompt = `Hier ist eine Zubereitungsanleitung für ${originalPortions} Portionen:

${instructions}

Schreibe die Anleitung für ${newPortions} Portionen um. Passe ausschließlich die Mengenangaben proportional an (Faktor ${factor}), behalte Formulierung, Reihenfolge und Nummerierung der Schritte exakt bei. Antworte ausschließlich mit dem umgeschriebenen Text, ohne zusätzliche Erklärungen, Anführungszeichen oder JSON.`

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
    const text = extractText(data).trim() || instructions

    return new Response(JSON.stringify({ instructions: text }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
