import { getLineStatus } from './LineBox';

const LineBoxPalette = ({
  lines,
  placedLineIds,
  onDragStart
}) => {
  // Filter out lines that are already placed
  const availableLines = lines.filter(line => !placedLineIds.includes(line.id));

  const handleDragStart = (e, line) => {
    e.dataTransfer.setData('application/json', JSON.stringify({
      type: 'line',
      lineId: line.id,
      lineName: line.title
    }));
    e.dataTransfer.effectAllowed = 'copy';
    onDragStart?.(line);
  };

  if (availableLines.length === 0) {
    return (
      <div className="line-palette">
        <h6 className="palette-title">Available Lines</h6>
        <p className="palette-empty">All lines placed</p>
      </div>
    );
  }

  return (
    <div className="line-palette">
      <h6 className="palette-title">Available Lines</h6>
      <p className="palette-hint">Drag lines onto the canvas</p>
      <div className="palette-items">
        {availableLines.map(line => {
          const { primaryColor, secondaryColor, offlineCount, statusText } = getLineStatus(line);
          const headCount = line.heads?.length || 0;

          return (
            <div
              key={line.id}
              className="palette-item"
              draggable
              onDragStart={(e) => handleDragStart(e, line)}
              style={{
                borderLeftColor: primaryColor,
                background: secondaryColor
                  ? `linear-gradient(90deg, ${primaryColor} 50%, ${secondaryColor} 50%)`
                  : undefined
              }}
            >
              <div className="palette-item-header">
                <span className="palette-item-name">{line.title}</span>
                <span
                  className="palette-item-status"
                  style={{ backgroundColor: primaryColor }}
                />
              </div>
              <div className="palette-item-info">
                <span>{headCount} heads</span>
                {offlineCount > 0 && (
                  <span style={{ color: primaryColor }}>
                    {statusText}
                  </span>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default LineBoxPalette;
