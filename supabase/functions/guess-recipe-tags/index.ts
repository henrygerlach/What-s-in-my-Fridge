// Supabase Edge Function: guesses which recipe tags fit a recipe just from
// its name, so the tag picker can pre-select sensible defaults as soon as a
// title is entered instead of starting empty every time.
// Deploy with `supabase functions deploy guess-recipe-tags`.

import { extractJson } from '../_shared/extractJson.ts'
import { extractText } from '../_shared/anthropic.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mirrors src/lib/constants.ts TAG_GROUPS. Deno edge functions can't import
// from src, so this is intentionally kept in sync by hand. `multi: false`
// groups are radio-like — at most one tag from that group should be
// returned.
const TAG_GROUPS: Array<{ multi: boolean; options: string[] }> = [
  { multi: false, options: ['Fleisch', 'Fisch', 'Vegetarisch', 'Vegan'] },
  { multi: false, options: ['< 10 Min.', '10–20 Min.', '20–40 Min.', '> 40 Min.'] },
  { multi: true, options: ['Günstig', 'Kinderfreundlich', 'Meal Prep', 'Resteverwertung', 'Scharf'] },
]

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    const { title } = (await req.json()) as { title: string }

    if (!title || typeof title !== 'string') {
      return new Response(JSON.stringify({ error: 'title is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      })
    }

    const groupList = TAG_GROUPS.map(
      (group) => `${group.multi ? 'beliebig viele' : 'höchstens einer'}: ${group.options.map((o) => `"${o}"`).join(', ')}`,
    ).join('\n')

    const prompt = `Welche dieser Tags passen zum Rezeptnamen "${title}"?

${groupList}

Wähle nur Tags, die sich aus dem Namen einigermaßen sicher ableiten lassen – rate nicht willkürlich und wenn nichts eindeutig ableitbar ist, gib ein leeres Array zurück. Aus den ersten beiden Zeilen jeweils höchstens ein Tag.

Antworte ausschließlich mit JSON in diesem Format: {"tags": string[]}`

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
    const parsed = JSON.parse(extractJson(text)) as { tags?: unknown }

    const requested = Array.isArray(parsed.tags) ? parsed.tags.filter((t): t is string => typeof t === 'string') : []

    // Validate against the known options and enforce single-select groups —
    // keep only the first valid tag per multi:false group in case the LLM
    // ignored the instruction and returned more than one.
    const tags: string[] = []
    for (const group of TAG_GROUPS) {
      const matches = requested.filter((tag) => group.options.includes(tag))
      tags.push(...(group.multi ? matches : matches.slice(0, 1)))
    }

    return new Response(JSON.stringify({ tags }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    })
  }
})
