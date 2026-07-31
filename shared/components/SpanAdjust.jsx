const SpanAdjust = ({ heads, updateHeadWeight }) => {
  return (
    <table className="mobile-cards">
      <thead>
        <tr>
          <th>Head #</th>
          <th>Current Weight</th>
          <th>Span Weight</th>
          <th>Difference</th>
        </tr>
      </thead>
      <tbody>
        {heads.map((head, i) => (
          <tr key={i}>
            <td data-label="Head #">{i + 1}</td>
            {/* Show 0 as an EMPTY field. Rendering the stored 0 meant you had to
                delete it before typing, and typing into it read "05" until the
                re-render caught up. Blank is also the honest state: nothing
                measured yet. */}
            <td data-label="Current Weight">
              <input
                type="number"
                step="any"
                inputMode="decimal"
                value={head.currentWeight || ''}
                placeholder="0"
                onChange={(e) => updateHeadWeight(i, 'currentWeight', e.target.value)}
              />
            </td>
            <td data-label="Span Weight">
              <input
                type="number"
                step="any"
                inputMode="decimal"
                value={head.spanWeight || ''}
                placeholder="0"
                onChange={(e) => updateHeadWeight(i, 'spanWeight', e.target.value)}
              />
            </td>
            <td data-label="Difference">{(Math.round((Number(head.weightDifference) || 0) * 10) / 10).toFixed(1)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default SpanAdjust;