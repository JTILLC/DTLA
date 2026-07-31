// src/components/CrewChip.jsx
//
// "This will be logged against Dana and Luis."
//
// Crewing now lives on its own page, which means the person logging work can no
// longer see who it will be attributed to. Silently stamping names an operator
// never saw is how a log ends up confidently wrong, so the names appear next to
// the thing that saves them.
//
// Read-only on purpose. Fixing the crew belongs on the crew page, where it
// applies to every entry for that line rather than to whichever one happened to
// notice.
import { AlertTriangle, Users } from 'lucide-react';
import { crewAge } from '../utils/useLineCrew.js';

export default function CrewChip({ lineCrew, lineTitle }) {
  if (!lineTitle) return null;
  const crew = lineCrew.forLine(lineTitle);
  const age = crewAge(lineCrew.updatedAt);
  const named = [
    crew.operator && `Operator ${crew.operator}`,
    crew.tech && `Maintenance ${crew.tech}`,
    crew.supervisor && `Supervisor ${crew.supervisor}`,
  ].filter(Boolean);

  if (named.length === 0) {
    return (
      <div className="small text-warning-emphasis d-flex align-items-start gap-1">
        <AlertTriangle size={14} className="flex-shrink-0 mt-1" />
        <span>No one crewed on {lineTitle} — this will be logged without names. Set it on the Crew page.</span>
      </div>
    );
  }

  return (
    <div className="small text-muted d-flex align-items-start gap-1">
      <Users size={14} className="flex-shrink-0 mt-1" />
      <span>
        Logging against {named.join(' · ')}
        {age.stale && (
          <span className="text-warning-emphasis"> — crewing {age.label}, check it&apos;s current</span>
        )}
      </span>
    </div>
  );
}
