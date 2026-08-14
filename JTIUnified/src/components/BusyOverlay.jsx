// src/components/BusyOverlay.jsx
//
// What the app is doing right now, when it is doing something slow.
//
// Uploading a receipt takes five to ten seconds — the file goes up, then the
// photo is read for a vendor and a total. All of that happened silently: the
// page looked identical until the receipts appeared, so the only feedback was
// nothing happening, which reads as "the button didn't work". People press it
// again, and a second press uploads the same receipt twice.
//
// So this covers the panel while work is in flight. It deliberately blocks
// clicks rather than merely reporting: the operations behind it write to
// Firestore and Storage, and a second Add pressed halfway through the first is
// how duplicates get made.

import React from 'react';

/**
 * @param {string}  message - what is happening, in plain words. Falsy hides it.
 * @param {string} [detail] - the file or step in hand, if there is one.
 * @param {{done:number,total:number}} [progress] - shown as a bar when given.
 */
export default function BusyOverlay({ message, detail, progress, colors }) {
  if (!message) return null;

  const pct = progress && progress.total
    ? Math.round((progress.done / progress.total) * 100)
    : null;

  return (
    <div
      // aria-live so the message is announced rather than only drawn, and
      // aria-busy so assistive tech knows the panel behind is mid-operation.
      role="status" aria-live="polite" aria-busy="true"
      style={{
        position: 'fixed', inset: 0, zIndex: 5000,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        padding: '20px', background: 'rgba(0,0,0,0.45)',
        backdropFilter: 'blur(2px)',
      }}
    >
      <div style={{
        background: colors.cardBg, borderRadius: '12px', padding: '22px 26px',
        width: 'min(420px, 100%)', textAlign: 'center',
        boxShadow: '0 24px 60px rgba(0,0,0,0.45)',
      }}>
        <div style={{
          width: '34px', height: '34px', margin: '0 auto 14px',
          border: `3px solid ${colors.border || '#d1d5db'}`,
          borderTopColor: '#3b82f6', borderRadius: '50%',
          // Named uniquely: a bare `spin` would collide with any other
          // keyframes of that name on the page and animate at its speed.
          animation: 'jtiBusySpin 0.8s linear infinite',
        }} />

        <div style={{ color: colors.text, fontWeight: 600, fontSize: '15px' }}>{message}</div>

        {detail && (
          <div style={{
            color: colors.textSecondary, fontSize: '13px', marginTop: '5px',
            // A long filename must not stretch the box off the screen.
            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
          }}>{detail}</div>
        )}

        {pct != null && (
          <>
            <div style={{
              height: '6px', borderRadius: '3px', marginTop: '14px',
              background: colors.border || '#e5e7eb', overflow: 'hidden',
            }}>
              <div style={{
                width: `${pct}%`, height: '100%', background: '#3b82f6',
                transition: 'width 0.2s ease',
              }} />
            </div>
            <div style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '6px' }}>
              {progress.done} of {progress.total}
            </div>
          </>
        )}

        {/* Said plainly, because the honest answer to "why is this taking so
            long" is that reading the photo is the slow part. */}
        <div style={{ color: colors.textSecondary, fontSize: '12px', marginTop: '12px' }}>
          Please wait — don't close this page.
        </div>
      </div>

      <style>{`
        @keyframes jtiBusySpin { to { transform: rotate(360deg); } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes jtiBusySpin { to { transform: none; } }
        }
      `}</style>
    </div>
  );
}
