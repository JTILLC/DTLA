import screenInfo from '../data/screenInfo';
import navmap from '../data/navmap.json';

/**
 * Free-explore side panel: what the current screen is for and what its keys
 * do, with the manual section to read further (Operation Manual for
 * operator screens, Service Manual for the engineering screens).
 */
export default function InfoPanel({ slug, labelJa }) {
  // A state — a pop-up, a chart mode, a wizard step — reads its screen's
  // notes, under its own name.
  const state = navmap.screens[slug]?.parent ? navmap.screens[slug] : null;
  const info = screenInfo[slug] || (state && screenInfo[state.parent]);

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
        {state && <p className="info-state">{state.label}</p>}
        {info.source === 'service' ? (
          <span className="chip" title="Section of the CCW-R Service Manual">
            Service {info.ref.split('/')[0].trim().split(' ')[1]}
          </span>
        ) : info.ref ? (
          <span className="chip" title="Section of the CCW R Operation Manual">
            Manual {info.ref.split('/')[0].trim().split(' ')[0]}
          </span>
        ) : (
          <span className="chip chip--warn">not in the manuals</span>
        )}
      </div>

      {info.ref && (
        <p className="text-xs mb-2" style={{ color: 'var(--text-subtle)' }}>
          Read more: {info.ref} —{' '}
          {info.source === 'service'
            ? 'CCW-R Service Manual'
            : info.ref.includes('Service')
              ? 'CCW R Operation Manual (Service Manual for the Service sections)'
              : 'CCW R Operation Manual'}
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
