import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/ToastContext'
import { fetchProductByBarcode } from '../lib/openFoodFacts'
import { CATEGORY_OPTIONS, UNIT_OPTIONS, CONTAINER_UNITS, guessCategory } from '../lib/constants'
import { classifyItem } from '../lib/classify'
import { saveFoodItem } from '../lib/foodItems'
import { resizeImageToBase64, UnsupportedHeicError } from '../lib/image'
import BarcodeScanner from '../components/BarcodeScanner'
import BackLink from '../components/BackLink'
import type { InventorySource } from '../lib/inventoryLog'
import type { Location } from '../types'

const locationOptions: Array<{ value: Location; label: string }> = [
  { value: 'fridge', label: 'Kühlschrank' },
  { value: 'pantry', label: 'Vorrat' },
  { value: 'freezer', label: 'Gefrierfach' },
]

interface ScannedItem {
  name: string
  quantity: string
  unit: string
  gramsPerUnit: string
  category: string
  location: Location
}

type ScanSource = 'receipt' | 'photo'

const SCAN_COPY: Record<ScanSource, { fn: string; prompt: string; readError: string; emptyError: string }> = {
  receipt: {
    fn: 'parse-receipt',
    prompt: 'Foto vom Kassenbon aufnehmen oder auswählen',
    readError: 'Kassenbon konnte nicht gelesen werden.',
    emptyError: 'Keine Lebensmittel auf dem Bon erkannt.',
  },
  photo: {
    fn: 'parse-fridge-photo',
    prompt: 'Foto vom Kühlschrank oder Vorrat aufnehmen oder auswählen',
    readError: 'Foto konnte nicht ausgewertet werden.',
    emptyError: 'Keine Lebensmittel auf dem Foto erkannt.',
  },
}

