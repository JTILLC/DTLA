import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'

// Set up the worker
pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

export default function FilePreview({ fileItem }) {
  const [preview, setPreview] = useState(null)
  const [loading, setLoading] = useState(true)
  const [pdfRendered, setPdfRendered] = useState(false)
  const canvasRef = useRef(null)
  const isPdf = fileItem.type === 'application/pdf' || fileItem.name.toLowerCase().endsWith('.pdf')

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setPdfRendered(false)
    setPreview(null)

    if (isPdf) {
      renderPdfPreview(fileItem.file, cancelled)
    } else {
      const url = URL.createObjectURL(fileItem.file)
      setPreview(url)
      setLoading(false)

      return () => {
        cancelled = true
        URL.revokeObjectURL(url)
      }
    }

    return () => {
      cancelled = true
    }
  }, [fileItem.id])

  const renderPdfPreview = async (file, cancelled) => {
    try {
      const arrayBuffer = await file.arrayBuffer()
      if (cancelled) return

      const pdf = await pdfjsLib.getDocument({
        data: arrayBuffer,
        useSystemFonts: true,
        disableFontFace: false,
      }).promise
      if (cancelled) return

      const page = await pdf.getPage(1)
      if (cancelled) return

      // Calculate scale to fit in thumbnail
      const desiredWidth = 120
      const viewport = page.getViewport({ scale: 1 })
      const scale = desiredWidth / viewport.width
      const scaledViewport = page.getViewport({ scale })

      const canvas = canvasRef.current
      if (!canvas || cancelled) return

      canvas.width = scaledViewport.width
      canvas.height = scaledViewport.height

      const context = canvas.getContext('2d')

      await page.render({
        canvasContext: context,
        viewport: scaledViewport,
        background: 'white'
      }).promise

      if (!cancelled) {
        setPdfRendered(true)
        setLoading(false)
      }
    } catch (err) {
      console.error('PDF preview error for', file.name, ':', err)
      if (!cancelled) {
        setPdfRendered(false)
        setLoading(false)
      }
    }
  }

  // PDF preview
  if (isPdf) {
    return (
      <div className="w-16 h-20 rounded-lg overflow-hidden bg-white dark:bg-gray-200 flex-shrink-0 relative border border-gray-300 dark:border-gray-600">
        <canvas
          ref={canvasRef}
          className="w-full h-full object-contain"
          style={{
            display: pdfRendered ? 'block' : 'none',
            objectFit: 'contain'
          }}
        />
        {!pdfRendered && (
          <div className="absolute inset-0 flex items-center justify-center bg-red-100 dark:bg-red-900/30">
            {loading ? (
              <div className="w-5 h-5 border-2 border-gray-300 border-t-red-500 rounded-full animate-spin"></div>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-red-600 dark:text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            )}
          </div>
        )}
      </div>
    )
  }

  // Image preview
  return (
    <div className="w-16 h-20 rounded-lg overflow-hidden bg-gray-100 dark:bg-gray-700 flex-shrink-0 border border-gray-300 dark:border-gray-600">
      {loading ? (
        <div className="w-full h-full flex items-center justify-center">
          <div className="w-5 h-5 border-2 border-gray-300 border-t-blue-500 rounded-full animate-spin"></div>
        </div>
      ) : preview ? (
        <img
          src={preview}
          alt={fileItem.name}
          className="w-full h-full object-cover"
        />
      ) : (
        <div className="w-full h-full flex items-center justify-center">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-8 w-8 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
          </svg>
        </div>
      )}
    </div>
  )
}
