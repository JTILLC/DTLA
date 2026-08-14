// src/components/DataHealthBanner.jsx
//
// Says when part of the page could not be loaded.
//
// Each fetcher catches its own errors and returns an empty result, so one dead
// source cannot blank the dashboard. That is right — but it made a permission
// error, an expired sign-in and a genuinely empty collection look the same:
// no rows and no explanation. This is the missing half of that design.
//
// Not a modal and not a red page. What loaded is still usable and still shown;
// this only stops the gap being silent.

import React, { useEffect, useState } from 'react';
import { AlertTriangle, ChevronDown, X } from 'lucide-react';
import { subscribe, summarise } from '../utils/dataHealth';

export default function DataHealthBanner({ colors }) {
  const [items, setItems] = useState([]);
  const [open, setOpen] = useState(false);
  const [dismissed, setDismissed] = useState('');

  useEffect(() => subscribe(setItems), []);

  if (!items.length) return null;

  // Dismissal is keyed to WHAT is failing, so hiding one problem does not hide
  // the next, different one.
  const key = items.map((f) => f.source).sort().join('|');
  if (dismissed === key) return null;

  return (
    <div
      role="status"
      style={{
        display: 'flex', flexDirection: 'column', gap: '6px',
        padding: '10px 14px', marginBottom: '16px', borderRadius: '8px',
        background: colors.cardBg, border: `1px solid ${colors.border}`,
        borderLeft: '3px solid #f59e0b',
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
        <AlertTriangle size={15} style={{ color: '#f59e0b', flexShrink: 0 }} />
        <span style={{ color: colors.text, fontSize: '14px', flex: '1 1 240px' }}>{summarise(items)}</span>
        <button
          type="button" onClick={() => setOpen((v) => !v)}
          style={{ background: 'transparent', border: 0, cursor: 'pointer', color: colors.textSecondary, fontSize: '13px', display: 'inline-flex', alignItems: 'center', gap: '4px' }}
        >
          {open ? 'Hide' : 'Details'}
          <ChevronDown size={13} style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }} />
        </button>
        <button
          type="button" onClick={() => setDismissed(key)} aria-label="Dismiss"
          style={{ background: 'transparent', border: 0, cursor: 'pointer', color: colors.textSecondary, display: 'flex' }}
        >
          <X size={15} />
        </button>
      </div>

      {/* The actual message, for when "could not load" is not enough to act on.
          Kept behind a click: it is the developer's sentence, not the user's. */}
      {open && (
        <div style={{ paddingLeft: '23px' }}>
          {items.map((f) => (
            <div key={f.source} style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '3px' }}>
              <strong style={{ color: colors.text }}>{f.source}</strong> — {f.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
