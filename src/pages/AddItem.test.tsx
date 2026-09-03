import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import AddItem from './AddItem'
import { renderPage, currentPath, imageFile } from '../test/renderPage'
import { seed, rows, functionsInvoke, failOn } from '../test/fakeSupabase'
import { UnsupportedHeicError } from '../lib/image'

vi.mock('../lib/supabase')

const fetchProductByBarcode = vi.hoisted(() => vi.fn())
vi.mock('../lib/openFoodFacts', () => ({ fetchProductByBarcode }))

const resizeImageToBase64 = vi.hoisted(() => vi.fn())
vi.mock('../lib/image', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/image')>()
  return { ...actual, resizeImageToBase64 }
})

// The real scanner drives a camera through html5-qrcode; that's covered by
// BarcodeScanner's own test. Here it's swapped for a button that fires the
// decoded barcode straight at the onScan prop it was given.
const onScanCallback = vi.hoisted(() => ({ current: null as ((barcode: string) => void) | null }))
vi.mock('../components/BarcodeScanner', () => ({
  default: ({ onScan }: { onScan: (barcode: string) => void }) => {
    onScanCallback.current = onScan
    return <div data-testid="barcode-scanner" />
  },
}))

function setup() {
  return userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
}

beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true })
  functionsInvoke.mockResolvedValue({ data: null, error: null })
  fetchProductByBarcode.mockReset()
  resizeImageToBase64.mockReset().mockResolvedValue('QUJD')
  onScanCallback.current = null
})

afterEach(() => {
  vi.useRealTimers()
})

function render() {
  return renderPage(<AddItem />, { path: '/add', route: '/add' })
}

