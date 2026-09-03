import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import BarcodeScanner from './BarcodeScanner'

const scannerState = vi.hoisted(() => ({
  start: vi.fn(),
  stop: vi.fn(),
  clear: vi.fn(),
  instances: [] as Array<{ isScanning: boolean }>,
  onDecode: null as ((text: string) => void) | null,
  constructorArgs: [] as unknown[][],
}))

vi.mock('html5-qrcode', () => ({
  Html5QrcodeSupportedFormats: { EAN_13: 1, EAN_8: 2, UPC_A: 3, UPC_E: 4, CODE_128: 5 },
  Html5Qrcode: class {
    // Mirrors the real library: only true once start() has resolved.
    isScanning = false
    constructor(...args: unknown[]) {
      scannerState.constructorArgs.push(args)
      scannerState.instances.push(this)
    }
    async start(cameraConfig: unknown, scanConfig: unknown, onDecode: (text: string) => void) {
      scannerState.onDecode = onDecode
      await scannerState.start(cameraConfig, scanConfig)
      this.isScanning = true
    }
    stop() {
      this.isScanning = false
      return scannerState.stop()
    }
    clear() {
      return scannerState.clear()
    }
  },
}))

beforeEach(() => {
  scannerState.start.mockReset().mockResolvedValue(undefined)
  scannerState.stop.mockReset().mockResolvedValue(undefined)
  scannerState.clear.mockReset().mockResolvedValue(undefined)
  scannerState.instances.length = 0
  scannerState.constructorArgs.length = 0
  scannerState.onDecode = null
})

describe('BarcodeScanner', () => {
  it('renders the camera mount point', () => {
    const { container } = render(<BarcodeScanner onScan={() => {}} />)
    expect(container.querySelector('#barcode-scanner')).toBeInTheDocument()
  })

  it('starts the rear camera', async () => {
    render(<BarcodeScanner onScan={() => {}} />)
    await waitFor(() => expect(scannerState.start).toHaveBeenCalled())
    expect(scannerState.start.mock.calls[0][0]).toEqual({ facingMode: 'environment' })
  })

  it('restricts decoding to the retail barcode formats', async () => {
    render(<BarcodeScanner onScan={() => {}} />)
    await waitFor(() => expect(scannerState.constructorArgs.length).toBeGreaterThan(0))
    const [, options] = scannerState.constructorArgs[0] as [string, { formatsToSupport: number[] }]
    expect(options.formatsToSupport).toHaveLength(5)
  })

  it('reports a decoded barcode to the caller', async () => {
    const onScan = vi.fn()
    render(<BarcodeScanner onScan={onScan} />)
    await waitFor(() => expect(scannerState.onDecode).toBeTruthy())

    scannerState.onDecode?.('4001234567890')
    expect(onScan).toHaveBeenCalledWith('4001234567890')
  })

  // Two overlapping camera previews is the failure this guards against: the
  // first decode must stop the camera, and a second callback must be ignored.
  it('stops the camera after the first decode and ignores later ones', async () => {
    const onScan = vi.fn()
    render(<BarcodeScanner onScan={onScan} />)
    await waitFor(() => expect(scannerState.onDecode).toBeTruthy())

    scannerState.onDecode?.('4001234567890')
    await waitFor(() => expect(scannerState.stop).toHaveBeenCalled())

    scannerState.onDecode?.('9999999999999')
    expect(onScan).toHaveBeenCalledTimes(1)
    expect(onScan).toHaveBeenCalledWith('4001234567890')
  })

  it('shows a readable message when the camera will not start', async () => {
    scannerState.start.mockRejectedValue(new Error('NotAllowedError'))
    render(<BarcodeScanner onScan={() => {}} />)
    expect(await screen.findByText('Kamera konnte nicht gestartet werden.')).toBeInTheDocument()
  })

  it('stops and clears the camera on unmount', async () => {
    const { unmount } = render(<BarcodeScanner onScan={() => {}} />)
    await waitFor(() => expect(scannerState.start).toHaveBeenCalled())

    unmount()
    await waitFor(() => expect(scannerState.clear).toHaveBeenCalled())
  })

  it('does not stop a camera that never started', async () => {
    scannerState.start.mockRejectedValue(new Error('no camera'))
    const { unmount } = render(<BarcodeScanner onScan={() => {}} />)
    await screen.findByText('Kamera konnte nicht gestartet werden.')

    unmount()
    await waitFor(() => expect(scannerState.clear).toHaveBeenCalled())
    expect(scannerState.stop).not.toHaveBeenCalled()
  })
})
