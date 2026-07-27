import { AUDIT_SECTIONS } from '../config/constants';

// On-screen machine audit checklist. Each item is Good / Bad / N-A (mutually
// exclusive — click the active one again to clear) plus a free-text note.
export default function Audit({ audit = {}, onChange, notes = '', onNotesChange }) {
  const setStatus = (label, status) => {
    const current = audit[label]?.status;
    onChange(label, 'status', current === status ? '' : status);
  };
  const setNote = (label, note) => onChange(label, 'note', note);

  return (
    <div className="audit-section" style={{ marginTop: '10px' }}>
      {AUDIT_SECTIONS.map((section) => (
        <table key={section.title} className="audit-table mobile-cards" style={{ width: '100%', borderCollapse: 'collapse', marginBottom: '12px' }}>
          <thead>
            <tr style={{ background: '#111', color: '#fff' }}>
              <th style={{ textAlign: 'left', padding: '4px 6px' }}>{section.title}</th>
              <th style={{ width: '50px' }}>Good</th>
              <th style={{ width: '50px' }}>Bad</th>
              <th style={{ width: '50px' }}>N/A</th>
              <th style={{ textAlign: 'left', padding: '4px 6px' }}>Notes</th>
            </tr>
          </thead>
          <tbody>
            {section.items.map((label) => {
              const row = audit[label] || {};
              return (
                <tr key={label} style={{ borderBottom: '1px solid #ddd' }}>
                  <td className="audit-item" style={{ padding: '3px 6px' }}>{label}</td>
                  {[['good', 'Good'], ['bad', 'Bad'], ['na', 'N/A']].map(([st, lbl]) => (
                    <td key={st} data-label={lbl} style={{ textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={row.status === st}
                        onChange={() => setStatus(label, st)}
                        aria-label={`${label} ${lbl}`}
                      />
                    </td>
                  ))}
                  <td data-label="Notes" style={{ padding: '3px 6px' }}>
                    <input
                      type="text"
                      value={row.note || ''}
                      onChange={(e) => setNote(label, e.target.value)}
                      style={{ width: '100%' }}
                    />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ))}
      <div style={{ marginTop: '8px' }}>
        <label style={{ fontWeight: 600, display: 'block' }}>Audit Notes</label>
        <textarea
          rows="4"
          value={notes}
          onChange={(e) => onNotesChange(e.target.value)}
          style={{ width: '100%' }}
        />
      </div>
    </div>
  );
}