export default function AddItem() {
  const [mode, setMode] = useState<'manual' | 'scan' | 'receipt' | 'photo'>('manual')
  const [name, setName] = useState('')
  const [category, setCategory] = useState('')
  const [scannedCategoryHint, setScannedCategoryHint] = useState('')
  const [location, setLocation] = useState<Location>('fridge')
  const [locationTouched, setLocationTouched] = useState(false)
  const [classifying, setClassifying] = useState(false)
  const [quantity, setQuantity] = useState('')
  const [unit, setUnit] = useState('')
  const [gramsPerUnit, setGramsPerUnit] = useState('')
  const [existingNames, setExistingNames] = useState<string[]>([])
  const [saving, setSaving] = useState(false)
  const [scanError, setScanError] = useState<string | null>(null)
  const [scannedItems, setScannedItems] = useState<ScannedItem[]>([])
  const [scanLoading, setScanLoading] = useState(false)
  const [scanSaving, setScanSaving] = useState(false)
  const [scanReadError, setScanReadError] = useState<string | null>(null)
  const [sessionAddedCount, setSessionAddedCount] = useState(0)
  const navigate = useNavigate()
  const showToast = useToast()

  useEffect(() => {
    supabase
      .from('food_items')
      .select('name')
      .then(({ data }) => {
        if (data) setExistingNames([...new Set(data.map((row) => row.name))])
      })
  }, [])

  // Auto-classify category/location from the name via the LLM, debounced while
  // typing. Only fills fields the user hasn't already set themselves, and skips
  // entirely once both are already covered.
  useEffect(() => {
    if (mode !== 'manual') return
    const trimmed = name.trim()
    if (trimmed.length < 2 || (category && locationTouched)) return

    const timeoutId = window.setTimeout(async () => {
      setClassifying(true)
      const result = await classifyItem(trimmed)
      setClassifying(false)
      if (!result) return
      setCategory((current) => current || result.category)
      setLocation((current) => (locationTouched ? current : result.location))
    }, 600)

    return () => window.clearTimeout(timeoutId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [name, mode])

  async function saveItem(
    input: {
      name: string
      category: string
      quantity: number | null
      unit: string | null
      gramsPerUnit?: number | null
      location: Location
      source: InventorySource
    },
    options?: { silent?: boolean },
  ): Promise<boolean> {
    const trimmedName = input.name.trim()
    const result = await saveFoodItem({ ...input, grams_per_unit: input.gramsPerUnit ?? null })
    if (!result.ok) return false

    if (result.merged) {
      if (!options?.silent) {
        showToast(`${trimmedName}: Menge aktualisiert`)
      }
    } else {
      setExistingNames((current) => (current.includes(trimmedName) ? current : [...current, trimmedName]))
      if (!options?.silent) showToast(`${trimmedName} hinzugefügt`)
    }
    return true
  }

  async function handleScan(barcode: string) {
    setScanError(null)
    const product = await fetchProductByBarcode(barcode)
    if (!product || !product.name) {
      setScanError('Produkt nicht gefunden. Bitte manuell eingeben.')
      setMode('manual')
      return
    }
    setName(product.name)
    const guessed = guessCategory(product.category)
    setCategory(guessed)
    setScannedCategoryHint(guessed ? '' : product.category)
    if (product.quantity != null) setQuantity(String(product.quantity))
    if (product.unit) setUnit(product.unit)
    setMode('manual')
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault()
    if (!name.trim()) return
    setSaving(true)

    const ok = await saveItem({
      name,
      category,
      quantity: quantity ? Number(quantity) : null,
      unit: unit || null,
      gramsPerUnit: gramsPerUnit ? Number(gramsPerUnit) : null,
      location,
      source: 'manual',
    })

    setSaving(false)
    if (!ok) {
      showToast('Fehler beim Speichern')
      return
    }
    navigate('/')
  }

  async function handleScanFile(event: ChangeEvent<HTMLInputElement>, source: ScanSource) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    const copy = SCAN_COPY[source]
    setScanReadError(null)
    setScanLoading(true)
    try {
      const base64 = await resizeImageToBase64(file)
      const { data, error } = await supabase.functions.invoke(copy.fn, { body: { image: base64 } })

      if (error || !data?.items) {
        setScanReadError(copy.readError)
        return
      }

      const items = data.items as Array<{
        name: string
        quantity: number | null
        unit: string | null
        grams_per_unit: number | null
        category: string
        location: Location
      }>

      if (items.length === 0) {
        setScanReadError(copy.emptyError)
        return
      }

      setScannedItems(
        items.map((item) => ({
          name: item.name,
          quantity: item.quantity != null ? String(item.quantity) : '',
          unit: item.unit ?? '',
          gramsPerUnit: item.grams_per_unit != null ? String(item.grams_per_unit) : '',
          category: item.category ?? '',
          location: item.location ?? 'fridge',
        })),
      )
    } catch (err) {
      setScanReadError(
        err instanceof UnsupportedHeicError
          ? 'Dieses HEIC-Foto kann in diesem Browser nicht gelesen werden. Bitte als JPG/PNG speichern (z. B. per Screenshot) oder auf einem iPhone in Safari hochladen.'
          : copy.readError,
      )
    } finally {
      setScanLoading(false)
    }
  }

  function selectMode(next: 'manual' | 'scan' | 'receipt' | 'photo') {
    if (next !== 'receipt' && next !== 'photo') setSessionAddedCount(0)
    setMode(next)
  }

  function updateScannedItem(index: number, patch: Partial<ScannedItem>) {
    setScannedItems((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  }

  function removeScannedItem(index: number) {
    setScannedItems((rows) => rows.filter((_, i) => i !== index))
  }

  async function handleSaveScannedItems() {
    if (mode !== 'receipt' && mode !== 'photo') return
    setScanSaving(true)
    let successCount = 0

    for (const item of scannedItems) {
      const ok = await saveItem(
        {
          name: item.name,
          category: item.category,
          quantity: item.quantity ? Number(item.quantity) : null,
          unit: item.unit || null,
          gramsPerUnit: item.gramsPerUnit ? Number(item.gramsPerUnit) : null,
          location: item.location,
          source: mode,
        },
        { silent: true },
      )
      if (ok) successCount++
    }

    setScanSaving(false)
    showToast(`${successCount} von ${scannedItems.length} Artikeln hinzugefügt`)
    setSessionAddedCount((count) => count + successCount)
    setScannedItems([])
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-2">
        <BackLink to="/" />
        <h1 className="text-xl font-semibold">Item hinzufügen</h1>
      </div>

      <div className="mt-3 grid grid-cols-4 gap-2">
        <button
          type="button"
          onClick={() => selectMode('manual')}
          className={`rounded-full px-2 py-2 text-sm ${
            mode === 'manual' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Manuell
        </button>
        <button
          type="button"
          onClick={() => selectMode('scan')}
          className={`rounded-full px-2 py-2 text-sm ${
            mode === 'scan' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Barcode
        </button>
        <button
          type="button"
          onClick={() => selectMode('receipt')}
          className={`rounded-full px-2 py-2 text-sm ${
            mode === 'receipt' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Bon
        </button>
        <button
          type="button"
          onClick={() => selectMode('photo')}
          className={`rounded-full px-2 py-2 text-sm ${
            mode === 'photo' ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
          }`}
        >
          Foto
        </button>
      </div>

      {mode === 'scan' && (
        <div className="mt-4">
          <BarcodeScanner onScan={handleScan} />
          {scanError && <p className="mt-2 text-sm text-red-600">{scanError}</p>}
        </div>
      )}

      {(mode === 'receipt' || mode === 'photo') && (
        <div className="mt-4">
          {scannedItems.length === 0 ? (
            <div>
              {sessionAddedCount > 0 && (
                <div className="mb-3 flex items-center justify-between rounded-lg bg-gray-100 px-3 py-2 text-sm">
                  <span className="text-gray-600">{sessionAddedCount} Artikel bereits hinzugefügt</span>
                  <button
                    type="button"
                    onClick={() => navigate('/')}
                    className="font-semibold text-black"
                  >
                    Fertig
                  </button>
                </div>
              )}
              <label className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={(e) => handleScanFile(e, mode)}
                  disabled={scanLoading}
                  className="hidden"
                />
                {scanLoading ? 'Wird ausgewertet...' : SCAN_COPY[mode].prompt}
              </label>
              {scanReadError && <p className="mt-2 text-sm text-red-600">{scanReadError}</p>}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="text-sm text-gray-500">{scannedItems.length} Artikel erkannt – bitte prüfen:</p>
              {scannedItems.map((item, index) => (
                <div key={index} className="rounded-lg border border-gray-200 p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={item.name}
                      onChange={(e) => updateScannedItem(index, { name: e.target.value })}
                      className="flex-1 border-b border-gray-200 pb-1 text-sm font-medium"
                    />
                    <button
                      type="button"
                      onClick={() => removeScannedItem(index)}
                      className="px-1 text-gray-400"
                      aria-label="Artikel entfernen"
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="Menge"
                      value={item.quantity}
                      onChange={(e) => updateScannedItem(index, { quantity: e.target.value })}
                      className="rounded border border-gray-300 px-2 py-1 text-xs"
                    />
                    <select
                      value={item.unit}
                      onChange={(e) => updateScannedItem(index, { unit: e.target.value })}
                      className="rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value="">–</option>
                      {UNIT_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    {CONTAINER_UNITS.includes(item.unit) && (
                      <div className="col-span-2 flex items-center gap-2">
                        <span className="text-xs text-gray-500">
                          1 {item.unit} entspricht ca.
                        </span>
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="z. B. 400"
                          value={item.gramsPerUnit}
                          onChange={(e) => updateScannedItem(index, { gramsPerUnit: e.target.value })}
                          className="w-20 rounded border border-gray-300 px-2 py-1 text-xs"
                        />
                        <span className="text-xs text-gray-500">g</span>
                      </div>
                    )}
                    <select
                      value={item.category}
                      onChange={(e) => updateScannedItem(index, { category: e.target.value })}
                      className="col-span-2 rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                    >
                      <option value="">– keine Kategorie –</option>
                      {CATEGORY_OPTIONS.map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
                    </select>
                    <select
                      value={item.location}
                      onChange={(e) => updateScannedItem(index, { location: e.target.value as Location })}
                      className="col-span-2 rounded border border-gray-300 bg-white px-2 py-1 text-xs"
                    >
                      {locationOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}

              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => setScannedItems([])}
                  className="flex-1 rounded-lg bg-gray-100 py-3 text-sm font-medium text-gray-600"
                >
                  Neues Foto
                </button>
                <button
                  type="button"
                  onClick={handleSaveScannedItems}
                  disabled={scanSaving || scannedItems.length === 0}
                  className="flex-[2] rounded-lg bg-black py-3 text-sm font-semibold text-white disabled:opacity-50"
                >
                  {scanSaving ? 'Speichert...' : `${scannedItems.length} Artikel hinzufügen`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          <div>
            <label className="text-sm text-gray-600">Name *</label>
            <input
              required
              autoFocus
              list="existing-names"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
            />
            <datalist id="existing-names">
              {existingNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>

          <div>
            <label className="text-sm text-gray-600">
              Kategorie{classifying && <span className="ml-1 text-gray-400">wird vorgeschlagen...</span>}
            </label>
            <select
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={classifying}
              className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2 disabled:opacity-50"
            >
              <option value="">– keine Kategorie –</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {scannedCategoryHint && (
              <p className="mt-1 text-xs text-gray-500">
                Erkannt: „{scannedCategoryHint}“ – bitte passende Kategorie auswählen.
              </p>
            )}
          </div>

          <div>
            <label className="text-sm text-gray-600">Ort</label>
            <div className="mt-1 flex gap-2">
              {locationOptions.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  disabled={classifying}
                  onClick={() => {
                    setLocation(option.value)
                    setLocationTouched(true)
                  }}
                  className={`flex-1 rounded-lg px-3 py-2 text-sm disabled:opacity-50 ${
                    location === option.value ? 'bg-black text-white' : 'bg-gray-100 text-gray-600'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label className="text-sm text-gray-600">Menge</label>
              <input
                type="number"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-3 py-2"
              />
            </div>
            <div className="flex-1">
              <label className="text-sm text-gray-600">Einheit</label>
              <select
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 bg-white px-3 py-2"
              >
                <option value="">–</option>
                {UNIT_OPTIONS.map((option) => (
                  <option key={option} value={option}>
                    {option}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {CONTAINER_UNITS.includes(unit) && (
            <div>
              <label className="text-sm text-gray-600">1 {unit} entspricht ca. (optional)</label>
              <div className="mt-1 flex items-center gap-2">
                <input
                  type="number"
                  inputMode="decimal"
                  placeholder="z. B. 400"
                  value={gramsPerUnit}
                  onChange={(e) => setGramsPerUnit(e.target.value)}
                  className="w-24 rounded-lg border border-gray-300 px-3 py-2"
                />
                <span className="text-sm text-gray-500">g</span>
              </div>
              <p className="mt-1 text-xs text-gray-400">
                Damit lässt sich diese Menge mit Rezepten in g/kg abgleichen.
              </p>
            </div>
          )}

          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="mt-2 rounded-lg bg-black py-3 text-sm font-semibold text-white disabled:opacity-50"
          >
            {saving ? 'Speichert...' : 'Speichern'}
          </button>
        </form>
      )}
    </div>
  )
}
