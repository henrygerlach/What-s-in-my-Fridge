// Thrown specifically when a HEIC file couldn't be decoded by any available
// path (no native browser support, and the WASM fallback decoder doesn't
// support this particular HEIC encoding either — a real limitation of that
// library for some HDR/multi-image HEIC variants, not a bug to route around).
export class UnsupportedHeicError extends Error {
  constructor() {
    super('This HEIC photo could not be decoded in this browser.')
    this.name = 'UnsupportedHeicError'
  }
}

function isHeic(file: Blob): boolean {
  const type = file.type.toLowerCase()
  const name = file instanceof File ? file.name.toLowerCase() : ''
  return type.includes('heic') || type.includes('heif') || name.endsWith('.heic') || name.endsWith('.heif')
}

// Loads via an <img> element rather than createImageBitmap(): on Safari/iOS
// this goes through the OS's general image-loading pipeline, which has much
// broader real-world HEIC support (HDR gain maps, Portrait-mode depth data,
// etc.) than createImageBitmap's narrower codec path.
function loadImageElement(blob: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(blob)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      resolve(img)
    }
    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Image could not be decoded'))
    }
    img.src = url
  })
}

async function decodeImage(file: File): Promise<HTMLImageElement> {
  try {
    return await loadImageElement(file)
  } catch (nativeError) {
    if (!isHeic(file)) throw nativeError

    // Fallback for browsers without native HEIC support. Loaded on demand
    // since most photos never reach this path.
    try {
      const heic2any = (await import('heic2any')).default
      const result = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 })
      const jpegBlob = Array.isArray(result) ? result[0] : result
      return await loadImageElement(jpegBlob)
    } catch {
      throw new UnsupportedHeicError()
    }
  }
}

// Downscales an image client-side before it's sent to the LLM, so large phone
// camera photos don't blow past request size limits. Always re-encodes to
// JPEG, so callers can assume a fixed media type.
export async function resizeImageToBase64(file: File, maxDimension = 1600, quality = 0.8): Promise<string> {
  const image = await decodeImage(file)
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight))
  const width = Math.round(image.naturalWidth * scale)
  const height = Math.round(image.naturalHeight * scale)

  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas not supported')
  ctx.drawImage(image, 0, 0, width, height)

  const dataUrl = canvas.toDataURL('image/jpeg', quality)
  return dataUrl.split(',')[1]
}
