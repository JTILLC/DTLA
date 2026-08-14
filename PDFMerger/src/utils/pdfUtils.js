import { PDFDocument } from 'pdf-lib'

export async function mergeFiles(files, onProgress = () => {}) {
  const mergedPdf = await PDFDocument.create()

  for (let i = 0; i < files.length; i++) {
    const file = files[i]
    const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')

    if (isPdf) {
      await addPdfToDocument(mergedPdf, file)
    } else {
      await addImageToDocument(mergedPdf, file)
    }

    onProgress((i + 1) / files.length)
  }

  const pdfBytes = await mergedPdf.save()
  return pdfBytes
}

async function addPdfToDocument(mergedPdf, file) {
  const arrayBuffer = await file.arrayBuffer()

  try {
    const pdf = await PDFDocument.load(arrayBuffer, { ignoreEncryption: true })
    const pages = await mergedPdf.copyPages(pdf, pdf.getPageIndices())
    pages.forEach(page => mergedPdf.addPage(page))
  } catch (error) {
    console.error(`Error loading PDF ${file.name}:`, error)
    throw new Error(`Could not load PDF: ${file.name}. The file may be corrupted or password-protected.`)
  }
}

async function addImageToDocument(mergedPdf, file) {
  const arrayBuffer = await file.arrayBuffer()
  const uint8Array = new Uint8Array(arrayBuffer)

  let image
  const mimeType = file.type.toLowerCase()

  try {
    if (mimeType === 'image/png') {
      image = await mergedPdf.embedPng(uint8Array)
    } else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') {
      image = await mergedPdf.embedJpg(uint8Array)
    } else {
      // For other formats (gif, webp, bmp), convert to PNG via canvas
      image = await embedImageViaCanvas(mergedPdf, file)
    }
  } catch (error) {
    // Fallback: try canvas conversion for any image that fails direct embedding
    console.warn(`Direct embedding failed for ${file.name}, trying canvas conversion...`)
    image = await embedImageViaCanvas(mergedPdf, file)
  }

  // Get image dimensions
  const { width: imgWidth, height: imgHeight } = image.scale(1)

  // Create page sized to image (with max dimensions like A4)
  const maxWidth = 595.28  // A4 width in points
  const maxHeight = 841.89 // A4 height in points

  let pageWidth = imgWidth
  let pageHeight = imgHeight

  // Scale down if image is larger than A4
  if (imgWidth > maxWidth || imgHeight > maxHeight) {
    const widthRatio = maxWidth / imgWidth
    const heightRatio = maxHeight / imgHeight
    const scale = Math.min(widthRatio, heightRatio)
    pageWidth = imgWidth * scale
    pageHeight = imgHeight * scale
  }

  const page = mergedPdf.addPage([pageWidth, pageHeight])

  // Draw image centered on page
  page.drawImage(image, {
    x: 0,
    y: 0,
    width: pageWidth,
    height: pageHeight,
  })
}

async function embedImageViaCanvas(pdfDoc, file) {
  return new Promise((resolve, reject) => {
    const img = new Image()
    const url = URL.createObjectURL(file)

    img.onload = async () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = img.width
        canvas.height = img.height

        const ctx = canvas.getContext('2d')
        ctx.drawImage(img, 0, 0)

        // Convert to PNG
        const pngDataUrl = canvas.toDataURL('image/png')
        const pngBase64 = pngDataUrl.split(',')[1]
        const pngBytes = Uint8Array.from(atob(pngBase64), c => c.charCodeAt(0))

        const image = await pdfDoc.embedPng(pngBytes)
        URL.revokeObjectURL(url)
        resolve(image)
      } catch (error) {
        URL.revokeObjectURL(url)
        reject(error)
      }
    }

    img.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error(`Failed to load image: ${file.name}`))
    }

    img.src = url
  })
}

export function downloadPdf(pdfBytes, filename) {
  const blob = new Blob([pdfBytes], { type: 'application/pdf' })
  const url = URL.createObjectURL(blob)

  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)

  URL.revokeObjectURL(url)
}
