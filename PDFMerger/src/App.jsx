import { useState, useEffect } from 'react'
import FileDropzone from './components/FileDropzone'
import FileList from './components/FileList'
import MergeButton from './components/MergeButton'
import PDFEditor from './components/PDFEditor'

function App() {
  const [darkMode, setDarkMode] = useState(true)
  const [files, setFiles] = useState([])
  const [editingFile, setEditingFile] = useState(null)

  useEffect(() => {
    if (darkMode) {
      document.documentElement.classList.add('dark')
    } else {
      document.documentElement.classList.remove('dark')
    }
  }, [darkMode])

  const handleFilesAdded = (newFiles) => {
    const filesWithId = newFiles.map(file => ({
      id: crypto.randomUUID(),
      file,
      name: file.name,
      size: file.size,
      type: file.type
    }))
    setFiles(prev => [...prev, ...filesWithId])
  }

  const handleRemoveFile = (id) => {
    setFiles(prev => prev.filter(f => f.id !== id))
  }

  const handleMoveUp = (index) => {
    if (index === 0) return
    setFiles(prev => {
      const newFiles = [...prev]
      ;[newFiles[index - 1], newFiles[index]] = [newFiles[index], newFiles[index - 1]]
      return newFiles
    })
  }

  const handleMoveDown = (index) => {
    if (index === files.length - 1) return
    setFiles(prev => {
      const newFiles = [...prev]
      ;[newFiles[index], newFiles[index + 1]] = [newFiles[index + 1], newFiles[index]]
      return newFiles
    })
  }

  const handleClearAll = () => {
    setFiles([])
  }

  const handleEditFile = (fileItem) => {
    const isPdf = fileItem.type === 'application/pdf' || fileItem.name.toLowerCase().endsWith('.pdf')
    if (isPdf) {
      setEditingFile(fileItem)
    }
  }

  const handleSaveEdit = (pdfBytes, originalFile) => {
    // Create a new File object from the edited bytes
    const newFile = new File([pdfBytes], originalFile.name, { type: 'application/pdf' })

    // Update the file in the list
    setFiles(prev => prev.map(f => {
      if (f.id === originalFile.id) {
        return {
          ...f,
          file: newFile,
          size: newFile.size,
        }
      }
      return f
    }))

    setEditingFile(null)
  }

  const totalSize = files.reduce((acc, f) => acc + f.size, 0)

  // Show PDF editor if editing
  if (editingFile) {
    return (
      <PDFEditor
        fileItem={editingFile}
        onSave={handleSaveEdit}
        onClose={() => setEditingFile(null)}
      />
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 dark:bg-gray-900 transition-colors">
      <div className="max-w-4xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between mb-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-white">
            PDF Merger
          </h1>
          <button
            onClick={() => setDarkMode(!darkMode)}
            className="p-2 rounded-lg bg-gray-200 dark:bg-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-300 dark:hover:bg-gray-600 transition-colors"
            aria-label="Toggle dark mode"
          >
            {darkMode ? (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z" />
              </svg>
            ) : (
              <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z" />
              </svg>
            )}
          </button>
        </div>

        {/* Dropzone */}
        <FileDropzone onFilesAdded={handleFilesAdded} />

        {/* File List */}
        {files.length > 0 && (
          <div className="mt-6">
            <div className="flex items-center justify-between mb-4">
              <div className="text-sm text-gray-600 dark:text-gray-400">
                {files.length} file{files.length !== 1 ? 's' : ''} ({formatFileSize(totalSize)})
              </div>
              <button
                onClick={handleClearAll}
                className="text-sm text-red-600 dark:text-red-400 hover:text-red-700 dark:hover:text-red-300"
              >
                Clear All
              </button>
            </div>
            <FileList
              files={files}
              onRemove={handleRemoveFile}
              onMoveUp={handleMoveUp}
              onMoveDown={handleMoveDown}
              onEdit={handleEditFile}
            />
          </div>
        )}

        {/* Merge Button */}
        {files.length > 0 && (
          <div className="mt-6">
            <MergeButton files={files} />
          </div>
        )}

        {/* Instructions */}
        {files.length === 0 && (
          <div className="mt-8 text-center text-gray-500 dark:text-gray-400">
            <p>Drop PDF or image files above to get started.</p>
            <p className="text-sm mt-2">Supported formats: PDF, JPG, PNG, GIF, WebP, BMP</p>
          </div>
        )}
      </div>
    </div>
  )
}

function formatFileSize(bytes) {
  if (bytes === 0) return '0 Bytes'
  const k = 1024
  const sizes = ['Bytes', 'KB', 'MB', 'GB']
  const i = Math.floor(Math.log(bytes) / Math.log(k))
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i]
}

export default App
