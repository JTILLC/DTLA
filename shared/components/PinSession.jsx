// shared/components/PinSession.jsx
//
// "Logging as J. Alvarez — Sign off."
//
// A PIN proves who is at the tablet, and that proof is then reused for fifteen
// minutes so a shift's work is not interrupted every few taps. Good, until the
// next person walks up: nothing on screen said whose name their work was about
// to be filed under, and the only way to hand over was to find the small
// "Not you?" link buried inside whichever form you happened to open.
//
// So it lives in the header instead, on every screen, and says the two things a
// handover needs: WHO is active, and how to stop being them.
//
// It also says when NOBODY is signed in, which used to be shown by the badge
// simply not being there. That was survivable on a fifteen-minute session and
// is not on a five-minute one: the badge is now absent most of the time, and
// "nobody has identified themselves" reads identically to "this feature does
// not exist". It is also the state that changes what the app does — a Site Lead
// who is signed in is not asked to authorise anything, so whether one is
// signed in, and which one, is worth being able to see rather than infer.
//
// Still absent when the plant has nobody who could sign in at all; a roster
// with no PINs should not carry a permanent badge about a feature it does not
// use.
import { UserCheck, UserX, LogOut } from 'lucide-react';
import { useVerifiedPerson } from '../utils/useVerifiedPerson.js';
import './pin-session.css';

export default function PinSession({
  customerId,
  compact = false,
  // What this person is, on the roster. Shown because the role is the part that
  // decides what happens next, not the name.
  roleLabel = '',
  // Whether anybody at this plant could sign in. False → say nothing at all.
  anyoneCanSignIn = true,
}) {
  const { person, forget } = useVerifiedPerson(customerId);

  if (!person) {
    if (!anyoneCanSignIn) return null;
    return (
      <span
        className="pin-session pin-session--none"
        title="Nobody has entered a PIN on this device. The next person to log anything will be asked who they are."
      >
        <UserX size={13} className="pin-session-icon" aria-hidden="true" />
        {/* Short enough to survive the toolbar. The explanation is in the
            tooltip; the badge only has to answer "is anyone signed in?" */}
        <span className="pin-session-label">
          <strong>{compact ? 'No PIN' : 'Nobody signed in'}</strong>
        </span>
      </span>
    );
  }

  return (
    <span className="pin-session" title={`Work is being logged as ${person.name}${roleLabel ? ` (${roleLabel})` : ''}. Sign off so the next person is asked for their own PIN.`}>
      <UserCheck size={13} className="pin-session-icon" aria-hidden="true" />
      <span className="pin-session-label">
        <span className="pin-session-lede">Logging as</span>
        <strong>{person.name}</strong>
        {roleLabel && !compact && <span className="pin-session-role">{roleLabel}</span>}
      </span>
      <button
        type="button"
        className="pin-session-off"
        onClick={forget}
        // Named for what it does to the NEXT person, which is the reason
        // anybody presses it.
        aria-label={`Sign ${person.name} off, so the next person is asked for their PIN`}
      >
        <LogOut size={12} aria-hidden="true" />
        {!compact && <span>Sign off</span>}
      </button>
    </span>
  );
}