describe('AddItem — mode tabs', () => {
  it('starts in manual mode', () => {
    render()
    expect(screen.getByRole('tab', { name: 'Manuell' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByLabelText('Name')).toBeInTheDocument()
  })

  it('switches to barcode mode', async () => {
    const user = setup()
    render()
    await user.click(screen.getByRole('tab', { name: 'Barcode' }))
    expect(screen.getByRole('tab', { name: 'Barcode' })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByTestId('barcode-scanner')).toBeInTheDocument()
  })

  it('switches to receipt mode', async () => {
    const user = setup()
    render()
    await user.click(screen.getByRole('tab', { name: 'Bon' }))
    expect(screen.getByText('Foto vom Kassenbon aufnehmen oder auswählen')).toBeInTheDocument()
  })

  it('switches to photo mode', async () => {
    const user = setup()
    render()
    await user.click(screen.getByRole('tab', { name: 'Foto' }))
    expect(screen.getByText('Foto vom Kühlschrank oder Vorrat aufnehmen oder auswählen')).toBeInTheDocument()
  })
})

describe('AddItem — manual entry', () => {
  it('cannot be saved without a name', () => {
    render()
    expect(screen.getByRole('button', { name: 'Speichern' })).toBeDisabled()
  })

  it('lists existing item names for autocomplete', async () => {
    seed('food_items', [{ name: 'Milch', category: '', location: 'fridge', quantity: null, unit: null }])
    const { container } = render()
    await waitFor(() => expect(container.querySelector('datalist option')).toBeInTheDocument())
    expect(container.querySelector('datalist option')).toHaveAttribute('value', 'Milch')
  })

  it('saves a minimal item and returns to the inventory', async () => {
    const user = setup()
    render()

    await user.type(screen.getByLabelText('Name'), '  Butter  ')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('food_items')).toHaveLength(1))
    expect(rows('food_items')[0]).toMatchObject({
      name: 'Butter',
      category: '',
      quantity: null,
      unit: null,
      location: 'fridge',
    })
    await waitFor(() => expect(currentPath()).toBe('/'))
    expect(await screen.findByRole('status')).toHaveTextContent('Butter hinzugefügt')
  })

  it('saves category, location, quantity and unit', async () => {
    const user = setup()
    render()

    await user.type(screen.getByLabelText('Name'), 'Tomaten')
    await user.selectOptions(screen.getByLabelText('Kategorie'), 'Obst & Gemüse')
    await user.click(screen.getByRole('button', { name: 'Vorrat' }))
    await user.type(screen.getByLabelText('Menge'), '400')
    await user.selectOptions(screen.getByLabelText('Einheit'), 'g')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('food_items')).toHaveLength(1))
    expect(rows('food_items')[0]).toMatchObject({
      category: 'Obst & Gemüse',
      location: 'pantry',
      quantity: 400,
      unit: 'g',
    })
  })

  it('shows a grams-per-unit field only for container units', async () => {
    const user = setup()
    render()

    expect(screen.queryByLabelText(/entspricht ca/)).not.toBeInTheDocument()
    await user.selectOptions(screen.getByLabelText('Einheit'), 'Dose')
    expect(screen.getByPlaceholderText('400')).toBeInTheDocument()

    await user.selectOptions(screen.getByLabelText('Einheit'), 'g')
    expect(screen.queryByPlaceholderText('400')).not.toBeInTheDocument()
  })

  it('saves the grams-per-unit factor', async () => {
    const user = setup()
    render()

    await user.type(screen.getByLabelText('Name'), 'Kichererbsen')
    await user.selectOptions(screen.getByLabelText('Einheit'), 'Dose')
    await user.type(screen.getByPlaceholderText('400'), '400')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('food_items')[0].grams_per_unit).toBe(400))
  })

  it('merges into a matching existing item', async () => {
    seed('food_items', [{ name: 'Milch', unit: 'l', quantity: 1, location: 'fridge' }])
    const user = setup()
    render()

    await user.type(screen.getByLabelText('Name'), 'Milch')
    await user.type(screen.getByLabelText('Menge'), '1')
    await user.selectOptions(screen.getByLabelText('Einheit'), 'l')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    await waitFor(() => expect(rows('food_items')).toHaveLength(1))
    expect(rows('food_items')[0].quantity).toBe(2)
    expect(await screen.findByRole('status')).toHaveTextContent('Milch: Menge aktualisiert')
  })

  it('reports a failed save and stays on the page', async () => {
    failOn('food_items', 'insert')
    const user = setup()
    render()

    await user.type(screen.getByLabelText('Name'), 'Butter')
    await user.click(screen.getByRole('button', { name: 'Speichern' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Fehler beim Speichern')
    expect(currentPath()).toBe('/add')
  })
})

describe('AddItem — auto-classification', () => {
  it('fills category and location from the typed name', async () => {
    functionsInvoke.mockResolvedValue({ data: { category: 'Milchprodukte & Eier', location: 'fridge' }, error: null })
    const user = setup()
    render()

    await user.type(screen.getByLabelText('Name'), 'Joghurt')
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => expect(screen.getByLabelText('Kategorie')).toHaveValue('Milchprodukte & Eier'))
    expect(functionsInvoke).toHaveBeenCalledWith('classify-item', { body: { name: 'Joghurt' } })
  })

  it('does not classify a name shorter than two characters', async () => {
    const user = setup()
    render()

    await user.type(screen.getByLabelText('Name'), 'A')
    await act(async () => {
      vi.advanceTimersByTime(1500)
    })
    expect(functionsInvoke).not.toHaveBeenCalled()
  })

  it('does not overwrite a location the user already picked', async () => {
    functionsInvoke.mockResolvedValue({ data: { category: 'Getränke', location: 'freezer' }, error: null })
    const user = setup()
    render()

    await user.click(screen.getByRole('button', { name: 'Vorrat' }))
    await user.type(screen.getByLabelText('Name'), 'Cola')
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    await waitFor(() => expect(screen.getByLabelText('Kategorie')).toHaveValue('Getränke'))
    expect(screen.getByRole('button', { name: 'Vorrat' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('shows progress while classifying', async () => {
    let resolve: (value: any) => void = () => {}
    functionsInvoke.mockImplementation(() => new Promise((r) => (resolve = r)))
    const user = setup()
    render()

    await user.type(screen.getByLabelText('Name'), 'Joghurt')
    await act(async () => {
      vi.advanceTimersByTime(600)
    })

    expect(await screen.findByText('wird vorgeschlagen...')).toBeInTheDocument()
    resolve({ data: { category: '', location: 'fridge' }, error: null })
    await waitFor(() => expect(screen.queryByText('wird vorgeschlagen...')).not.toBeInTheDocument())
  })
})

describe('AddItem — barcode scan', () => {
  it('fills the manual form from a found product', async () => {
    fetchProductByBarcode.mockResolvedValue({ name: 'Cola', category: 'Getränke', quantity: 1, unit: 'l' })
    const user = setup()
    render()

    await user.click(screen.getByRole('tab', { name: 'Barcode' }))
    await act(async () => {
      onScanCallback.current?.('4001234567890')
    })

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Manuell' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByLabelText('Name')).toHaveValue('Cola')
    expect(screen.getByLabelText('Kategorie')).toHaveValue('Getränke')
    expect(screen.getByLabelText('Menge')).toHaveValue(1)
    expect(screen.getByLabelText('Einheit')).toHaveValue('l')
  })

  it('shows an unmapped category as a hint instead of guessing wrong', async () => {
    fetchProductByBarcode.mockResolvedValue({ name: 'Seltsames Produkt', category: 'Exotisches Zeug', quantity: null, unit: null })
    const user = setup()
    render()

    await user.click(screen.getByRole('tab', { name: 'Barcode' }))
    await act(async () => {
      onScanCallback.current?.('123')
    })

    expect(await screen.findByText(/Exotisches Zeug/)).toBeInTheDocument()
    expect(screen.getByLabelText('Kategorie')).toHaveValue('')
  })

  it('falls back to manual entry when the product is unknown', async () => {
    fetchProductByBarcode.mockResolvedValue(null)
    const user = setup()
    render()

    await user.click(screen.getByRole('tab', { name: 'Barcode' }))
    await act(async () => {
      onScanCallback.current?.('000')
    })

    await waitFor(() => expect(screen.getByRole('tab', { name: 'Manuell' })).toHaveAttribute('aria-selected', 'true'))
    expect(screen.getByLabelText('Name')).toHaveValue('')
  })
})

describe('AddItem — receipt and photo scan', () => {
  async function uploadIn(mode: 'Bon' | 'Foto', file = imageFile()) {
    const user = setup()
    const { container } = render()
    await user.click(screen.getByRole('tab', { name: mode }))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, file)
    return input
  }

  it('sends the downscaled receipt photo to the parser', async () => {
    functionsInvoke.mockResolvedValue({
      data: { items: [{ name: 'Bohnen', quantity: 2, unit: 'Dose', grams_per_unit: 400, category: 'Konserven & Grundnahrungsmittel', location: 'pantry' }] },
      error: null,
    })
    await uploadIn('Bon')

    await waitFor(() => expect(functionsInvoke).toHaveBeenCalledWith('parse-receipt', { body: { image: 'QUJD' } }))
    expect(await screen.findByText('erkannt – bitte prüfen')).toBeInTheDocument()
    expect(screen.getByDisplayValue('Bohnen')).toBeInTheDocument()
  })

  it('sends the fridge photo to its own parser', async () => {
    functionsInvoke.mockResolvedValue({ data: { items: [] }, error: null })
    await uploadIn('Foto')
    await waitFor(() => expect(functionsInvoke).toHaveBeenCalledWith('parse-fridge-photo', { body: { image: 'QUJD' } }))
  })

  it('reports no items detected', async () => {
    functionsInvoke.mockResolvedValue({ data: { items: [] }, error: null })
    await uploadIn('Bon')
    expect(await screen.findByText('Keine Lebensmittel auf dem Bon erkannt.')).toBeInTheDocument()
  })

  it('reports a failed parse', async () => {
    functionsInvoke.mockResolvedValue({ data: null, error: { message: 'boom' } })
    await uploadIn('Foto')
    expect(await screen.findByText('Foto konnte nicht ausgewertet werden.')).toBeInTheDocument()
  })

  it('reports an unsupported HEIC photo', async () => {
    resizeImageToBase64.mockRejectedValue(new UnsupportedHeicError())
    await uploadIn('Foto', imageFile('IMG.heic', 'image/heic'))
    expect(await screen.findByText(/HEIC-Foto/)).toBeInTheDocument()
  })

  it('shows progress while a scan is being read', async () => {
    let resolve: (value: any) => void = () => {}
    functionsInvoke.mockImplementation(() => new Promise((r) => (resolve = r)))
    await uploadIn('Bon')

    expect(await screen.findByText('Wird ausgewertet...')).toBeInTheDocument()
    resolve({ data: { items: [] }, error: null })
    await waitFor(() => expect(screen.queryByText('Wird ausgewertet...')).not.toBeInTheDocument())
  })

  it('clears the file input so the same file can be retried', async () => {
    functionsInvoke.mockResolvedValue({ data: { items: [] }, error: null })
    const input = await uploadIn('Bon')
    await waitFor(() => expect(input.value).toBe(''))
  })

  it('edits and removes a scanned row before saving', async () => {
    functionsInvoke.mockResolvedValue({
      data: { items: [{ name: 'Bohnen', quantity: 1, unit: 'Dose', grams_per_unit: null, category: '', location: 'pantry' }] },
      error: null,
    })
    const user = setup()
    await uploadIn('Bon')
    await screen.findByDisplayValue('Bohnen')

    expect(screen.getByLabelText('Gramm pro Dose')).toBeInTheDocument()
    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'Kichererbsen')
    expect(screen.getByLabelText('Name')).toHaveValue('Kichererbsen')

    await user.click(screen.getByRole('button', { name: 'Kichererbsen nicht übernehmen' }))
    expect(screen.queryByLabelText('Name')).not.toBeInTheDocument()
  })

  it('saves the reviewed scanned items and reports how many succeeded', async () => {
    functionsInvoke.mockResolvedValue({
      data: {
        items: [
          { name: 'Bohnen', quantity: 1, unit: 'Dose', grams_per_unit: 400, category: 'Konserven & Grundnahrungsmittel', location: 'pantry' },
          { name: 'Milch', quantity: 1, unit: 'l', grams_per_unit: null, category: 'Milchprodukte & Eier', location: 'fridge' },
        ],
      },
      error: null,
    })
    const user = setup()
    await uploadIn('Bon')
    await screen.findByDisplayValue('Bohnen')

    await user.click(screen.getByRole('button', { name: /Artikel hinzufügen/ }))

    await waitFor(() => expect(rows('food_items')).toHaveLength(2))
    expect(await screen.findByRole('status')).toHaveTextContent('2 von 2 Artikeln hinzugefügt')
    expect(screen.getByText('2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fertig' })).toBeInTheDocument()
  })

  it('returns to the inventory from the session summary', async () => {
    functionsInvoke.mockResolvedValue({
      data: { items: [{ name: 'Bohnen', quantity: 1, unit: 'Dose', grams_per_unit: null, category: '', location: 'pantry' }] },
      error: null,
    })
    const user = setup()
    await uploadIn('Bon')
    await screen.findByDisplayValue('Bohnen')
    await user.click(screen.getByRole('button', { name: /Artikel hinzufügen/ }))

    await screen.findByRole('button', { name: 'Fertig' })
    await user.click(screen.getByRole('button', { name: 'Fertig' }))
    expect(currentPath()).toBe('/')
  })

  it('resets the session count when switching back to manual entry', async () => {
    functionsInvoke.mockResolvedValue({
      data: { items: [{ name: 'Bohnen', quantity: 1, unit: 'Dose', grams_per_unit: null, category: '', location: 'pantry' }] },
      error: null,
    })
    const user = setup()
    const { container } = render()
    await user.click(screen.getByRole('tab', { name: 'Bon' }))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, imageFile())
    await screen.findByDisplayValue('Bohnen')
    await user.click(screen.getByRole('button', { name: /Artikel hinzufügen/ }))
    await screen.findByRole('button', { name: 'Fertig' })

    await user.click(screen.getByRole('tab', { name: 'Manuell' }))
    await user.click(screen.getByRole('tab', { name: 'Bon' }))
    expect(screen.queryByRole('button', { name: 'Fertig' })).not.toBeInTheDocument()
  })

  it('starts a new photo from the review screen', async () => {
    functionsInvoke.mockResolvedValue({
      data: { items: [{ name: 'Bohnen', quantity: 1, unit: 'Dose', grams_per_unit: null, category: '', location: 'pantry' }] },
      error: null,
    })
    const user = setup()
    await uploadIn('Bon')
    await screen.findByDisplayValue('Bohnen')

    await user.click(screen.getByRole('button', { name: 'Neues Foto' }))
    expect(screen.queryByDisplayValue('Bohnen')).not.toBeInTheDocument()
    expect(screen.getByText('Foto vom Kassenbon aufnehmen oder auswählen')).toBeInTheDocument()
  })

  it('does nothing when the picker is dismissed without a file', async () => {
    const user = setup()
    const { container } = render()
    await user.click(screen.getByRole('tab', { name: 'Bon' }))
    const input = container.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(input, [])
    expect(functionsInvoke).not.toHaveBeenCalled()
  })
})
