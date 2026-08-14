import { useState } from 'react'
import { mergeFiles, downloadPdf } from '../utils/pdfUtils'

export default function MergeButton({ files }) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState(null)

  const handleMerge = async () => {
    if (files.length === 0) return

    setIsProcessing(true)
    setProgress(0)
    setError(null)

    try {
      const pdfBytes = await mergeFiles(
        files.map(f => f.file),
        (p) => setProgress(Math.round(p * 100))
      )

      const filename = generateFilename(files)
      downloadPdf(pdfBytes, filename)
    } catch (err) {
      console.error('Merge error:', err)
      setError(err.message || 'Failed to merge files')
    } finally {
      setIsProcessing(false)
      setProgress(0)
    }
  }

  return (
    <div>
      <button
        onClick={handleMerge}
        disabled={isProcessing || files.length === 0}
        className={`
          w-full py-3 px-6 rounded-lg font-medium text-white transition-all
          ${isProcessing
            ? 'bg-blue-400 dark:bg-blue-600 cursor-wait'
            : 'bg-blue-600 hover:bg-blue-700 dark:bg-blue-500 dark:hover:bg-blue-600'
          }
          disabled:opacity-50 disabled:cursor-not-allowed
        `}
      >
        {isProcessing ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
            </svg>
            Merging... {progress}%
          </span>
        ) : (
          <span className="flex items-center justify-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
            </svg>
            Merge & Download PDF
          </span>
        )}
      </button>

      {error && (
        <p className="mt-2 text-sm text-red-600 dark:text-red-400 text-center">
          {error}
        </p>
      )}
    </div>
  )
}

function generateFilename(files) {
  if (files.length === 1) {
    const baseName = files[0].name.replace(/\.[^/.]+$/, '')
    return `${baseName}_merged.pdf`
  }

  const date = new Date()
  const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '')
  return `merged_${dateStr}.pdf`
}
