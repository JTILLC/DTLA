// shared/components/BoardPartsByMachine.jsx
//
// "On THIS machine, that board is this part."
//
// Sits under the parts-manual links because it is the same act: you have just
// said which machine a line is, and this is where you say what its boards are.
// A board type carries one part number for everywhere (see boardTypes.js), which
// is right for the boards that do not vary and wrong for the ones that do —
// "Main Control Board" is a different part on a bigger weigher.
//
// Parts are PICKED from the bound machine's own manual rather than typed, so a
// mapping is a real catalog part with its item number and drawing, and the
// pre-fill it produces on a replacement is as good as picking it by hand.
//
// One machine at a time. Every machine × every board type at once is a wall of
// search boxes, and the job is naturally done one machine at a time anyway.
import { useMemo, useState } from 'react';
import { Cpu } from 'lucide-react';
import PartLookupField from './parts/PartLookupField.jsx';
import { machineKey, machineLabel, partsForMachine, withMachine } from '../utils/boardParts.js';

export default function BoardPartsByMachine({
  bindings = {},        // { [lineTitle]: { partsCustomer, folder } }
  boardTypes = [],      // names
  boardParts,           // { byMachine }
  onChange,             // (nextBoardParts) => void
  confirm,
}) {
  // Distinct machines, with the lines that use each — two lines often share one
  // machine folder, and mapping it twice would be work with no meaning.
  const machines = useMemo(() => {
    const m = new Map();
    Object.entries(bindings).forEach(([lineTitle, b]) => {
      const key = machineKey(b);
      if (!key) return;
      if (!m.has(key)) m.set(key, { key, binding: b, lines: [] });
      m.get(key).lines.push(lineTitle);
    });
    return [...m.values()].sort((a, b) => a.key.localeCompare(b.key));
  }, [bindings]);

  const [selected, setSelected] = useState('');
  const machine = machines.find((x) => x.key === selected) || null;
  const mapping = machine ? partsForMachine(boardParts, machine.binding) : {};

  const setPart = (boardType, part) => {
    const next = { ...mapping };
    if (!part) delete next[boardType];
    else {
      next[boardType] = {
        partNumber: part.partCode || part.partNumber || '',
        partName: part.partName || '',
        itemNo: part.itemNo || '',
        diagramId: part.diagramId || '',
        diagramName: part.diagramName || '',
      };
    }
    onChange(withMachine(boardParts, machine.binding, next));
  };

  if (machines.length === 0) {
    return (
      <div className="border rounded p-2 mt-3">
        <div className="fw-semibold d-flex align-items-center gap-2"><Cpu size={15} /> Board part numbers</div>
        <small className="text-muted">
          Link a line to a machine above first — board parts are looked up in that machine&apos;s manual.
        </small>
      </div>
    );
  }

  const mapped = Object.keys(mapping).length;

  return (
    <div className="border rounded p-2 mt-3">
      <div className="fw-semibold d-flex align-items-center gap-2 mb-1"><Cpu size={15} /> Board part numbers</div>
      <small className="text-muted d-block mb-2">
        Optional, and only needed where a board differs between machines. Set here, it wins over
        the general part number on the board-type list, and logging that board on a line bound to
        this machine fills it in.
      </small>

      <select
        className="form-select form-select-sm mb-2"
        value={selected}
        onChange={(e) => setSelected(e.target.value)}
        aria-label="Machine to set board parts for"
      >
        <option value="">Choose a machine…</option>
        {machines.map((m) => {
          const n = Object.keys(partsForMachine(boardParts, m.binding)).length;
          return (
            <option key={m.key} value={m.key}>
              {machineLabel(m.binding)} — {m.lines.join(', ')}{n ? ` · ${n} set` : ''}
            </option>
          );
        })}
      </select>

      {machine && (
        <>
          <div className="small text-muted mb-2">
            {mapped ? `${mapped} of ${boardTypes.length} boards mapped for this machine.` : 'Nothing mapped for this machine yet.'}
          </div>
          {boardTypes.map((name) => {
            const cur = mapping[name];
            // PartLookupField wants a picked-part shape; a stored mapping is
            // nearly one already.
            const picked = cur?.partNumber
              ? { partCode: cur.partNumber, partName: cur.partName || '', itemNo: cur.itemNo || '',
                  diagramId: cur.diagramId || '', diagramName: cur.diagramName || '', qty: 1, manualQty: null }
              : null;
            return (
              <div key={name} className="mb-2">
                <label className="form-label small mb-1">{name}</label>
                <PartLookupField
                  binding={machine.binding}
                  value={cur?.partNumber || ''}
                  // Typing here is not a mapping — a mapping has to be a real part
                  // from this machine's manual, or the pre-fill would spread a
                  // typo to every replacement logged afterwards.
                  onChange={() => {}}
                  onPick={(p) => setPart(name, p)}
                  picked={picked}
                  extras={[]}
                  onExtras={() => {}}
                  confirm={confirm}
                />
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}
