import { useState, useEffect, useRef } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import { PDFDocument, rgb, StandardFonts } from 'pdf-lib'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
  'pdfjs-dist/build/pdf.worker.min.mjs',
  import.meta.url
).toString()

const TOOLS = {
  SELECT: 'select',
  TEXT: 'text',
  STRIKETHROUGH: 'strikethrough',
  HIGHLIGHT: 'highlight',
}

const FONT_SIZES = [8, 10, 12, 14, 16, 18, 20, 24, 28, 32, 36, 48, 64]

const TEXT_COLORS = [
  { name: 'Black', value: '#000000' },
  { name: 'Red', value: '#ef4444' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
  { name: 'Orange', value: '#f97316' },
  { name: 'Purple', value: '#a855f7' },
  { name: 'White', value: '#ffffff' },
]

const STRIKETHROUGH_COLORS = [
  { name: 'Red', value: '#ef4444' },
  { name: 'Black', value: '#000000' },
  { name: 'Blue', value: '#3b82f6' },
  { name: 'Green', value: '#22c55e' },
]

const HIGHLIGHT_COLORS = [
  { name: 'Yellow', value: '#fde047' },
  { name: 'Green', value: '#86efac' },
  { name: 'Blue', value: '#93c5fd' },
  { name: 'Pink', value: '#f9a8d4' },
  { name: 'Orange', value: '#fdba74' },
]

function hexToRgb(hex) {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex)
  return result ? {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  } : { r: 0, g: 0, b: 0 }
}

