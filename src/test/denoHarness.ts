import { vi } from 'vitest'

// The Edge Functions register their handler with `Deno.serve(...)` at module
// load and read secrets from `Deno.env`. Shimming both lets the tests drive
// the real deployed handler through an ordinary Request/Response round trip,
// rather than re-implementing it.

type Handler = (request: Request) => Promise<Response> | Response

export interface EdgeFunctionHarness {
  handler: Handler
  fetchMock: ReturnType<typeof vi.fn>
  post: (body: unknown) => Promise<Response>
  options: () => Promise<Response>
}

export function stubAnthropicReply(text: string) {
  return {
    ok: true,
    status: 200,
    json: async () => ({ content: [{ type: 'text', text }] }),
    text: async () => text,
  }
}

export function stubAnthropicFailure(status = 500, body = 'upstream exploded') {
  return {
    ok: false,
    status,
    json: async () => ({}),
    text: async () => body,
  }
}

// Loads an Edge Function module with Deno and fetch stubbed, and hands back
// the handler it registered.
export async function loadEdgeFunction(
  importModule: () => Promise<unknown>,
  env: Record<string, string> = { ANTHROPIC_API_KEY: 'test-key' },
): Promise<EdgeFunctionHarness> {
  let captured: Handler | null = null

  const fetchMock = vi.fn(async () => stubAnthropicReply('{}'))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubGlobal('Deno', {
    serve: (handler: Handler) => {
      captured = handler
    },
    env: { get: (key: string) => env[key] },
  })

  vi.resetModules()
  await importModule()

  if (!captured) throw new Error('The module did not register a Deno.serve handler')
  const handler = captured as Handler

  return {
    handler,
    fetchMock,
    post: (body: unknown) =>
      Promise.resolve(
        handler(new Request('https://edge.test/fn', { method: 'POST', body: JSON.stringify(body) })),
      ),
    options: () => Promise.resolve(handler(new Request('https://edge.test/fn', { method: 'OPTIONS' }))),
  }
}

// The request body Anthropic actually received, for asserting on prompts.
export function anthropicRequestBody(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const [, init] = fetchMock.mock.calls[call] as [string, RequestInit]
  return JSON.parse(String(init.body))
}
