import React, { useEffect, useRef, useState } from 'react';
import { renderScreen, loadImage, displayValue } from '../utils/overlay';

/**
 * One RCU screen we hold artwork for: a form on one side, and the real screen
 * with the typed values drawn into its own boxes on the other.
 *
 * The preview is the point. A table of numbers is easy to get subtly wrong and
 * hard to check; a picture of the screen the operator is about to look at is
 * checkable at a glance.
 */
export default function MappedScreen({ screen, slug, values, onChange, onRemove }) {
  const canvasRef = useRef(null);
  const [image, setImage] = useState(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    loadImage(`${import.meta.env.BASE_URL}screens/${slug}.jpg`)
      .then((img) => { if (live) setImage(img); })
      .catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [slug]);

  useEffect(() => {
    if (!image || !canvasRef.current) return;
    const { canvas } = renderScreen(image, screen.fields, values);
    const target = canvasRef.current;
    target.width = canvas.width;
    target.height = canvas.height;
    target.getContext('2d').drawImage(canvas, 0, 0);
  }, [image, screen, values]);

  const set = (key, value) => onChange({ ...values, [key]: value });

  return (
    <section className="card p-4 mb-4">
      <header className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h3 className="font-semibold">{screen.title}</h3>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Operation Manual {screen.manual}
            {screen.tab ? ` · ${screen.tab} tab` : ''}
          </p>
        </div>
        <button type="button" className="btn" onClick={onRemove}>Remove</button>
      </header>

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2 content-start">
          {screen.fields.map((field) => (
            <div key={field.key}>
              <label className="field-label" htmlFor={`${slug}-${field.key}`}>
                {field.label}
                {field.disabledOnScreen && (
                  <span className="chip ml-1">greyed out on this screen</span>
                )}
              </label>
              <div className="flex items-center gap-1">
                <input
                  id={`${slug}-${field.key}`}
                  className="field"
                  value={values?.[field.key] ?? ''}
                  placeholder={field.sample || ''}
                  onChange={(e) => set(field.key, e.target.value)}
                />
                {field.unit && (
                  <span className="text-xs" style={{ color: 'var(--text-muted)' }}>
                    {field.unit}
                  </span>
                )}
              </div>
            </div>
          ))}
        </div>

        <div>
          <p className="field-label">As the operator will see it</p>
          {failed ? (
            <p className="text-sm" style={{ color: 'var(--danger)' }}>
              Could not load this screen’s artwork.
            </p>
          ) : (
            <canvas
              ref={canvasRef}
              className="w-full h-auto rounded border"
              style={{ borderColor: 'var(--border)' }}
            />
          )}
          <p className="text-xs mt-2" style={{ color: 'var(--text-subtle)' }}>
            Fields you leave blank keep the sample machine’s values and are listed
            as not recorded on the front page.
          </p>
        </div>
      </div>
    </section>
  );
}

/** The rows this screen contributes to the printed document. */
export function mappedRows(screen, values) {
  return screen.fields
    .map((f) => ({ label: f.label, value: displayValue(values?.[f.key], f.unit) }))
    .filter((r) => r.value);
}
