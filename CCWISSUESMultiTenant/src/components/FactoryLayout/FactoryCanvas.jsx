import { useState, useRef, useEffect, useCallback } from 'react';
import LineBox from './LineBox';
import WallTool from './WallTool';

const FactoryCanvas = ({
  layout,
  lines,
  activeTool,
  selectedId,
  setSelectedId,
  onUpdateLayout,
  onLineClick,
  onLineDoubleClick,
  zoom = 1,
  isEditMode = true
}) => {
  const svgRef = useRef(null);
  const [isDrawing, setIsDrawing] = useState(false);
  const [drawStart, setDrawStart] = useState(null);
  const [drawCurrent, setDrawCurrent] = useState(null);

  const { canvasSettings, lineBoxes = [], walls = [], labels = [] } = layout;
  const { width, height } = canvasSettings;

  // Get SVG point from mouse event
  const getSVGPoint = useCallback((e) => {
    if (!svgRef.current) return { x: 0, y: 0 };
    const svg = svgRef.current;
    const rect = svg.getBoundingClientRect();
    return {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
  }, []);

  // Handle drag and drop for new line boxes
  const handleDragOver = (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'copy';
  };

  const handleDrop = (e) => {
    e.preventDefault();
    try {
      const data = JSON.parse(e.dataTransfer.getData('application/json'));
      if (data.type === 'line') {
        const point = getSVGPoint(e);
        const newBox = {
          id: `box_${Date.now()}`,
          lineId: data.lineId,
          lineName: data.lineName,
          x: point.x - 60,
          y: point.y - 40,
          width: 120,
          height: 80,
          rotation: 0
        };

        onUpdateLayout({
          ...layout,
          lineBoxes: [...lineBoxes, newBox]
        });
        setSelectedId(newBox.id);
      }
    } catch (err) {
      console.error('Drop error:', err);
    }
  };

  // Mouse event handlers
  const handleMouseDown = (e) => {
    const point = getSVGPoint(e);

    if (activeTool === 'select') {
      if (e.target === svgRef.current || e.target.classList.contains('canvas-bg')) {
        setSelectedId(null);
      }
      return;
    }

    if (activeTool === 'wall' || activeTool === 'rectangle') {
      setIsDrawing(true);
      setDrawStart(point);
      setDrawCurrent(point);
      return;
    }

    if (activeTool === 'label') {
      const text = window.prompt('Enter label text:');
      if (text) {
        const newLabel = {
          id: `label_${Date.now()}`,
          text,
          x: point.x,
          y: point.y,
          fontSize: 14
        };
        onUpdateLayout({
          ...layout,
          labels: [...labels, newLabel]
        });
      }
      return;
    }
  };

  const handleMouseMove = (e) => {
    if (isDrawing && drawStart) {
      let point = getSVGPoint(e);

      // Shift for straight lines
      if (e.shiftKey && activeTool === 'wall') {
        const dx = Math.abs(point.x - drawStart.x);
        const dy = Math.abs(point.y - drawStart.y);
        if (dx > dy) {
          point = { x: point.x, y: drawStart.y };
        } else {
          point = { x: drawStart.x, y: point.y };
        }
      }

      setDrawCurrent(point);
    }
  };

  const handleMouseUp = () => {
    if (isDrawing && drawStart && drawCurrent) {
      const minDistance = 10;
      const dx = Math.abs(drawCurrent.x - drawStart.x);
      const dy = Math.abs(drawCurrent.y - drawStart.y);

      if (dx > minDistance || dy > minDistance) {
        const newWall = {
          id: `wall_${Date.now()}`,
          type: activeTool === 'rectangle' ? 'rectangle' : 'line',
          points: [drawStart, drawCurrent],
          stroke: 'var(--text-secondary)',
          strokeWidth: 2,
          label: ''
        };

        onUpdateLayout({
          ...layout,
          walls: [...walls, newWall]
        });
        setSelectedId(newWall.id);
      }

      setIsDrawing(false);
      setDrawStart(null);
      setDrawCurrent(null);
    }
  };

  // Snap threshold in pixels
  const SNAP_THRESHOLD = 20;
  const GAP = 10; // Gap between boxes when snapping side-by-side

  // Handle line box drag with snapping
  const handleLineBoxDragEnd = (boxId, newPosition) => {
    const currentBox = lineBoxes.find(b => b.id === boxId);
    if (!currentBox) return;

    const boxWidth = currentBox.width || 120;
    const boxHeight = currentBox.height || 80;

    let { x, y } = newPosition;
    let snappedX = false;
    let snappedY = false;

    // Collect all snap candidates
    const xSnaps = [];
    const ySnaps = [];

    lineBoxes.forEach(otherBox => {
      if (otherBox.id === boxId) return;

      const otherWidth = otherBox.width || 120;
      const otherHeight = otherBox.height || 80;

      // Horizontal snaps (X position)
      // Snap to right of other box (with gap)
      xSnaps.push({ target: otherBox.x + otherWidth + GAP, dist: Math.abs(x - (otherBox.x + otherWidth + GAP)) });
      // Snap to left of other box (with gap)
      xSnaps.push({ target: otherBox.x - boxWidth - GAP, dist: Math.abs(x - (otherBox.x - boxWidth - GAP)) });
      // Align left edges
      xSnaps.push({ target: otherBox.x, dist: Math.abs(x - otherBox.x) });
      // Align right edges
      xSnaps.push({ target: otherBox.x + otherWidth - boxWidth, dist: Math.abs(x - (otherBox.x + otherWidth - boxWidth)) });
      // Align centers horizontally
      const otherCenterX = otherBox.x + otherWidth / 2;
      const centerSnapX = otherCenterX - boxWidth / 2;
      xSnaps.push({ target: centerSnapX, dist: Math.abs(x - centerSnapX) });

      // Vertical snaps (Y position)
      // Snap below other box (with gap)
      ySnaps.push({ target: otherBox.y + otherHeight + GAP, dist: Math.abs(y - (otherBox.y + otherHeight + GAP)) });
      // Snap above other box (with gap)
      ySnaps.push({ target: otherBox.y - boxHeight - GAP, dist: Math.abs(y - (otherBox.y - boxHeight - GAP)) });
      // Align top edges (same row)
      ySnaps.push({ target: otherBox.y, dist: Math.abs(y - otherBox.y) });
      // Align bottom edges
      ySnaps.push({ target: otherBox.y + otherHeight - boxHeight, dist: Math.abs(y - (otherBox.y + otherHeight - boxHeight)) });
      // Align centers vertically
      const otherCenterY = otherBox.y + otherHeight / 2;
      const centerSnapY = otherCenterY - boxHeight / 2;
      ySnaps.push({ target: centerSnapY, dist: Math.abs(y - centerSnapY) });
    });

    // Find closest X snap within threshold
    const closestXSnap = xSnaps.filter(s => s.dist < SNAP_THRESHOLD).sort((a, b) => a.dist - b.dist)[0];
    if (closestXSnap) {
      x = closestXSnap.target;
      snappedX = true;
    }

    // Find closest Y snap within threshold
    const closestYSnap = ySnaps.filter(s => s.dist < SNAP_THRESHOLD).sort((a, b) => a.dist - b.dist)[0];
    if (closestYSnap) {
      y = closestYSnap.target;
      snappedY = true;
    }

    // Ensure non-negative
    x = Math.max(0, x);
    y = Math.max(0, y);

    const updatedBoxes = lineBoxes.map(box =>
      box.id === boxId ? { ...box, x, y } : box
    );
    onUpdateLayout({ ...layout, lineBoxes: updatedBoxes });
  };

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if ((e.key === 'Delete' || e.key === 'Backspace') && selectedId) {
        e.preventDefault();
        if (selectedId.startsWith('box_')) {
          onUpdateLayout({
            ...layout,
            lineBoxes: lineBoxes.filter(b => b.id !== selectedId)
          });
        } else if (selectedId.startsWith('wall_')) {
          onUpdateLayout({
            ...layout,
            walls: walls.filter(w => w.id !== selectedId)
          });
        } else if (selectedId.startsWith('label_')) {
          onUpdateLayout({
            ...layout,
            labels: labels.filter(l => l.id !== selectedId)
          });
        }
        setSelectedId(null);
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [selectedId, layout, lineBoxes, walls, labels, onUpdateLayout, setSelectedId]);

  const getLineForBox = (box) => lines.find(l => l.id === box.lineId);

  // Prevent browser zoom on wheel
  const handleWheel = (e) => {
    // Only prevent if ctrl/cmd is pressed (browser zoom gesture)
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
    }
  };

  return (
    <div
      className="factory-canvas-container"
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onWheel={handleWheel}
    >
      <svg
        ref={svgRef}
        className="factory-canvas"
        width={width * zoom}
        height={height * zoom}
        viewBox={`0 0 ${width} ${height}`}
        style={{
          cursor: activeTool === 'wall' || activeTool === 'rectangle' ? 'crosshair' :
            activeTool === 'label' ? 'text' : 'default'
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <defs>
          <pattern
            id="grid"
            width="20"
            height="20"
            patternUnits="userSpaceOnUse"
          >
            <path
              d="M 20 0 L 0 0 0 20"
              fill="none"
              stroke="var(--border-color)"
              strokeWidth="0.5"
              opacity="0.3"
            />
          </pattern>
        </defs>

        {/* Grid background */}
        <rect
          className="canvas-bg"
          x="0"
          y="0"
          width={width}
          height={height}
          fill="var(--bg-secondary)"
        />
        <rect
          x="0"
          y="0"
          width={width}
          height={height}
          fill="url(#grid)"
        />

        {/* Walls/Areas */}
        {walls.map(wall => (
          <WallTool
            key={wall.id}
            wall={wall}
            isSelected={selectedId === wall.id}
            onSelect={setSelectedId}
            onDelete={(id) => {
              onUpdateLayout({
                ...layout,
                walls: walls.filter(w => w.id !== id)
              });
              setSelectedId(null);
            }}
          />
        ))}

        {/* Labels */}
        {labels.map(label => (
          <text
            key={label.id}
            x={label.x}
            y={label.y}
            fill="var(--text-primary)"
            fontSize={label.fontSize || 14}
            style={{ cursor: 'pointer' }}
            onClick={(e) => {
              e.stopPropagation();
              setSelectedId(label.id);
            }}
            className={selectedId === label.id ? 'selected-label' : ''}
          >
            {label.text}
          </text>
        ))}

        {/* Line Boxes */}
        {lineBoxes.map(box => (
          <LineBox
            key={box.id}
            box={box}
            line={getLineForBox(box)}
            isSelected={selectedId === box.id}
            onSelect={setSelectedId}
            onDragEnd={handleLineBoxDragEnd}
            onClick={onLineClick}
            onDoubleClick={onLineDoubleClick}
            isDraggable={isEditMode && activeTool === 'select'}
            isEditMode={isEditMode}
          />
        ))}

        {/* Drawing preview */}
        {isDrawing && drawStart && drawCurrent && (
          activeTool === 'rectangle' ? (
            <rect
              x={Math.min(drawStart.x, drawCurrent.x)}
              y={Math.min(drawStart.y, drawCurrent.y)}
              width={Math.abs(drawCurrent.x - drawStart.x)}
              height={Math.abs(drawCurrent.y - drawStart.y)}
              fill="none"
              stroke="#007bff"
              strokeWidth={2}
              strokeDasharray="5,5"
            />
          ) : (
            <line
              x1={drawStart.x}
              y1={drawStart.y}
              x2={drawCurrent.x}
              y2={drawCurrent.y}
              stroke="#007bff"
              strokeWidth={2}
              strokeDasharray="5,5"
            />
          )
        )}
      </svg>
    </div>
  );
};

export default FactoryCanvas;