export default function PDFEditor({ fileItem, onSave, onClose }) {
  const [pdfDoc, setPdfDoc] = useState(null)
  const [currentPage, setCurrentPage] = useState(1)
  const [totalPages, setTotalPages] = useState(0)
  const [scale, setScale] = useState(1.2)
  const [activeTool, setActiveTool] = useState(TOOLS.SELECT)
  const [annotations, setAnnotations] = useState({})
  const [isDrawing, setIsDrawing] = useState(false)
  const [drawStart, setDrawStart] = useState(null)
  const [saving, setSaving] = useState(false)

  // Styling options
  const [fontSize, setFontSize] = useState(16)
  const [textColor, setTextColor] = useState('#000000')
  const [strikethroughColor, setStrikethroughColor] = useState('#ef4444')
  const [highlightColor, setHighlightColor] = useState('#fde047')

  // Editing state
  const [editingAnnotation, setEditingAnnotation] = useState(null)

  const canvasRef = useRef(null)
  const annotationLayerRef = useRef(null)
  const containerRef = useRef(null)

  useEffect(() => {
    loadPdf()
  }, [fileItem])

  const loadPdf = async () => {
    try {
      const arrayBuffer = await fileItem.file.arrayBuffer()
      const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise
      setPdfDoc(pdf)
      setTotalPages(pdf.numPages)
      setAnnotations({})
    } catch (err) {
      console.error('Failed to load PDF:', err)
    }
  }

  useEffect(() => {
    if (pdfDoc) {
      renderPage(currentPage)
    }
  }, [pdfDoc, currentPage, scale])

  const renderPage = async (pageNum) => {
    const page = await pdfDoc.getPage(pageNum)
    const viewport = page.getViewport({ scale })

    const canvas = canvasRef.current
    const context = canvas.getContext('2d')
    canvas.height = viewport.height
    canvas.width = viewport.width

    if (annotationLayerRef.current) {
      annotationLayerRef.current.style.width = `${viewport.width}px`
      annotationLayerRef.current.style.height = `${viewport.height}px`
    }

    await page.render({
      canvasContext: context,
      viewport: viewport,
    }).promise
  }

  const getRelativePosition = (e) => {
    const rect = annotationLayerRef.current.getBoundingClientRect()
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top,
    }
  }

  const handleMouseDown = (e) => {
    if (activeTool === TOOLS.SELECT) return

    const pos = getRelativePosition(e)
    setIsDrawing(true)
    setDrawStart(pos)

    if (activeTool === TOOLS.TEXT) {
      const text = prompt('Enter text:')
      if (text) {
        addAnnotation({
          type: 'text',
          x: pos.x,
          y: pos.y,
          text,
          fontSize: fontSize,
          color: textColor,
        })
      }
      setIsDrawing(false)
    }
  }

  const handleMouseUp = (e) => {
    if (!isDrawing || activeTool === TOOLS.SELECT || activeTool === TOOLS.TEXT) {
      setIsDrawing(false)
      return
    }

    const pos = getRelativePosition(e)
    const width = pos.x - drawStart.x
    const height = pos.y - drawStart.y

    if (Math.abs(width) > 5) {
      if (activeTool === TOOLS.STRIKETHROUGH) {
        addAnnotation({
          type: 'strikethrough',
          x: Math.min(drawStart.x, pos.x),
          y: drawStart.y,
          width: Math.abs(width),
          color: strikethroughColor,
        })
      } else if (activeTool === TOOLS.HIGHLIGHT) {
        addAnnotation({
          type: 'highlight',
          x: Math.min(drawStart.x, pos.x),
          y: Math.min(drawStart.y, pos.y),
          width: Math.abs(width),
          height: Math.abs(height) || 20,
          color: highlightColor,
        })
      }
    }

    setIsDrawing(false)
    setDrawStart(null)
  }

  const addAnnotation = (annotation) => {
    setAnnotations(prev => ({
      ...prev,
      [currentPage]: [...(prev[currentPage] || []), { ...annotation, id: crypto.randomUUID() }]
    }))
  }

  const removeAnnotation = (id) => {
    setAnnotations(prev => ({
      ...prev,
      [currentPage]: (prev[currentPage] || []).filter(a => a.id !== id)
    }))
  }

  const updateAnnotation = (id, updates) => {
    setAnnotations(prev => ({
      ...prev,
      [currentPage]: (prev[currentPage] || []).map(a =>
        a.id === id ? { ...a, ...updates } : a
      )
    }))
  }

  const handleEditText = (annotation) => {
    const newText = prompt('Edit text:', annotation.text)
    if (newText !== null && newText !== annotation.text) {
      updateAnnotation(annotation.id, { text: newText })
    }
  }

  const handleSave = async () => {
    setSaving(true)
    try {
      const arrayBuffer = await fileItem.file.arrayBuffer()
      const pdfLibDoc = await PDFDocument.load(arrayBuffer)
      const font = await pdfLibDoc.embedFont(StandardFonts.Helvetica)

      for (const [pageNumStr, pageAnnotations] of Object.entries(annotations)) {
        const pageNum = parseInt(pageNumStr)
        const page = pdfLibDoc.getPage(pageNum - 1)
        const { height } = page.getSize()

        for (const ann of pageAnnotations) {
          const pdfX = ann.x / scale
          const pdfY = height - (ann.y / scale)

          if (ann.type === 'text') {
            const colorRgb = hexToRgb(ann.color)
            page.drawText(ann.text, {
              x: pdfX,
              y: pdfY,
              size: ann.fontSize,
              font,
              color: rgb(colorRgb.r, colorRgb.g, colorRgb.b),
            })
          } else if (ann.type === 'strikethrough') {
            const colorRgb = hexToRgb(ann.color)
            page.drawLine({
              start: { x: pdfX, y: pdfY },
              end: { x: pdfX + (ann.width / scale), y: pdfY },
              thickness: 2,
              color: rgb(colorRgb.r, colorRgb.g, colorRgb.b),
            })
          } else if (ann.type === 'highlight') {
            const colorRgb = hexToRgb(ann.color)
            page.drawRectangle({
              x: pdfX,
              y: pdfY - (ann.height / scale),
              width: ann.width / scale,
              height: ann.height / scale,
              color: rgb(colorRgb.r, colorRgb.g, colorRgb.b),
              opacity: 0.4,
            })
          }
        }
      }

      const pdfBytes = await pdfLibDoc.save()
      onSave(pdfBytes, fileItem)
    } catch (err) {
      console.error('Failed to save PDF:', err)
      alert('Failed to save PDF: ' + err.message)
    } finally {
      setSaving(false)
    }
  }

  const currentAnnotations = annotations[currentPage] || []
  const showTextOptions = activeTool === TOOLS.TEXT
  const showStrikethroughOptions = activeTool === TOOLS.STRIKETHROUGH
  const showHighlightOptions = activeTool === TOOLS.HIGHLIGHT

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex flex-col">
      {/* Toolbar */}
      <div className="bg-gray-800 p-3 flex items-center gap-4 flex-wrap">
        <button
          onClick={onClose}
          className="px-3 py-1.5 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm"
        >
          &larr; Back
        </button>

        <div className="h-6 w-px bg-gray-600" />

        <span className="text-white text-sm font-medium truncate max-w-xs">
          {fileItem.name}
        </span>

        <div className="h-6 w-px bg-gray-600" />

        {/* Tool buttons */}
        <div className="flex gap-1">
          <ToolButton
            active={activeTool === TOOLS.SELECT}
            onClick={() => setActiveTool(TOOLS.SELECT)}
            title="Select (click to delete, double-click text to edit)"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 15l-2 5L9 9l11 4-5 2zm0 0l5 5M7.188 2.239l.777 2.897M5.136 7.965l-2.898-.777M13.95 4.05l-2.122 2.122m-5.657 5.656l-2.12 2.122" />
            </svg>
          </ToolButton>
          <ToolButton
            active={activeTool === TOOLS.TEXT}
            onClick={() => setActiveTool(TOOLS.TEXT)}
            title="Add Text"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </ToolButton>
          <ToolButton
            active={activeTool === TOOLS.STRIKETHROUGH}
            onClick={() => setActiveTool(TOOLS.STRIKETHROUGH)}
            title="Strikethrough"
            color={strikethroughColor}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v1m0 14v1m-7-8h14" />
            </svg>
          </ToolButton>
          <ToolButton
            active={activeTool === TOOLS.HIGHLIGHT}
            onClick={() => setActiveTool(TOOLS.HIGHLIGHT)}
            title="Highlight"
            color={highlightColor}
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
          </ToolButton>
        </div>

        {/* Text styling options */}
        {showTextOptions && (
          <>
            <div className="h-6 w-px bg-gray-600" />
            <div className="flex items-center gap-2">
              <label className="text-gray-300 text-sm">Size:</label>
              <select
                value={fontSize}
                onChange={(e) => setFontSize(Number(e.target.value))}
                className="bg-gray-700 text-white text-sm rounded px-2 py-1 border border-gray-600"
              >
                {FONT_SIZES.map(size => (
                  <option key={size} value={size}>{size}px</option>
                ))}
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-gray-300 text-sm">Color:</label>
              <ColorPicker
                colors={TEXT_COLORS}
                value={textColor}
                onChange={setTextColor}
                showCustom
              />
            </div>
          </>
        )}

        {/* Strikethrough color options */}
        {showStrikethroughOptions && (
          <>
            <div className="h-6 w-px bg-gray-600" />
            <div className="flex items-center gap-2">
              <label className="text-gray-300 text-sm">Color:</label>
              <ColorPicker
                colors={STRIKETHROUGH_COLORS}
                value={strikethroughColor}
                onChange={setStrikethroughColor}
              />
            </div>
          </>
        )}

        {/* Highlight color options */}
        {showHighlightOptions && (
          <>
            <div className="h-6 w-px bg-gray-600" />
            <div className="flex items-center gap-2">
              <label className="text-gray-300 text-sm">Color:</label>
              <ColorPicker
                colors={HIGHLIGHT_COLORS}
                value={highlightColor}
                onChange={setHighlightColor}
              />
            </div>
          </>
        )}

        <div className="h-6 w-px bg-gray-600" />

        {/* Zoom */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setScale(s => Math.max(0.5, s - 0.2))}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm"
          >
            -
          </button>
          <span className="text-white text-sm w-16 text-center">{Math.round(scale * 100)}%</span>
          <button
            onClick={() => setScale(s => Math.min(3, s + 0.2))}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 text-white rounded text-sm"
          >
            +
          </button>
        </div>

        <div className="h-6 w-px bg-gray-600" />

        {/* Page navigation */}
        <div className="flex items-center gap-2">
          <button
            onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
            disabled={currentPage === 1}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white rounded text-sm"
          >
            &lt;
          </button>
          <span className="text-white text-sm">
            Page {currentPage} / {totalPages}
          </span>
          <button
            onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
            disabled={currentPage === totalPages}
            className="px-2 py-1 bg-gray-600 hover:bg-gray-500 disabled:opacity-50 text-white rounded text-sm"
          >
            &gt;
          </button>
        </div>

        <div className="flex-1" />

        {/* Save button */}
        <button
          onClick={handleSave}
          disabled={saving || Object.keys(annotations).length === 0}
          className="px-4 py-1.5 bg-green-600 hover:bg-green-500 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded text-sm font-medium"
        >
          {saving ? 'Saving...' : 'Save Changes'}
        </button>
      </div>

      {/* PDF Viewer */}
      <div
        ref={containerRef}
        className="flex-1 overflow-auto bg-gray-700 p-4 flex justify-center"
      >
        <div className="relative inline-block shadow-xl">
          <canvas ref={canvasRef} className="block" />

          {/* Annotation layer */}
          <div
            ref={annotationLayerRef}
            className="absolute top-0 left-0"
            style={{ cursor: activeTool !== TOOLS.SELECT ? 'crosshair' : 'default' }}
            onMouseDown={handleMouseDown}
            onMouseUp={handleMouseUp}
            onMouseLeave={() => setIsDrawing(false)}
          >
            {currentAnnotations.map(ann => (
              <Annotation
                key={ann.id}
                annotation={ann}
                onRemove={() => removeAnnotation(ann.id)}
                onEdit={() => handleEditText(ann)}
                isSelectMode={activeTool === TOOLS.SELECT}
              />
            ))}

            {isDrawing && drawStart && activeTool === TOOLS.STRIKETHROUGH && (
              <div
                className="absolute h-0.5 pointer-events-none"
                style={{
                  left: drawStart.x,
                  top: drawStart.y,
                  width: 0,
                  backgroundColor: strikethroughColor,
                }}
              />
            )}
          </div>
        </div>
      </div>

      {/* Instructions */}
      <div className="bg-gray-800 px-4 py-2 text-gray-400 text-sm text-center">
        {activeTool === TOOLS.SELECT && 'Click to delete • Double-click text to edit'}
        {activeTool === TOOLS.TEXT && `Click to add text (${fontSize}px)`}
        {activeTool === TOOLS.STRIKETHROUGH && 'Click and drag to draw strikethrough'}
        {activeTool === TOOLS.HIGHLIGHT && 'Click and drag to highlight'}
      </div>
    </div>
  )
}

