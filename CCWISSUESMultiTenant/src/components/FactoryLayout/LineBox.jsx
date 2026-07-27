import { useState, useRef, useEffect, useCallback } from 'react';

// Migrate old single-error format to new multi-issue format (same as Line.jsx)
const migrateHeadData = (head) => {
  // If already has issues array, return as-is
  if (head.issues && Array.isArray(head.issues)) {
    return head;
  }

  // Convert old format to new format
  const migratedHead = {
    ...head,
    issues: []
  };

  // If there was an old error field and it wasn't "None", convert it
  if (head.error && head.error !== 'None') {
    migratedHead.issues.push({
      type: head.error,
      fixed: head.fixed || 'na',
      notes: head.notes || ''
    });
  }

  return migratedHead;
};

const getLineStatus = (line) => {
  if (!line || !line.heads) {
    return {
      primaryColor: '#6c757d',
      secondaryColor: null,
      offlineCount: 0,
      fixedCount: 0,
      activeWithIssuesCount: 0,
      unfixedCount: 0,
      status: 'unknown',
      statusText: 'No data'
    };
  }

  // Migrate all heads to new format first
  const migratedHeads = line.heads.map(migrateHeadData);

  const offlineHeads = migratedHeads.filter(h => h.status === 'offline');
  const offlineCount = offlineHeads.length;

  
  // Count status among offline heads
  let fixedCount = 0;
  let activeWithIssuesCount = 0;
  let unfixedCount = 0;

  offlineHeads.forEach(head => {
    const issues = head.issues || [];
    if (issues.length === 0) {
      // No issues logged, consider unfixed
      unfixedCount++;
    } else {
      // Check the status of all issues
      const allFixed = issues.every(i => i.fixed === 'fixed');
      const allActiveWithIssues = issues.every(i => i.fixed === 'active_with_issues');
      const someFixed = issues.some(i => i.fixed === 'fixed' || i.fixed === 'active_with_issues');

      if (allFixed) {
        fixedCount++;
      } else if (allActiveWithIssues) {
        activeWithIssuesCount++;
      } else if (someFixed && !issues.some(i => i.fixed === 'not_fixed')) {
        // All issues are either fixed or active_with_issues
        activeWithIssuesCount++;
      } else {
        unfixedCount++;
      }
    }
  });

  let primaryColor, secondaryColor = null, status, statusText;

  // Color priority: Red (unfixed) > Blue (active with issues) > Yellow (fixed) > Green (ok)
  const COLORS = {
    green: '#28a745',
    yellow: '#ffc107',
    blue: '#17a2b8',
    red: '#dc3545'
  };

  if (offlineCount === 0) {
    // No offline heads - all OK
    primaryColor = COLORS.green;
    status = 'ok';
    statusText = 'All OK';
  } else if (unfixedCount > 0 && (fixedCount > 0 || activeWithIssuesCount > 0)) {
    // Mix: some unfixed, some fixed/active-with-issues - split color
    primaryColor = COLORS.red;
    secondaryColor = activeWithIssuesCount > 0 ? COLORS.blue : COLORS.yellow;
    status = 'partial';
    statusText = `${unfixedCount} unfixed`;
  } else if (unfixedCount > 0) {
    // All unfixed
    primaryColor = COLORS.red;
    status = 'unfixed';
    statusText = `${unfixedCount} not fixed`;
  } else if (activeWithIssuesCount > 0 && fixedCount > 0) {
    // Mix of active-with-issues and fixed
    primaryColor = COLORS.blue;
    secondaryColor = COLORS.yellow;
    status = 'mixed-resolved';
    statusText = `${activeWithIssuesCount} active w/ issues`;
  } else if (activeWithIssuesCount > 0) {
    // All active with issues
    primaryColor = COLORS.blue;
    status = 'active-with-issues';
    statusText = `${activeWithIssuesCount} active w/ issues`;
  } else if (fixedCount > 0) {
    // All fixed
    primaryColor = COLORS.yellow;
    status = 'all-fixed';
    statusText = `${fixedCount} fixed`;
  } else {
    primaryColor = COLORS.green;
    status = 'ok';
    statusText = 'All OK';
  }

  return {
    primaryColor,
    secondaryColor,
    offlineCount,
    fixedCount,
    activeWithIssuesCount,
    unfixedCount,
    status,
    statusText
  };
};

