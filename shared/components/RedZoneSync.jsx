// src/components/RedZoneSync.jsx
// Operator control to push a head's issues to RedZone as a maintenance work order.
//
// SCAFFOLDING: the actual RedZone call lives in a Cloudflare Worker broker
// (see redzone-worker/). This component builds the payload, POSTs it to the
// Worker (REDZONE_CONFIG.pushEndpoint), and records the returned work-order id
// on the head via onChange so it persists with the visit and the button can
// show a "Synced" state. Until pushEndpoint is configured the button explains
// that the integration isn't live yet and offers a payload preview.
import { useState } from 'react';
import { Send, CheckCircle2, Loader, ExternalLink } from 'lucide-react';
import { REDZONE_CONFIG } from '@app/config/constants.js';
import { useToast } from './Toast.jsx';
import { useDialog } from './DialogSystem.jsx';

// Shape the data the Worker needs to create/update a RedZone work order.
// `externalRef` is stable per head+visit so the Worker can dedupe/idempotently
// update instead of creating duplicates.
export const buildRedzonePayload = ({ head, line, globalData, customerId, visitId, visitName }) => {
  const headNumber = head.id || head.index + 1;
  const issues = (head.issues || []).map(iss => ({
    type: iss.type,
    status: iss.fixed,
    notes: iss.notes || '',
    photos: (iss.photos || []).map(p => p?.url).filter(Boolean)
  }));
  return {
    externalRef: `${customerId}:${visitId}:${line.id}:head-${headNumber}`,
    existingWorkOrderId: head.redzoneWorkOrderId || null,
    customer: globalData?.customer || '',
    visit: { id: visitId, name: visitName || '' },
    line: {
      id: line.id,
      title: line.title || '',
      model: line.model || '',
      serialNumber: line.serialNumber || ''
    },
    head: {
      number: headNumber,
      status: head.status,
      notes: head.notes || ''
    },
    issues,
    // Summary the Worker can drop straight into a work-order title/description.
    summary: `${line.title || 'Line'} — Head ${headNumber}: ${issues.map(i => i.type).join(', ') || 'Issue'}`
  };
};

const RedZoneSync = ({ head, line, globalData, customerId, visitId, visitName, onChange, disabled, disabledReason }) => {
  // Hidden until the integration is real.
  //
  // The button used to stay on screen explaining that RedZone was not
  // configured yet. That is a control that cannot do anything, sitting next to
  // controls that can, on a screen used in a plant — and the explanation reads
  // as a fault in the app rather than as a feature nobody has turned on. The
  // scaffolding stays; setting REDZONE_CONFIG.pushEndpoint brings the button
  // back with no other change.
  if (!REDZONE_CONFIG?.pushEndpoint) return null;

  const toast = useToast();
  const dialog = useDialog();
  const [sending, setSending] = useState(false);

  const configured = !!REDZONE_CONFIG.pushEndpoint;
  const synced = !!head.redzoneWorkOrderId;
  const payload = () => buildRedzonePayload({ head, line, globalData, customerId, visitId, visitName });

  const previewPayload = async () => {
    const p = payload();
    console.log('[RedZone] payload that would be sent:', p);
    await dialog.alert(
      `RedZone integration isn't live yet. Once the Worker is deployed, this ` +
      `button will create a maintenance work order:\n\n"${p.summary}"\n\n` +
      `(${p.issues.length} issue${p.issues.length === 1 ? '' : 's'}, ` +
      `${p.issues.reduce((n, i) => n + i.photos.length, 0)} photo(s). ` +
      `Full payload logged to the console.)`,
      { title: 'RedZone — not configured yet' }
    );
  };

  const send = async () => {
    if (disabled) {
      toast.error(disabledReason || 'Save the visit first');
      return;
    }
    if (!configured) {
      // No live endpoint yet — show what WOULD be sent so the mapping is reviewable.
      return previewPayload();
    }

    setSending(true);
    try {
      const res = await fetch(REDZONE_CONFIG.pushEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(REDZONE_CONFIG.clientKey ? { 'x-ccw-key': REDZONE_CONFIG.clientKey } : {})
        },
        body: JSON.stringify(payload())
      });
      if (!res.ok) throw new Error(`Worker responded ${res.status}`);
      const data = await res.json();
      if (!data?.workOrderId) throw new Error('No work order id returned');

      onChange({
        redzoneWorkOrderId: data.workOrderId,
        redzoneWorkOrderUrl: data.workOrderUrl || null,
        redzoneSyncedAt: new Date().toISOString(),
        redzoneStatus: 'synced'
      });
      toast.success(synced ? `RedZone work order ${data.workOrderId} updated` : `Sent to RedZone (WO ${data.workOrderId})`);
    } catch (err) {
      console.error('RedZone push failed:', err);
      onChange({ redzoneStatus: 'error' });
      toast.error('Failed to send to RedZone: ' + (err?.message || 'unknown error'));
    } finally {
      setSending(false);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap', marginTop: '4px' }}>
      <button
        type="button"
        onClick={send}
        disabled={sending}
        className={`btn btn-sm ${synced ? 'btn-outline-success' : 'btn-outline-dark'}`}
        title={configured ? (synced ? 'Update the RedZone work order' : 'Create a RedZone work order') : 'Preview what will be sent (integration not configured yet)'}
        style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}
      >
        {sending ? <Loader size={14} className="spinner-border spinner-border-sm" />
          : synced ? <CheckCircle2 size={14} />
          : <Send size={14} />}
        {synced ? 'Re-send to RedZone' : 'Send to RedZone'}
      </button>

      {synced && (
        <span className="badge bg-success d-inline-flex align-items-center gap-1" style={{ fontWeight: 600 }}>
          <CheckCircle2 size={12} /> WO {head.redzoneWorkOrderId}
          {head.redzoneWorkOrderUrl && (
            <a href={head.redzoneWorkOrderUrl} target="_blank" rel="noopener noreferrer" style={{ color: '#fff' }} title="Open in RedZone">
              <ExternalLink size={12} />
            </a>
          )}
        </span>
      )}
      {head.redzoneStatus === 'error' && !sending && (
        <span className="badge bg-danger" title="Last send failed — tap to retry">Send failed</span>
      )}
      {!configured && (
        <small className="text-muted">Not configured yet</small>
      )}
      {dialog.DialogComponent}
    </div>
  );
};

export default RedZoneSync;
