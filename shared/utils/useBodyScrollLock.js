// src/utils/useBodyScrollLock.js
// The app's modals are hand-rolled <div className="modal show d-block"> elements
// rather than Bootstrap's JS component, so nothing ever adds `modal-open` to
// <body>. On a phone that means the page behind the dialog scrolls under your
// finger whenever the dialog's own content isn't scrollable. Call this from any
// modal to freeze the background while it's open.
//
// The lock is REFERENCE COUNTED. Modals overlap (a confirm dialog on top of the
// visits modal, the head modal opened from a line), and a naive
// save-and-restore leaves the body permanently frozen: A saves '', B saves
// 'hidden', A unmounts and restores '', then B unmounts and restores 'hidden'.
// Only the first lock records the original value and only the last release
// restores it.
import { useEffect } from 'react';

let lockCount = 0;
let originalOverflow = '';

function acquire() {
  if (lockCount === 0) {
    originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  lockCount += 1;
}

function release() {
  lockCount = Math.max(0, lockCount - 1);
  if (lockCount === 0) {
    document.body.style.overflow = originalOverflow;
  }
}

export function useBodyScrollLock(active = true) {
  useEffect(() => {
    if (!active) return undefined;
    acquire();
    return release;
  }, [active]);
}

export default useBodyScrollLock;
