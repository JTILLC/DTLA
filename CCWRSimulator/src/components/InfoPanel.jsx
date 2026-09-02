import screenInfo from '../data/screenInfo';

/**
 * Free-explore side panel: what the current screen is for and what its keys
 * do, with the Operation Manual section to read further.
 */
export default function InfoPanel({ slug, labelJa }) {
  const info = screenInfo[slug];

  if (!info) {
    return (
      <div className="side-panel__body">
        <h2>{slug}</h2>
        <p className="info-summary">No training notes for this screen yet.</p>
      </div>
    );
  }

  return (
    <div className="side-panel__body">
      <div className="panel-heading">
        <h2>{info.title}</h2>
        {info.ref ? (
          <span className="chip" title="Section of the CCW R Operation Manual">
            Manual {info.ref.split('/')[0].trim().split(' ')[0]}
          </span>
        ) : (
          <span className="chip chip--warn">not in Operation Manual</span>
        )}
      </div>

      {info.ref && (
        <p className="text-xs mb-2" style={{ color: 'var(--text-subtle)' }}>
          Read more: {info.ref} — CCW R Operation Manual
        </p>
      )}

      <p className="info-summary">{info.summary}</p>

      {info.keys?.length > 0 && (
        <dl className="key-list">
          {info.keys.map((k) => (
            <div key={k.name}>
              <dt>{k.name}</dt>
              <dd>{k.desc}</dd>
            </div>
          ))}
        </dl>
      )}

      {info.note && <div className="note-box">{info.note}</div>}

      {labelJa && (
        <p className="mt-3 text-xs" style={{ color: 'var(--text-subtle)' }}>
          Original frame label: {labelJa}
        </p>
      )}
    </div>
  );
}
