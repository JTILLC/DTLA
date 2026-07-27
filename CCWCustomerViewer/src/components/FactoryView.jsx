import { useState, useEffect, useRef, useCallback } from 'react';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';

const DEFAULT_LAYOUT = {
  version: 1,
  canvasSettings: { width: 10000, height: 4000 },
  lineBoxes: [],
  walls: [],
  labels: []
};

// Migrate old single-error format to new multi-issue format
const migrateHeadData = (head) => {
  if (head.issues && Array.isArray(head.issues)) return head;
  const migratedHead = { ...head, issues: [] };
  if (head.error && head.error !== 'None') {
    migratedHead.issues.push({ type: head.error, fixed: head.fixed || 'na', notes: head.notes || '' });
  }
  return migratedHead;
};

const getLineStatus = (line) => {
  if (!line || !line.heads) {
    return { primaryColor: '#6c757d', secondaryColor: null, offlineCount: 0, statusText: 'No data' };
  }

  const migratedHeads = line.heads.map(migrateHeadData);
  const offlineHeads = migratedHeads.filter(h => h.status === 'offline');
  const offlineCount = offlineHeads.length;

  let fixedCount = 0, activeWithIssuesCount = 0, unfixedCount = 0;

  offlineHeads.forEach(head => {
    const issues = head.issues || [];
    if (issues.length === 0) {
      unfixedCount++;
    } else {
      const allFixed = issues.every(i => i.fixed === 'fixed');
      const allActiveWithIssues = issues.every(i => i.fixed === 'active_with_issues');
      const someFixed = issues.some(i => i.fixed === 'fixed' || i.fixed === 'active_with_issues');
      if (allFixed) fixedCount++;
      else if (allActiveWithIssues) activeWithIssuesCount++;
      else if (someFixed && !issues.some(i => i.fixed === 'not_fixed')) activeWithIssuesCount++;
      else unfixedCount++;
    }
  });

  const COLORS = { green: '#28a745', yellow: '#ffc107', blue: '#17a2b8', red: '#dc3545' };
  let primaryColor, secondaryColor = null, statusText;

  if (offlineCount === 0) {
    primaryColor = COLORS.green; statusText = 'All OK';
  } else if (unfixedCount > 0 && (fixedCount > 0 || activeWithIssuesCount > 0)) {
    primaryColor = COLORS.red;
    secondaryColor = activeWithIssuesCount > 0 ? COLORS.blue : COLORS.yellow;
    statusText = `${unfixedCount} unfixed`;
  } else if (unfixedCount > 0) {
    primaryColor = COLORS.red; statusText = `${unfixedCount} not fixed`;
  } else if (activeWithIssuesCount > 0 && fixedCount > 0) {
    primaryColor = COLORS.blue; secondaryColor = COLORS.yellow;
    statusText = `${activeWithIssuesCount} active w/ issues`;
  } else if (activeWithIssuesCount > 0) {
    primaryColor = COLORS.blue; statusText = `${activeWithIssuesCount} active w/ issues`;
  } else if (fixedCount > 0) {
    primaryColor = COLORS.yellow; statusText = `${fixedCount} fixed`;
  } else {
    primaryColor = COLORS.green; statusText = 'All OK';
  }

  return { primaryColor, secondaryColor, offlineCount, statusText };
};

// Read-only Wall/Rectangle renderer
const Wall = ({ wall }) => {
  if (wall.type === 'rectangle') {
    const [start, end] = wall.points;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const w = Math.abs(end.x - start.x);
    const h = Math.abs(end.y - start.y);
    return (
      <g>
        <rect x={x} y={y} width={w} height={h} fill="none"
          stroke={wall.stroke || 'var(--text-secondary)'} strokeWidth={wall.strokeWidth || 2}
          strokeDasharray={wall.dashed ? '5,5' : 'none'} />
        {wall.label && (
          <text x={x + w / 2} y={y - 5} textAnchor="middle" fill="var(--text-primary)"
            fontSize={12} style={{ pointerEvents: 'none' }}>{wall.label}</text>
        )}
      </g>
    );
  }
  if (wall.type === 'line' && wall.points.length >= 2) {
    const [start, end] = wall.points;
    return (
      <g>
        <line x1={start.x} y1={start.y} x2={end.x} y2={end.y}
          stroke={wall.stroke || 'var(--text-secondary)'} strokeWidth={wall.strokeWidth || 2}
          strokeLinecap="round" />
        {wall.label && (
          <text x={(start.x + end.x) / 2} y={(start.y + end.y) / 2 - 10} textAnchor="middle"
            fill="var(--text-primary)" fontSize={12} style={{ pointerEvents: 'none' }}>{wall.label}</text>
        )}
      </g>
    );
  }
  return null;
};

