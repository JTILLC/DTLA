const WallTool = ({
  wall,
  isSelected,
  onSelect,
  onDelete
}) => {
  const handleClick = (e) => {
    e.stopPropagation();
    onSelect?.(wall.id);
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Delete' || e.key === 'Backspace') {
      onDelete?.(wall.id);
    }
  };

  if (wall.type === 'rectangle') {
    const [start, end] = wall.points;
    const x = Math.min(start.x, end.x);
    const y = Math.min(start.y, end.y);
    const width = Math.abs(end.x - start.x);
    const height = Math.abs(end.y - start.y);

    return (
      <g
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{ outline: 'none' }}
        className="wall-element"
      >
        <rect
          x={x}
          y={y}
          width={width}
          height={height}
          fill="none"
          stroke={isSelected ? '#007bff' : (wall.stroke || 'var(--text-secondary)')}
          strokeWidth={isSelected ? 3 : (wall.strokeWidth || 2)}
          strokeDasharray={wall.dashed ? '5,5' : 'none'}
          style={{ cursor: 'pointer' }}
        />
        {wall.label && (
          <text
            x={x + width / 2}
            y={y - 5}
            textAnchor="middle"
            fill="var(--text-primary)"
            fontSize={12}
            style={{ pointerEvents: 'none' }}
          >
            {wall.label}
          </text>
        )}
      </g>
    );
  }

  // Line type
  if (wall.type === 'line' && wall.points.length >= 2) {
    const [start, end] = wall.points;

    return (
      <g
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        tabIndex={0}
        style={{ outline: 'none' }}
        className="wall-element"
      >
        <line
          x1={start.x}
          y1={start.y}
          x2={end.x}
          y2={end.y}
          stroke={isSelected ? '#007bff' : (wall.stroke || 'var(--text-secondary)')}
          strokeWidth={isSelected ? 3 : (wall.strokeWidth || 2)}
          strokeLinecap="round"
          style={{ cursor: 'pointer' }}
        />
        {wall.label && (
          <text
            x={(start.x + end.x) / 2}
            y={(start.y + end.y) / 2 - 10}
            textAnchor="middle"
            fill="var(--text-primary)"
            fontSize={12}
            style={{ pointerEvents: 'none' }}
          >
            {wall.label}
          </text>
        )}
      </g>
    );
  }

  return null;
};

export default WallTool;
