import { describe, it, expect, vi, beforeEach } from 'vitest'
import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import ImportRecipeScreenshot from './ImportRecipeScreenshot'
import { renderPage, currentPath, currentState, imageFile } from '../test/renderPage'
import { functionsInvoke } from '../test/fakeSupabase'
import { UnsupportedHeicError } from '../lib/image'

vi.mock('../lib/supabase')

const resizeImageToBase64 = vi.hoisted(() => vi.fn())
vi.mock('../lib/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/image')>()
  return { ...actual, resizeImageToBase64 }
})

const recipe = { title: 'Chili sin Carne', portions: 4, ingredients: [], tags: [] }

beforeEach(() => {
  resizeImageToBase64.mockReset().mockResolvedValue('QUJD')
})

async function upload(file = imageFile()) {
  const user = userEvent.setup()
  const { container } = renderPage(<ImportRecipeScreenshot />)
  const input = container.querySelector('input[type="file"]') as HTMLInputElement
  await user.upload(input, file)
  return input
}

describe('ImportRecipeScreenshot', () => {
  it('explains what to upload and that the result stays editable', () => {
    renderPage(<ImportRecipeScreenshot />)
    expect(screen.getByRole('heading', { name: 'Screenshot importieren' })).toBeInTheDocument()
    expect(screen.getByText(/kannst du danach noch anpassen/)).toBeInTheDocument()
  })

  it('accepts HEIC alongside ordinary image types', () => {
    const { container } = renderPage(<ImportRecipeScreenshot />)
    expect(container.querySelector('input[type="file"]')).toHaveAttribute('accept', 'image/*,.heic,.heif')
  })

  it('downscales the screenshot and sends it to the parser', async () => {
    functionsInvoke.mockResolvedValue({ data: { recipe }, error: null })
    await upload()

    await waitFor(() => expect(functionsInvoke).toHaveBeenCalled())
    expect(resizeImageToBase64).toHaveBeenCalled()
    expect(functionsInvoke).toHaveBeenCalledWith('parse-recipe-screenshot', { body: { image: 'QUJD' } })
  })

  // The parsed recipe is handed to the form as router state, never saved
  // directly — the user confirms it first.
  it('hands the parsed recipe to the new-recipe form', async () => {
    functionsInvoke.mockResolvedValue({ data: { recipe }, error: null })
    await upload()
    await waitFor(() => expect(currentPath()).toBe('/recipes/new'))
    expect(currentState()).toEqual(recipe)
  })

  it('shows progress while the screenshot is being read', async () => {
    let resolveInvoke: (value: any) => void = () => {}
    functionsInvoke.mockImplementation(() => new Promise((resolve) => (resolveInvoke = resolve)))
    await upload()

    expect(await screen.findByText('Rezept wird gelesen...')).toBeInTheDocument()
    resolveInvoke({ data: { recipe }, error: null })
    await waitFor(() => expect(screen.getByText('Screenshot auswählen')).toBeInTheDocument())
  })

  it('reports a parse that produced no usable recipe', async () => {
    functionsInvoke.mockResolvedValue({ data: { recipe: { title: '' } }, error: null })
    await upload()
    expect(await screen.findByText(/Bitte manuell anlegen/)).toBeInTheDocument()
    expect(currentPath()).toBe('/')
  })

  it('reports a failed parser call', async () => {
    functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await upload()
    expect(await screen.findByText(/Bitte manuell anlegen/)).toBeInTheDocument()
  })

  it('reports a generic decode failure', async () => {
    resizeImageToBase64.mockRejectedValue(new Error('canvas exploded'))
    await upload()
    expect(await screen.findByText('Rezept konnte nicht erkannt werden.')).toBeInTheDocument()
  })

  // The HEIC case gets its own message because the user can actually act on
  // it — re-save as JPG — unlike a generic failure.
  it('gives HEIC-specific advice when the photo cannot be decoded', async () => {
    resizeImageToBase64.mockRejectedValue(new UnsupportedHeicError())
    await upload(imageFile('IMG_0001.heic', 'image/heic'))
    expect(await screen.findByText(/HEIC-Foto/)).toBeInTheDocument()
    expect(screen.getByText(/als JPG\/PNG speichern/)).toBeInTheDocument()
  })

  // Without this, re-picking the same file fires no change event at all.
  it('clears the file input so the same file can be retried', async () => {
    functionsInvoke.mockResolvedValue({ data: { recipe }, error: null })
    const input = await upload()
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('does nothing when the picker is dismissed without a file', async () => {
    const { container } = renderPage(<ImportRecipeScreenshot />)
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await userEvent.setup().upload(input, [])
    expect(functionsInvoke).not.toHaveBeenCalled()
  })
})
