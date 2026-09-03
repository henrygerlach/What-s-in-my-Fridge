import { describe, it, expect } from 'vitest'
import { extractJson } from './extractJson.ts'

// Every Edge Function parses the model's reply through this. The failure it
// guards against is real and routine: the model wraps JSON in a markdown
// fence even when the prompt says not to, and JSON.parse then throws on the
// backticks rather than on anything wrong with the data.
describe('extractJson', () => {
  it('unwraps a ```json fenced block', () => {
    expect(extractJson('```json\n{"a":1}\n```')).toBe('{"a":1}')
  })

  it('unwraps an unlabelled fenced block', () => {
    expect(extractJson('```\n[1,2]\n```')).toBe('[1,2]')
  })

  it('unwraps a fence surrounded by prose', () => {
    expect(extractJson('Sure! Here you go:\n```json\n{"a":1}\n```\nHope that helps.')).toBe('{"a":1}')
  })

  it('passes unfenced JSON through, trimmed', () => {
    expect(extractJson('  {"a":1}\n')).toBe('{"a":1}')
  })

  it('produces something JSON.parse accepts in each case', () => {
    for (const reply of ['```json\n{"a":1}\n```', '```\n{"a":1}\n```', '{"a":1}']) {
      expect(JSON.parse(extractJson(reply))).toEqual({ a: 1 })
    }
  })
})
