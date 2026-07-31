// shared/components/EditedNote.jsx
//
// Says an entry has been edited, wherever that entry is shown.
//
// The point of allowing edits is that a record can be corrected; the point of
// showing this is that a corrected record still reads honestly. Renders nothing
// for an entry that has never been edited, so an untouched log stays clean.
import { editSummary } from '../utils/editTrail.js';

export default function EditedNote({ entry, className = 'small text-muted' }) {
  const summary = editSummary(entry);
  if (!summary) return null;
  return (
    <div className={className} title={(entry.edits || []).map((e) =>
      `${new Date(e.at).toLocaleString()}${e.by ? ` — ${e.by}` : ''}`).join('\n')}>
      ✎ {summary}
    </div>
  );
}
