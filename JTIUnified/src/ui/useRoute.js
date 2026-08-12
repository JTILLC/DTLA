// src/ui/useRoute.js
//
// The URL as state. One value, kept in step with the address bar in both
// directions: navigating pushes, and the back button is heard.
//
// `replace` exists for the case where a view corrects its own address — a
// packet that loads and then knows its service report number should not put a
// second entry in the history for the same screen, or Back stops meaning "the
// thing before this" and starts meaning "this again".
import { useCallback, useEffect, useState } from 'react';
import { parsePath, toPath } from './views';

export function useRoute() {
  const read = () => parsePath(typeof window === 'undefined' ? '/' : window.location.pathname);
  const [route, setRoute] = useState(read);

  useEffect(() => {
    const onPop = () => setRoute(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);

  const go = useCallback((next, { replace = false } = {}) => {
    const path = toPath(next);
    // Pushing the address you are already on is how a back button ends up
    // needing three presses to leave one screen.
    if (path === window.location.pathname) {
      setRoute(parsePath(path));
      return;
    }
    window.history[replace ? 'replaceState' : 'pushState']({}, '', path);
    setRoute(parsePath(path));
  }, []);

  return [route, go];
}

export default useRoute;
