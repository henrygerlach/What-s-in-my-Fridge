import { useEffect, useRef, useState } from 'react'
import { Html5Qrcode, Html5QrcodeSupportedFormats } from 'html5-qrcode'

interface BarcodeScannerProps {
  onScan: (result: string) => void
}

const formatsToSupport = [
  Html5QrcodeSupportedFormats.EAN_13,
  Html5QrcodeSupportedFormats.EAN_8,
  Html5QrcodeSupportedFormats.UPC_A,
  Html5QrcodeSupportedFormats.UPC_E,
  Html5QrcodeSupportedFormats.CODE_128,
]

export default function BarcodeScanner({ onScan }: BarcodeScannerProps) {
  const containerId = 'barcode-scanner'
  const onScanRef = useRef(onScan)
  onScanRef.current = onScan
  const [error, setError] = useState<string | null>(null)

  // Persists across React StrictMode's dev-only double-invoke of effects, so the
  // camera start/stop calls stay strictly sequential instead of racing each other
  // (a race here is what causes two overlapping camera previews).
  const chainRef = useRef<Promise<void>>(Promise.resolve())

  useEffect(() => {
    let cancelled = false
    let scanner: Html5Qrcode | null = null

    chainRef.current = chainRef.current
      .then(async () => {
        if (cancelled) return
        scanner = new Html5Qrcode(containerId, { formatsToSupport, verbose: false })
        await scanner.start(
          { facingMode: 'environment' },
          { fps: 10, qrbox: { width: 250, height: 150 } },
          (decodedText) => {
            if (cancelled) return
            cancelled = true
            scanner
              ?.stop()
              .then(() => scanner?.clear())
              .catch(() => {})
            onScanRef.current(decodedText)
          },
          undefined,
        )
      })
      .catch(() => {
        if (!cancelled) setError('Kamera konnte nicht gestartet werden.')
      })

    return () => {
      cancelled = true
      chainRef.current = chainRef.current
        .then(() => (scanner?.isScanning ? scanner.stop() : undefined))
        .then(() => scanner?.clear())
        .catch(() => {})
    }
  }, [])

  return (
    <div>
      <div id={containerId} className="overflow-hidden rounded-lg" />
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  )
}
