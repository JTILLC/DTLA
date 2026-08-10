// shared/components/SetupLinesModal.jsx
//
// Where a plant's lines get built and put in the right order.
//
// Two jobs in one screen because they are the same job at different times: on
// day one you are adding the lines, a month later you are moving them so the
// list matches the walk round the floor. Splitting them into two places would
// mean the person setting up has to find the second one.
//
// Up and down buttons rather than drag-and-drop. This is used on a tablet, in
// a plant, often in gloves — a drag that half-works drops a line somewhere
// nobody intended, and the undo for that is "notice it later".
//
// Nothing here is saved until Done. The whole point is to shuffle until it
// looks right, and an autosave firing on every tap would write eight versions
// of a list that was mid-thought.
import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { ArrowUp, ArrowDown, Plus, X, ArrowDownAZ } from 'lucide-react';
import { useBodyScrollLock } from '../utils/useBodyScrollLock.js';
import {
  moveLineUp, moveLineDown, isSameLineSet, orderChanged, sortLinesNaturally,
} from '../utils/lineOrder.js';

const headsOf = (line) => (Array.isArray(line?.heads) ? line.heads.length : 0);

export default function SetupLinesModal({
  isOpen,
  lines = [],
  defaultHeadCount = 14,
  onSave,
  onClose,
  canAdd = true,
}) {
  const [draft, setDraft] = useState(lines);
  const [name, setName] = useState('');
  const [heads, setHeads] = useState(String(defaultHeadCount));
  const [error, setError] = useState('');
  useBodyScrollLock(isOpen);

  // Re-seed each time it opens, so a cancelled session is genuinely discarded
  // rather than lingering as a stale draft over newer data.
  useEffect(() => {
    if (isOpen) { setDraft(lines); setName(''); setHeads(String(defaultHeadCount)); setError(''); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  if (!isOpen) return null;

  const addLine = (e) => {
    e?.preventDefault();
    const title = name.trim();
    if (!title) { setError('Give the line a name — whatever it is called on the floor.'); return; }
    if (draft.some((l) => String(l.title || '').trim().toLowerCase() === title.toLowerCase())) {
      // Head history is matched by line TITLE across visits, so two lines with
      // one name make a machine's past ambiguous for good.
      setError(`There is already a line called "${title}".`);
      return;
    }
    const count = parseInt(heads, 10);
    if (Number.isNaN(count) || count < 1 || count > 50) { setError('Heads must be between 1 and 50.'); return; }

    setDraft([...draft, {
      id: Date.now() + Math.floor(Math.random() * 1000),
      title,
      heads: Array.from({ length: count }, (_, i) => ({
        id: i + 1, status: 'active', error: 'None', notes: '', fixed: 'na', issues: [],
        currentWeight: 0, spanWeight: 0, weightDifference: 0,
      })),
      running: false,
      notes: '',
    }]);
    setName('');
    setError('');
  };

  const save = () => {
    // Never write a list that is not the same set of lines plus whatever was
    // added here. Cheap, and the alternative is losing a line's whole history.
    const added = draft.filter((d) => !lines.some((l) => l.id === d.id));
    const kept = draft.filter((d) => lines.some((l) => l.id === d.id));
    if (!isSameLineSet(lines, kept)) {
      setError('Something went wrong with the list — nothing was saved. Close and try again.');
      return;
    }
    if (added.length === 0 && !orderChanged(lines, draft)) { onClose(); return; }
    onSave(draft);
    onClose();
  };

  return createPortal((
    <>
      <div className="modal-backdrop fade show" onClick={onClose} />
      <div className="modal fade show d-block" tabIndex="-1" role="dialog" aria-modal="true" aria-label="Set up lines">
        <div className="modal-dialog modal-dialog-centered modal-dialog-scrollable">
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title">
                {lines.length === 0 ? 'Build your lines' : 'Set up lines'}
              </h5>
              <button type="button" className="btn-close" onClick={onClose} aria-label="Close" />
            </div>

            <div className="modal-body">
              {draft.length === 0 ? (
                <p className="text-secondary">
                  Add each line the way it is known on the floor — the name the crew would say out
                  loud. You can change the order afterwards, and nothing is saved until you press Done.
                </p>
              ) : (
                <>
                  <div className="d-flex align-items-baseline justify-content-between mb-2">
                    <span className="text-secondary small">
                      This is the order they appear everywhere — chips, dashboard, PDFs. Put them in
                      the order you walk them.
                    </span>
                    {draft.length > 1 && (
                      <button
                        type="button"
                        className="btn btn-sm btn-link text-decoration-none text-nowrap"
                        onClick={() => setDraft(sortLinesNaturally(draft))}
                        title="Sort by name as a starting point — then move them to match the floor"
                      >
                        <ArrowDownAZ size={14} /> Sort by name
                      </button>
                    )}
                  </div>

                  <ol className="list-group list-group-numbered mb-3">
                    {draft.map((line, i) => (
                      <li key={line.id} className="list-group-item d-flex align-items-center gap-2">
                        <span className="flex-grow-1">
                          <span className="fw-semibold">{line.title}</span>
                          <span className="text-secondary small"> · {headsOf(line)} heads</span>
                          {!lines.some((l) => l.id === line.id) && (
                            <span className="badge bg-success-subtle text-success-emphasis ms-2">new</span>
                          )}
                        </span>
                        <div className="btn-group btn-group-sm flex-shrink-0">
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => setDraft(moveLineUp(draft, i))}
                            disabled={i === 0}
                            aria-label={`Move ${line.title} up`}
                          >
                            <ArrowUp size={15} />
                          </button>
                          <button
                            type="button"
                            className="btn btn-outline-secondary"
                            onClick={() => setDraft(moveLineDown(draft, i))}
                            disabled={i === draft.length - 1}
                            aria-label={`Move ${line.title} down`}
                          >
                            <ArrowDown size={15} />
                          </button>
                        </div>
                      </li>
                    ))}
                  </ol>
                </>
              )}

              {canAdd && (
                <form onSubmit={addLine} className="border-top pt-3">
                  <div className="row g-2 align-items-end">
                    <div className="col-7 col-sm-8">
                      <label className="form-label small mb-1" htmlFor="sl-name">Line name</label>
                      <input
                        id="sl-name"
                        className="form-control"
                        value={name}
                        onChange={(e) => { setName(e.target.value); setError(''); }}
                        placeholder="e.g. Can Line, PPI-3"
                        autoComplete="off"
                      />
                    </div>
                    <div className="col-3 col-sm-2">
                      <label className="form-label small mb-1" htmlFor="sl-heads">Heads</label>
                      <input
                        id="sl-heads"
                        type="number"
                        min="1"
                        max="50"
                        inputMode="numeric"
                        className="form-control"
                        value={heads}
                        onChange={(e) => setHeads(e.target.value)}
                      />
                    </div>
                    <div className="col-2">
                      <button type="submit" className="btn btn-primary w-100" aria-label="Add line">
                        <Plus size={16} />
                      </button>
                    </div>
                  </div>
                  {/* The count stays put between adds: plants tend to have a lot
                      of one size of weigher, so retyping 14 twelve times is the
                      slow part of setting up. */}
                  <div className="form-text">Add as many as you need — the head count stays for the next one.</div>
                </form>
              )}

              {error && <div className="alert alert-danger py-2 mt-3 mb-0">{error}</div>}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={onClose}>Cancel</button>
              <button type="button" className="btn btn-primary" onClick={save}>Done</button>
            </div>
          </div>
        </div>
      </div>
    </>), document.body);
}
