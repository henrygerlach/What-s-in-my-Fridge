import { useEffect, useState } from 'react'
import type { ChangeEvent, FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useToast } from '../lib/ToastContext'
import { fetchProductByBarcode } from '../lib/openFoodFacts'
import {
  CATEGORY_OPTIONS,
  UNIT_OPTIONS,
  CONTAINER_UNITS,
  LOCATION_OPTIONS,
  LOCATION_DOT_CLASS,
  guessCategory,
} from '../lib/constants'
import { classifyItem } from '../lib/classify'
import { saveFoodItem } from '../lib/foodItems'
import { resizeImageToBase64, UnsupportedHeicError } from '../lib/image'
import BarcodeScanner from '../components/BarcodeScanner'
import PageHeader from '../components/PageHeader'
import type { InventorySource } from '../lib/inventoryLog'
import type { Location } from '../types'

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

  const modes: Array<{ value: 'manual' | 'scan' | 'receipt' | 'photo'; label: string }> = [
    { value: 'manual', label: 'Manuell' },
    { value: 'scan', label: 'Barcode' },
    { value: 'receipt', label: 'Bon' },
    { value: 'photo', label: 'Foto' },
  ]

  return (
    <div className="page">
      <PageHeader title="Artikel hinzufügen" back="/" />

      {/* Four ways in, one row: the choice is made once per visit and then
          gets out of the way. */}
      <div role="tablist" aria-label="Eingabeart" className="flex rounded-xl border border-rule bg-surface p-1">
        {modes.map((option) => (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={mode === option.value}
            onClick={() => selectMode(option.value)}
            className={`min-h-10 flex-1 rounded-lg text-sm font-medium transition-colors ${
              mode === option.value ? 'bg-ink text-white' : 'text-ink-muted hover:text-ink'
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {mode === 'scan' && (
        <div className="mt-4">
          <BarcodeScanner onScan={handleScan} />
          {scanError && (
            <p className="mt-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
              {scanError}
            </p>
          )}
        </div>
      )}

      {(mode === 'receipt' || mode === 'photo') && (
        <div className="mt-4">
          {scannedItems.length === 0 ? (
            <div>
              {sessionAddedCount > 0 && (
                <div className="card mb-3 flex items-center justify-between gap-2 p-2 pl-3">
                  <span className="text-sm text-ink-muted">
                    <span className="measure text-ink">{sessionAddedCount}</span> Artikel hinzugefügt
                  </span>
                  <button type="button" onClick={() => navigate('/')} className="btn btn-primary btn-sm">
                    Fertig
                  </button>
                </div>
              )}
              <label className="dropzone">
                <input
                  type="file"
                  accept="image/*,.heic,.heif"
                  onChange={(e) => handleScanFile(e, mode)}
                  disabled={scanLoading}
                  className="hidden"
                />
                {scanLoading ? 'Wird ausgewertet...' : SCAN_COPY[mode].prompt}
              </label>
              {scanReadError && (
                <p className="mt-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                  {scanReadError}
                </p>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              <p className="shelf-label">
                <span className="measure text-ink">{scannedItems.length}</span> erkannt – bitte prüfen
              </p>
              {scannedItems.map((item, index) => (
                <div key={index} className="card p-3">
                  <div className="flex items-center gap-2">
                    <input
                      value={item.name}
                      onChange={(e) => updateScannedItem(index, { name: e.target.value })}
                      aria-label="Name"
                      className="min-h-10 flex-1 border-b border-rule pb-1 font-medium text-ink focus:border-ink"
                    />
                    <button
                      type="button"
                      onClick={() => removeScannedItem(index)}
                      className="btn-icon h-10 w-8 text-lg text-ink-faint hover:text-danger"
                      aria-label={`${item.name} nicht übernehmen`}
                    >
                      ×
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <input
                      type="number"
                      inputMode="decimal"
                      placeholder="Menge"
                      value={item.quantity}
                      onChange={(e) => updateScannedItem(index, { quantity: e.target.value })}
                      aria-label="Menge"
                      className="field-num min-h-10 text-xs"
                    />
                    <select
                      value={item.unit}
                      onChange={(e) => updateScannedItem(index, { unit: e.target.value })}
                      aria-label="Einheit"
                      className="field min-h-10 text-xs"
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
                        <span className="text-xs text-ink-muted">1 {item.unit} entspricht ca.</span>
                        <input
                          type="number"
                          inputMode="decimal"
                          placeholder="400"
                          value={item.gramsPerUnit}
                          onChange={(e) => updateScannedItem(index, { gramsPerUnit: e.target.value })}
                          aria-label={`Gramm pro ${item.unit}`}
                          className="field-num min-h-10 w-20 text-xs"
                        />
                        <span className="text-xs text-ink-muted">g</span>
                      </div>
                    )}
                    <select
                      value={item.category}
                      onChange={(e) => updateScannedItem(index, { category: e.target.value })}
                      aria-label="Kategorie"
                      className="field col-span-2 min-h-10 text-xs"
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
                      aria-label="Ablageort"
                      className="field col-span-2 min-h-10 text-xs"
                    >
                      {LOCATION_OPTIONS.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ))}

              <div className="flex gap-2">
                <button type="button" onClick={() => setScannedItems([])} className="btn btn-quiet flex-1">
                  Neues Foto
                </button>
                <button
                  type="button"
                  onClick={handleSaveScannedItems}
                  disabled={scanSaving || scannedItems.length === 0}
                  className="btn btn-primary flex-[2]"
                >
                  {scanSaving ? 'Speichert...' : `${scannedItems.length} Artikel hinzufügen`}
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {mode === 'manual' && (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <div>
            <label htmlFor="item-name" className="label">
              Name
            </label>
            <input
              id="item-name"
              required
              autoFocus
              list="existing-names"
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="field mt-1.5"
            />
            <datalist id="existing-names">
              {existingNames.map((n) => (
                <option key={n} value={n} />
              ))}
            </datalist>
          </div>

          <div>
            <label htmlFor="item-category" className="label">
              Kategorie
              {classifying && <span className="ml-1.5 font-normal normal-case text-ink-faint">wird vorgeschlagen...</span>}
            </label>
            <select
              id="item-category"
              value={category}
              onChange={(e) => setCategory(e.target.value)}
              disabled={classifying}
              className="field mt-1.5"
            >
              <option value="">– keine Kategorie –</option>
              {CATEGORY_OPTIONS.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
            {scannedCategoryHint && (
              <p className="mt-1.5 text-xs text-ink-muted">
                Erkannt: „{scannedCategoryHint}“ – bitte passende Kategorie auswählen.
              </p>
            )}
          </div>

          <div>
            <span className="label">Ort</span>
            <div className="mt-1.5 flex gap-2">
              {LOCATION_OPTIONS.map((option) => (
                <button
                  type="button"
                  key={option.value}
                  disabled={classifying}
                  aria-pressed={location === option.value}
                  onClick={() => {
                    setLocation(option.value)
                    setLocationTouched(true)
                  }}
                  className={`btn flex-1 px-1 text-xs ${location === option.value ? 'btn-primary' : 'btn-outline'}`}
                >
                  <span
                    className={`dot ${location === option.value ? 'bg-white' : LOCATION_DOT_CLASS[option.value]}`}
                    aria-hidden
                  />
                  {option.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex gap-3">
            <div className="flex-1">
              <label htmlFor="item-quantity" className="label">
                Menge
              </label>
              <input
                id="item-quantity"
                type="number"
                inputMode="decimal"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                className="field-num mt-1.5"
              />
            </div>
            <div className="flex-1">
              <label htmlFor="item-unit" className="label">
                Einheit
              </label>
              <select
                id="item-unit"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
                className="field mt-1.5"
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
              <label htmlFor="grams-per-unit" className="label">
                1 {unit} entspricht ca. (optional)
              </label>
              <div className="mt-1.5 flex items-center gap-2">
                <input
                  id="grams-per-unit"
                  type="number"
                  inputMode="decimal"
                  placeholder="400"
                  value={gramsPerUnit}
                  onChange={(e) => setGramsPerUnit(e.target.value)}
                  className="field-num w-24"
                />
                <span className="text-sm text-ink-muted">g</span>
              </div>
              <p className="mt-1.5 text-xs text-ink-faint">
                Damit lässt sich diese Menge mit Rezepten in g/kg abgleichen.
              </p>
            </div>
          )}

          <button type="submit" disabled={saving || !name.trim()} className="btn btn-primary mt-1">
            {saving ? 'Speichert...' : 'Speichern'}
          </button>
        </form>
      )}
    </div>
  )
}
