// shared/utils/useLineGuard.jsx
//
// Stops a save against a line the person is not assigned to, and offers a
// supervisor the chance to let it through.
//
// It composes with withActor rather than replacing it, because the two answer
// different questions and both still have to be asked:
//
//   withActor   — who is filing this?      (identity)
//   lineGuard   — may they file it here?   (authority)
//
//   const save = () => withActor((filedBy) =>
//     guard.check(form.lineTitle, async (override) => { …write… }));
//
// `override` is null on the ordinary path and the authorising supervisor when
// one was needed, so a caller spreads overrideStamp(override, line) into the
// record and an authorised entry is distinguishable ever after.
//
// The guard NEVER silently drops a save. Either it runs, or the operator is
// told why not and given a way through with a supervisor present.
import { useCallback, useState } from 'react';
import { mayEditLine, refusalMessage, resolvePerson } from './lineAccess.js';

export function useLineGuard({ people = [], actor }) {
  // { run, lineTitle, message } while a supervisor is being asked.
  const [challenge, setChallenge] = useState(null);

  const check = useCallback((lineTitle, run) => {
    const person = resolvePerson(people, actor);
    if (mayEditLine(person, lineTitle)) return run(null);
    setChallenge({ run, lineTitle, message: refusalMessage(person, lineTitle) });
    return undefined;
  }, [people, actor]);

  // The supervisor proved who they are — carry on, and hand the caller the
  // person who authorised it.
  const authorise = useCallback((supervisor) => {
    setChallenge((c) => {
      if (c) c.run(supervisor);
      return null;
    });
  }, []);

  const dismiss = useCallback(() => setChallenge(null), []);

  return { check, challenge, authorise, dismiss };
}

export default useLineGuard;
