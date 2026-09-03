import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { resizeImageToBase64, UnsupportedHeicError } from './image'

const heic2any = vi.hoisted(() => vi.fn())
vi.mock('heic2any', () => ({ default: heic2any }))

// jsdom neither decodes images nor rasterises a canvas, so both are stubbed
// at the boundary the module actually uses.
let decodeSucceeds = true
let naturalWidth = 4000
let naturalHeight = 3000
let drawnArgs: unknown[] = []
let toDataURLArgs: unknown[] = []

class FakeImage {
  onload: (() => void) | null = null
  onerror: (() => void) | null = null
  naturalWidth = 0
  naturalHeight = 0
  set src(_value: string) {
    queueMicrotask(() => {
      if (decodeSucceeds) {
        this.naturalWidth = naturalWidth
        this.naturalHeight = naturalHeight
        this.onload?.()
      } else {
        this.onerror?.()
      }
    })
  }
}

let revoked: string[] = []
let contextAvailable = true

beforeEach(() => {
  decodeSucceeds = true
  naturalWidth = 4000
  naturalHeight = 3000
  drawnArgs = []
  toDataURLArgs = []
  revoked = []
  contextAvailable = true

  vi.stubGlobal('Image', FakeImage)
  vi.stubGlobal('URL', {
    ...URL,
    createObjectURL: vi.fn(() => 'blob:fake'),
    revokeObjectURL: vi.fn((url: string) => revoked.push(url)),
  })

  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockImplementation(
    () => (contextAvailable ? ({ drawImage: (...args: unknown[]) => drawnArgs.push(...args) } as unknown as CanvasRenderingContext2D) : null),
  )
  vi.spyOn(HTMLCanvasElement.prototype, 'toDataURL').mockImplementation((...args: unknown[]) => {
    toDataURLArgs = args
    return 'data:image/jpeg;base64,QUJD'
  })
})

afterEach(() => {
  vi.unstubAllGlobals()
})

function file(name = 'photo.jpg', type = 'image/jpeg'): File {
  return new File(['x'], name, { type })
}

describe('resizeImageToBase64', () => {
  it('returns just the base64 payload, without the data URL prefix', async () => {
    expect(await resizeImageToBase64(file())).toBe('QUJD')
  })

  it('downscales so the longest edge hits the maximum', async () => {
    naturalWidth = 4000
    naturalHeight = 3000
    await resizeImageToBase64(file(), 1600)
    const canvas = document.createElement('canvas')
    expect(canvas).toBeDefined()
    // 4000x3000 scaled by 1600/4000 = 0.4
    expect(drawnArgs.slice(-2)).toEqual([1600, 1200])
  })

  it('scales by the taller edge for a portrait photo', async () => {
    naturalWidth = 3000
    naturalHeight = 4000
    await resizeImageToBase64(file(), 1600)
    expect(drawnArgs.slice(-2)).toEqual([1200, 1600])
  })

  it('never upscales an image that is already small', async () => {
    naturalWidth = 800
    naturalHeight = 600
    await resizeImageToBase64(file(), 1600)
    expect(drawnArgs.slice(-2)).toEqual([800, 600])
  })

  it('always re-encodes as JPEG at the given quality', async () => {
    await resizeImageToBase64(file(), 1600, 0.5)
    expect(toDataURLArgs).toEqual(['image/jpeg', 0.5])
  })

  it('releases the object URL after decoding', async () => {
    await resizeImageToBase64(file())
    expect(revoked).toEqual(['blob:fake'])
  })

  it('throws when the canvas has no 2D context', async () => {
    contextAvailable = false
    await expect(resizeImageToBase64(file())).rejects.toThrow('Canvas not supported')
  })

  it('propagates a decode failure for an ordinary image without trying HEIC', async () => {
    decodeSucceeds = false
    await expect(resizeImageToBase64(file())).rejects.toThrow('Image could not be decoded')
    expect(heic2any).not.toHaveBeenCalled()
  })

  it('releases the object URL even when decoding fails', async () => {
    decodeSucceeds = false
    await expect(resizeImageToBase64(file())).rejects.toThrow()
    expect(revoked).toEqual(['blob:fake'])
  })

  describe('HEIC fallback', () => {
    it('converts via heic2any when the browser cannot decode a HEIC file', async () => {
      let firstAttempt = true
      decodeSucceeds = false
      heic2any.mockImplementation(async () => {
        decodeSucceeds = true
        firstAttempt = false
        return new Blob(['jpeg'], { type: 'image/jpeg' })
      })

      expect(await resizeImageToBase64(file('IMG_0001.HEIC', ''))).toBe('QUJD')
      expect(heic2any).toHaveBeenCalledWith(expect.objectContaining({ toType: 'image/jpeg', quality: 0.9 }))
      expect(firstAttempt).toBe(false)
    })

    it('takes the first blob when heic2any returns an array', async () => {
      decodeSucceeds = false
      heic2any.mockImplementation(async () => {
        decodeSucceeds = true
        return [new Blob(['a']), new Blob(['b'])]
      })
      expect(await resizeImageToBase64(file('IMG_0001.heic', 'image/heic'))).toBe('QUJD')
    })

    it('detects HEIC by MIME type as well as by extension', async () => {
      decodeSucceeds = false
      heic2any.mockImplementation(async () => {
        decodeSucceeds = true
        return new Blob(['jpeg'])
      })
      await resizeImageToBase64(file('photo.dat', 'image/heif'))
      expect(heic2any).toHaveBeenCalled()
    })

    it('raises UnsupportedHeicError when the fallback decoder also fails', async () => {
      decodeSucceeds = false
      heic2any.mockRejectedValue(new Error('unsupported variant'))
      await expect(resizeImageToBase64(file('IMG_0001.heic', 'image/heic'))).rejects.toBeInstanceOf(
        UnsupportedHeicError,
      )
    })

    it('raises UnsupportedHeicError when the converted blob still will not decode', async () => {
      decodeSucceeds = false
      heic2any.mockResolvedValue(new Blob(['jpeg']))
      await expect(resizeImageToBase64(file('IMG_0001.heic', 'image/heic'))).rejects.toBeInstanceOf(
        UnsupportedHeicError,
      )
    })
  })
})

describe('UnsupportedHeicError', () => {
  it('is a named Error with a human-readable message', () => {
    const error = new UnsupportedHeicError()
    expect(error).toBeInstanceOf(Error)
    expect(error.name).toBe('UnsupportedHeicError')
    expect(error.message).toMatch(/HEIC/)
  })
})
