// Claude may return a "thinking" content block before the "text" block, so the
// reply text isn't reliably at content[0]; find the text block explicitly.
export function extractText(data: { content?: Array<{ type: string; text?: string }> }): string {
  const block = data.content?.find((item) => item.type === 'text')
  return block?.text ?? ''
}
