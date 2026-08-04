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
// Absent entirely when nobody is signed in — a plant that has set no PINs, or a
// session that has lapsed, should not carry a permanent empty badge explaining
// a feature it does not use.
import { UserCheck, LogOut } from 'lucide-react';
import { useVerifiedPerson } from '../utils/useVerifiedPerson.js';
import './pin-session.css';

export default function PinSession({ customerId, compact = false }) {
  const { person, forget } = useVerifiedPerson(customerId);
  if (!person) return null;

  return (
    <span className="pin-session" title={`Work is being logged as ${person.name}. Sign off so the next person is asked for their own PIN.`}>
      <UserCheck size={13} className="pin-session-icon" aria-hidden="true" />
      <span className="pin-session-label">
        <span className="pin-session-lede">Logging as</span>
        <strong>{person.name}</strong>
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
