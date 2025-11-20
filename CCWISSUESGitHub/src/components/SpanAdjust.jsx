const SpanAdjust = ({ heads, updateHeadWeight }) => {
  return (
    <table>
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
            <td data-label="Current Weight">
              <input type="number" step="any" value={head.currentWeight} onChange={(e) => updateHeadWeight(i, 'currentWeight', e.target.value)} />
            </td>
            <td data-label="Span Weight">
              <input type="number" step="any" value={head.spanWeight} onChange={(e) => updateHeadWeight(i, 'spanWeight', e.target.value)} />
            </td>
            <td data-label="Difference">{head.weightDifference.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

export default SpanAdjust;