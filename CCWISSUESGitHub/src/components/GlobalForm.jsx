const GlobalForm = ({ globalData, setGlobalData, addLine, lines, activeLineId, onPrevious, onNext }) => {
  console.log('Rendering GlobalForm with globalData:', globalData);

  const currentIndex = lines.findIndex(l => l.id === activeLineId);
  const isFirstLine = currentIndex === 0;
  const isLastLine = currentIndex === lines.length - 1;

  return (
    <div className="global-fields" style={{ marginBottom: '20px', display: 'flex', gap: '10px', alignItems: 'center' }}>
      <button onClick={addLine} className="btn btn-primary">
        Add Line
      </button>
      <button
        onClick={onPrevious}
        disabled={!activeLineId || isFirstLine}
        className="btn btn-sm btn-outline-secondary"
      >
        ← Prev
      </button>
      <button
        onClick={onNext}
        disabled={!activeLineId || isLastLine}
        className="btn btn-sm btn-outline-secondary"
      >
        Next →
      </button>
    </div>
  );
};

export default GlobalForm;