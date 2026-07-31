// src/components/CrewLine.jsx
//
// Who was on when an entry was logged. Rendered only when there is something to
// say — entries from before the crew roster existed carry none of these fields,
// and an empty "Operator: —  Maintenance: —" line is worse than no line.
export default function CrewLine({ entry }) {
  const parts = [
    entry?.operator && `Operator ${entry.operator}`,
    entry?.tech && `Maintenance ${entry.tech}`,
    entry?.supervisor && `Supervisor ${entry.supervisor}`,
  ].filter(Boolean);
  if (parts.length === 0) return null;
  return <div className="small text-muted">{parts.join(' · ')}</div>;
}