// Read-only LineBox renderer
const LineBox = ({ box, line, onClick }) => {
  const { primaryColor, secondaryColor, offlineCount, statusText } = getLineStatus(line);
  const displayName = line?.title || box.lineName || 'Unknown Line';
  const headCount = line?.heads?.length || 0;
  const boxWidth = box.width || 120;
  const boxHeight = box.height || 80;

  return (
    <g
      transform={`translate(${box.x}, ${box.y})`}
      style={{ cursor: 'pointer' }}
      onClick={() => onClick?.(box.lineId)}
    >
      {secondaryColor ? (
        <>
          <rect x={0} y={0} width={boxWidth / 2} height={boxHeight} rx={8} ry={8}
            fill={primaryColor} stroke="var(--border-color)" strokeWidth={1} opacity={0.9}
            clipPath="inset(0 50% 0 0 round 8px)" />
          <rect x={boxWidth / 2} y={0} width={boxWidth / 2} height={boxHeight} rx={8} ry={8}
            fill={secondaryColor} stroke="var(--border-color)" strokeWidth={1} opacity={0.9}
            clipPath="inset(0 0 0 50% round 8px)" />
          <rect x={0} y={0} width={boxWidth} height={boxHeight} rx={8} ry={8}
            fill="none" stroke="var(--border-color)" strokeWidth={1} />
        </>
      ) : (
        <rect width={boxWidth} height={boxHeight} rx={8} ry={8}
          fill={primaryColor} stroke="var(--border-color)" strokeWidth={1} opacity={0.9} />
      )}

      <text x={boxWidth / 2} y={22} textAnchor="middle" fill="white" fontWeight="bold"
        fontSize={14} style={{ pointerEvents: 'none', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>
        {displayName}
      </text>
      <text x={boxWidth / 2} y={40} textAnchor="middle" fill="white" fontSize={11} opacity={0.9}
        style={{ pointerEvents: 'none', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>
        {headCount} heads
      </text>
      <text x={boxWidth / 2} y={58} textAnchor="middle" fill="white" fontSize={10}
        style={{ pointerEvents: 'none', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}>
        {statusText}
      </text>

      {offlineCount > 0 && (
        <g transform={`translate(${boxWidth - 15}, 5)`}>
          <circle r={12} fill="#fff" stroke={primaryColor} strokeWidth={2} />
          <text textAnchor="middle" dominantBaseline="central" fill={primaryColor}
            fontWeight="bold" fontSize={11} style={{ pointerEvents: 'none' }}>
            {offlineCount}
          </text>
        </g>
      )}
    </g>
  );
};

const FactoryView = ({ shareData, lines, visitId, onSelectLine }) => {
  const [layout, setLayout] = useState(null);
  const [loading, setLoading] = useState(true);
  const [zoom, setZoom] = useState(1);
  const containerRef = useRef(null);

  // Load factory layout from Firebase
  useEffect(() => {
    const loadLayout = async () => {
      if (!shareData) return;
      setLoading(true);

      const { userId, customerId } = shareData;

      try {
        // Try visit-specific layout first
        if (visitId) {
          const visitRef = doc(db, 'user_files', userId, 'customers', customerId, 'factoryLayout', `visit_${visitId}`);
          const visitSnap = await getDoc(visitRef);
          if (visitSnap.exists()) {
            setLayout({ ...DEFAULT_LAYOUT, ...visitSnap.data(), canvasSettings: { ...DEFAULT_LAYOUT.canvasSettings } });
            setLoading(false);
            return;
          }
        }

        // Fall back to default layout
        const defaultRef = doc(db, 'user_files', userId, 'customers', customerId, 'factoryLayout', 'default');
        const defaultSnap = await getDoc(defaultRef);
        if (defaultSnap.exists()) {
          setLayout({ ...DEFAULT_LAYOUT, ...defaultSnap.data(), canvasSettings: { ...DEFAULT_LAYOUT.canvasSettings } });
        } else {
          setLayout(null);
        }
      } catch (err) {
        console.error('Error loading factory layout:', err);
        setLayout(null);
      }

      setLoading(false);
    };

    loadLayout();
  }, [shareData, visitId]);

  // Auto-fit zoom to container on load
  useEffect(() => {
    if (!layout || !containerRef.current) return;
    const containerWidth = containerRef.current.clientWidth;
    if (containerWidth > 0) {
      // Find bounding box of all elements
      const allX = [], allY = [];
      (layout.lineBoxes || []).forEach(b => {
        allX.push(b.x, b.x + (b.width || 120));
        allY.push(b.y, b.y + (b.height || 80));
      });
      (layout.walls || []).forEach(w => {
        w.points.forEach(p => { allX.push(p.x); allY.push(p.y); });
      });
      (layout.labels || []).forEach(l => { allX.push(l.x); allY.push(l.y); });

      if (allX.length > 0) {
        const maxX = Math.max(...allX) + 40;
        const maxY = Math.max(...allY) + 40;
        const fitZoom = Math.min(containerWidth / maxX, 1);
        setZoom(Math.max(0.3, Math.min(fitZoom, 1)));
      }
    }
  }, [layout]);

  const handleLineClick = (lineId) => {
    const line = lines.find(l => l.id === lineId);
    if (line) {
      onSelectLine(line);
    }
  };

  if (loading) {
    return (
      <div className="text-center py-5">
        <div className="spinner-border text-primary" role="status">
          <span className="visually-hidden">Loading...</span>
        </div>
        <p className="mt-3 text-muted">Loading factory layout...</p>
      </div>
    );
  }

  if (!layout || (layout.lineBoxes.length === 0 && layout.walls.length === 0 && layout.labels.length === 0)) {
    return (
      <div className="text-center py-5">
        <p className="text-muted">No factory layout has been configured for this customer yet.</p>
      </div>
    );
  }

  const { canvasSettings, lineBoxes = [], walls = [], labels = [] } = layout;
  const { width, height } = canvasSettings;

  return (
    <div>
      {/* Zoom controls */}
      <div className="d-flex align-items-center gap-2 mb-3">
        <span className="small text-muted">Zoom:</span>
        <button className="btn btn-sm btn-outline-secondary" onClick={() => setZoom(z => Math.max(0.25, z - 0.1))}>-</button>
        <span className="small" style={{ minWidth: 40, textAlign: 'center' }}>{Math.round(zoom * 100)}%</span>
        <button className="btn btn-sm btn-outline-secondary" onClick={() => setZoom(z => Math.min(2, z + 0.1))}>+</button>
        <button className="btn btn-sm btn-outline-secondary" onClick={() => setZoom(1)}>Reset</button>
        <span className="small text-muted ms-3">Click a line to view details</span>
      </div>

      {/* Canvas */}
      <div ref={containerRef} className="factory-view-container" style={{ overflow: 'auto', border: '1px solid var(--border-color)', borderRadius: 8, background: 'var(--bg-secondary)' }}>
        <svg
          width={width * zoom}
          height={height * zoom}
          viewBox={`0 0 ${width} ${height}`}
          style={{ display: 'block' }}
        >
          <defs>
            <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
              <path d="M 20 0 L 0 0 0 20" fill="none" stroke="var(--border-color)" strokeWidth="0.5" opacity="0.3" />
            </pattern>
          </defs>

          <rect x="0" y="0" width={width} height={height} fill="var(--bg-secondary)" />
          <rect x="0" y="0" width={width} height={height} fill="url(#grid)" />

          {walls.map(wall => <Wall key={wall.id} wall={wall} />)}

          {labels.map(label => (
            <text key={label.id} x={label.x} y={label.y} fill="var(--text-primary)"
              fontSize={label.fontSize || 14}>
              {label.text}
            </text>
          ))}

          {lineBoxes.map(box => {
            const line = lines.find(l => l.id === box.lineId);
            return <LineBox key={box.id} box={box} line={line} onClick={handleLineClick} />;
          })}
        </svg>
      </div>
    </div>
  );
};

export default FactoryView;