const LineBox = ({
  box,
  line,
  isSelected,
  onSelect,
  onDragEnd,
  onClick,
  onDoubleClick,
  isDraggable = true,
  isEditMode = true
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const dragOffsetRef = useRef({ x: 0, y: 0 });
  const elementRef = useRef(null);

  const { primaryColor, secondaryColor, offlineCount, activeWithIssuesCount, unfixedCount, statusText } = getLineStatus(line);
  // Active with Issues is treated like fixed (head is running) - exclude from offline badge count
  const badgeCount = offlineCount - activeWithIssuesCount;
  const displayName = line?.title || box.lineName || 'Unknown Line';
  const headCount = line?.heads?.length || 0;

  const handleMouseDown = (e) => {
    if (e.button !== 0) return;
    e.stopPropagation();

    // In navigate mode, single click navigates
    if (!isEditMode) {
      onClick?.(box.lineId);
      return;
    }

    // In edit mode, handle selection and dragging
    if (!isDraggable) return;
    e.preventDefault();

    const rect = elementRef.current.getBoundingClientRect();
    dragOffsetRef.current = {
      x: e.clientX - rect.left,
      y: e.clientY - rect.top
    };
    setIsDragging(true);
    onSelect?.(box.id);
  };

  const handleMouseMove = useCallback((e) => {
    if (!elementRef.current) return;

    const svg = elementRef.current.closest('svg');
    if (!svg) return;

    const svgRect = svg.getBoundingClientRect();
    const viewBox = svg.viewBox.baseVal;
    const scaleX = viewBox.width / svgRect.width;
    const scaleY = viewBox.height / svgRect.height;

    const newX = (e.clientX - svgRect.left) * scaleX - dragOffsetRef.current.x;
    const newY = (e.clientY - svgRect.top) * scaleY - dragOffsetRef.current.y;

    onDragEnd?.(box.id, { x: Math.max(0, newX), y: Math.max(0, newY) });
  }, [box.id, onDragEnd]);

  const handleMouseUp = useCallback(() => {
    setIsDragging(false);
  }, []);

  const handleDoubleClick = (e) => {
    e.stopPropagation();
    onDoubleClick?.(box.lineId);
  };

  useEffect(() => {
    if (isDragging) {
      window.addEventListener('mousemove', handleMouseMove);
      window.addEventListener('mouseup', handleMouseUp);

      return () => {
        window.removeEventListener('mousemove', handleMouseMove);
        window.removeEventListener('mouseup', handleMouseUp);
      };
    }
  }, [isDragging, handleMouseMove, handleMouseUp]);

  const boxWidth = box.width || 120;
  const boxHeight = box.height || 80;

  return (
    <g
      ref={elementRef}
      transform={`translate(${box.x}, ${box.y})`}
      style={{ cursor: isEditMode ? (isDraggable ? 'move' : 'default') : 'pointer' }}
      onMouseDown={handleMouseDown}
      onDoubleClick={handleDoubleClick}
      className="line-box"
    >
      {/* Main box - split color if partial */}
      {secondaryColor ? (
        <>
          {/* Left half - unfixed (red) */}
          <rect
            x={0}
            y={0}
            width={boxWidth / 2}
            height={boxHeight}
            rx={8}
            ry={8}
            fill={primaryColor}
            stroke={isSelected ? '#007bff' : 'var(--border-color)'}
            strokeWidth={isSelected ? 3 : 1}
            opacity={0.9}
            clipPath="inset(0 50% 0 0 round 8px)"
          />
          {/* Right half - fixed (yellow) */}
          <rect
            x={boxWidth / 2}
            y={0}
            width={boxWidth / 2}
            height={boxHeight}
            rx={8}
            ry={8}
            fill={secondaryColor}
            stroke={isSelected ? '#007bff' : 'var(--border-color)'}
            strokeWidth={isSelected ? 3 : 1}
            opacity={0.9}
            clipPath="inset(0 0 0 50% round 8px)"
          />
          {/* Border overlay for clean edges */}
          <rect
            x={0}
            y={0}
            width={boxWidth}
            height={boxHeight}
            rx={8}
            ry={8}
            fill="none"
            stroke={isSelected ? '#007bff' : 'var(--border-color)'}
            strokeWidth={isSelected ? 3 : 1}
          />
        </>
      ) : (
        <rect
          width={boxWidth}
          height={boxHeight}
          rx={8}
          ry={8}
          fill={primaryColor}
          stroke={isSelected ? '#007bff' : 'var(--border-color)'}
          strokeWidth={isSelected ? 3 : 1}
          opacity={0.9}
        />
      )}

      {/* Line name */}
      <text
        x={boxWidth / 2}
        y={22}
        textAnchor="middle"
        fill="white"
        fontWeight="bold"
        fontSize={14}
        style={{ pointerEvents: 'none', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}
      >
        {displayName}
      </text>

      {/* Head count */}
      <text
        x={boxWidth / 2}
        y={40}
        textAnchor="middle"
        fill="white"
        fontSize={11}
        opacity={0.9}
        style={{ pointerEvents: 'none', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}
      >
        {headCount} heads
      </text>

      {/* Status info */}
      <text
        x={boxWidth / 2}
        y={58}
        textAnchor="middle"
        fill="white"
        fontSize={10}
        style={{ pointerEvents: 'none', textShadow: '1px 1px 2px rgba(0,0,0,0.5)' }}
      >
        {statusText}
      </text>

      {/* Badge for offline count (excludes active-with-issues heads) */}
      {badgeCount > 0 && (
        <g transform={`translate(${boxWidth - 15}, 5)`}>
          <circle
            r={12}
            fill="#fff"
            stroke={primaryColor}
            strokeWidth={2}
          />
          <text
            textAnchor="middle"
            dominantBaseline="central"
            fill={primaryColor}
            fontWeight="bold"
            fontSize={11}
            style={{ pointerEvents: 'none' }}
          >
            {badgeCount}
          </text>
        </g>
      )}
    </g>
  );
};

export default LineBox;
export { getLineStatus };
