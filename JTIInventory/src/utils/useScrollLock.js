import { useEffect } from 'react';

/**
 * iOS-safe body scroll lock. Prevents the page behind a modal from scrolling
 * when the user touches/scrolls inside the modal. On iOS, `overflow: hidden`
 * on body is ignored for touch; `position: fixed` is the reliable approach.
 */
export default function useScrollLock(locked) {
  useEffect(() => {
    if (!locked) return;

    const scrollY = window.scrollY;
    const original = {
      overflow: document.body.style.overflow,
      position: document.body.style.position,
      top: document.body.style.top,
      width: document.body.style.width,
    };

    document.body.style.overflow = 'hidden';
    document.body.style.position = 'fixed';
    document.body.style.top = `-${scrollY}px`;
    document.body.style.width = '100%';

    return () => {
      document.body.style.overflow = original.overflow;
      document.body.style.position = original.position;
      document.body.style.top = original.top;
      document.body.style.width = original.width;
      // Restore the scroll position we saved before locking
      window.scrollTo(0, scrollY);
    };
  }, [locked]);
}
