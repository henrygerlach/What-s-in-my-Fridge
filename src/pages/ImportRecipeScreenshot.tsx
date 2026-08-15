import { useState } from 'react'
import type { ChangeEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { resizeImageToBase64, UnsupportedHeicError } from '../lib/image'
import BackLink from '../components/BackLink'

export default function ImportRecipeScreenshot() {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const navigate = useNavigate()

  async function handleFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''
    if (!file) return

    setError(null)
    setLoading(true)
    try {
      const base64 = await resizeImageToBase64(file)
      const { data, error: invokeError } = await supabase.functions.invoke('parse-recipe-screenshot', {
        body: { image: base64 },
      })

      if (invokeError || !data?.recipe || !data.recipe.title) {
        setError('Rezept konnte nicht erkannt werden. Bitte manuell anlegen.')
        return
      }

      navigate('/recipes/new', { state: data.recipe })
    } catch (err) {
      setError(
        err instanceof UnsupportedHeicError
          ? 'Dieses HEIC-Foto kann in diesem Browser nicht gelesen werden. Bitte als JPG/PNG speichern (z. B. per Screenshot) oder auf einem iPhone in Safari hochladen.'
          : 'Rezept konnte nicht erkannt werden.',
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="p-4">
      <div className="flex items-center gap-2">
        <BackLink to="/recipes" />
        <h1 className="text-xl font-semibold">Screenshot importieren</h1>
      </div>
      <p className="mt-2 text-sm text-gray-500">
        Lade einen Screenshot eines Rezepts hoch, z. B. von Instagram oder einer Website. Die erkannten Angaben
        kannst du danach noch anpassen, bevor du speicherst.
      </p>

      <label className="mt-4 flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 px-4 py-8 text-center text-sm text-gray-500">
        <input
          type="file"
          accept="image/*,.heic,.heif"
          onChange={handleFile}
          disabled={loading}
          className="hidden"
        />
        {loading ? 'Rezept wird gelesen...' : 'Screenshot auswählen'}
      </label>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
