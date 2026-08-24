// Start a validation from the job or the customer record.
//
// Until now this app knew customers only as whatever got typed into the form,
// so a validation could never be joined to the job it was done on or the
// plant it was done for. This bar reads the same customer records CCW Issues
// keeps and the job numbers the dashboard has handed out, fills the form's
// customer boxes (only the EMPTY ones — anything already typed wins), and
// stamps two invisible fields on the saved validation:
//
//   customerId          — the canonical CCW customer id, the cross-app join key
//   serviceReportNumber — the SR / invoice number this validation belongs to
//
// Neither prints on the PDF; they exist so the dashboard can file this
// validation under the right job and plant instead of guessing from spelling.
import { useEffect, useMemo, useState } from 'react';
import { fetchCustomerRecords, fetchOpenJobs } from './directory';
import { matchCustomer } from '@shared/utils/customerMatch.js';

export default function JobBar({ user, def, data, setData }) {
  const [records, setRecords] = useState([]);
  const [jobs, setJobs] = useState([]);
  const [note, setNote] = useState('');

  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const [r, j] = await Promise.all([
          fetchCustomerRecords(user.uid),
          fetchOpenJobs(user.uid).catch(() => []),
        ]);
        if (!live) return;
        setRecords(r);
        setJobs(j);
      } catch (err) {
        // Not fatal: the form works exactly as it always did without this.
        console.warn('Could not load the customer directory:', err);
      }
    })();
    return () => { live = false; };
  }, [user.uid]);

  const byId = useMemo(() => new Map(records.map((r) => [r.id, r])), [records]);
  const sorted = useMemo(
    () => records.slice().sort((a, b) => a.name.localeCompare(b.name)),
    [records],
  );

  const applyRecord = (record) => {
    const fill = def.applyCustomer ? def.applyCustomer(record) : {};
    setData((d) => {
      const next = { ...d };
      // Only fills what is EMPTY — a contact typed because the usual one is
      // away should not be overwritten by picking the customer afterwards.
      Object.entries(fill).forEach(([k, v]) => {
        if (!String(next[k] || '').trim() && v) next[k] = v;
      });
      // The id is not a form field and always follows the pick.
      next.customerId = record.id;
      return next;
    });
    setNote(`Filled from ${record.name}. Everything stays editable.`);
  };

  const pickCustomer = (id) => {
    const record = byId.get(id);
    if (record) applyRecord(record);
  };

  const pickJob = (sr) => {
    if (!sr) return;
    const job = jobs.find((j) => String(j.sr) === sr);
    if (!job) return;
    setData((d) => ({ ...d, serviceReportNumber: String(job.sr) }));
    const record = (job.customerId && byId.get(job.customerId))
      || matchCustomer(job.customer, records);
    if (record) applyRecord(record);
    else setNote(`SR ${job.sr} set. No customer record answers to "${job.customer}" — fill the details in by hand.`);
  };

  // Nothing readable (a plant login, or offline): the form is untouched.
  if (!records.length && !jobs.length && !data.serviceReportNumber) return null;

  return (
    <div className="jobbar">
      <div className="fldrow">
        {jobs.length > 0 && (
          <label className="fld">
            <span>Start from a job</span>
            <select value="" onChange={(e) => pickJob(e.target.value)}>
              <option value="">Choose a service report…</option>
              {jobs.map((j) => (
                <option key={j.sr} value={j.sr}>{j.sr}{j.customer ? ` — ${j.customer}` : ''}</option>
              ))}
            </select>
          </label>
        )}
        {sorted.length > 0 && (
          <label className="fld">
            <span>Customer record</span>
            <select value={data.customerId && byId.has(data.customerId) ? data.customerId : ''} onChange={(e) => pickCustomer(e.target.value)}>
              <option value="">Choose a customer…</option>
              {sorted.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </label>
        )}
        <label className="fld" style={{ flex: '0 1 180px' }}>
          <span>Service report no.</span>
          <input
            type="text"
            value={data.serviceReportNumber || ''}
            onChange={(e) => setData((d) => ({ ...d, serviceReportNumber: e.target.value }))}
            placeholder="2026028"
          />
        </label>
      </div>
      {note && <p className="jobnote">{note}</p>}
    </div>
  );
}