function ColorPicker({ colors, value, onChange, showCustom }) {
  return (
    <div className="flex gap-1">
      {colors.map(color => (
        <button
          key={color.value}
          onClick={() => onChange(color.value)}
          title={color.name}
          className={`w-6 h-6 rounded border-2 transition-transform ${
            value === color.value
              ? 'border-white scale-110'
              : 'border-gray-500 hover:border-gray-400'
          }`}
          style={{ backgroundColor: color.value }}
        />
      ))}
      {showCustom && (
        <input
          type="color"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          className="w-6 h-6 rounded cursor-pointer border border-gray-500"
          title="Custom color"
        />
      )}
    </div>
  )
}

function ToolButton({ active, onClick, children, title, color }) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={`p-2 rounded relative ${
        active
          ? 'bg-blue-600 text-white'
          : 'bg-gray-600 text-gray-200 hover:bg-gray-500'
      }`}
    >
      {children}
      {color && (
        <div
          className="absolute bottom-0.5 left-1/2 -translate-x-1/2 w-4 h-1 rounded-full"
          style={{ backgroundColor: color }}
        />
      )}
    </button>
  )
}

function Annotation({ annotation, onRemove, onEdit, isSelectMode }) {
  const ann = annotation

  const handleClick = (e) => {
    if (isSelectMode) {
      e.stopPropagation()
      onRemove()
    }
  }

  const handleDoubleClick = (e) => {
    if (isSelectMode && ann.type === 'text') {
      e.stopPropagation()
      onEdit()
    }
  }

  if (ann.type === 'text') {
    return (
      <div
        className={`absolute select-none ${
          isSelectMode
            ? 'cursor-pointer hover:bg-red-200/30 hover:outline hover:outline-2 hover:outline-red-400 rounded px-1'
            : ''
        }`}
        style={{ left: ann.x, top: ann.y - ann.fontSize }}
        onClick={handleClick}
        onDoubleClick={handleDoubleClick}
        title={isSelectMode ? 'Click to delete • Double-click to edit' : ''}
      >
        <span style={{ fontSize: ann.fontSize, color: ann.color }}>{ann.text}</span>
      </div>
    )
  }

  if (ann.type === 'strikethrough') {
    return (
      <div
        className={`absolute ${
          isSelectMode
            ? 'cursor-pointer hover:outline hover:outline-2 hover:outline-red-400'
            : ''
        }`}
        style={{
          left: ann.x,
          top: ann.y - 4,
          width: ann.width,
          height: 8,
          display: 'flex',
          alignItems: 'center',
        }}
        onClick={handleClick}
        title={isSelectMode ? 'Click to delete' : ''}
      >
        <div
          className="w-full"
          style={{
            height: 2,
            backgroundColor: ann.color,
          }}
        />
      </div>
    )
  }

  if (ann.type === 'highlight') {
    return (
      <div
        className={`absolute ${
          isSelectMode
            ? 'cursor-pointer hover:outline hover:outline-2 hover:outline-red-400'
            : ''
        }`}
        style={{
          left: ann.x,
          top: ann.y,
          width: ann.width,
          height: ann.height,
          backgroundColor: ann.color,
          opacity: 0.4,
        }}
        onClick={handleClick}
        title={isSelectMode ? 'Click to delete' : ''}
      />
    )
  }

  return null
}
