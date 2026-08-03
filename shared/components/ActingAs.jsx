// shared/components/ActingAs.jsx
//
// "You are recording as Jonathan — not you?"
//
// Confirming a PIN remembers that person on this device for ten hours, so an
// operator is not made to re-enter it for every head they touch during a shift.
// That is right for a shift and wrong for a handover, and until now it was
// entirely invisible: nothing said who you were acting as, and there was no way
// to stop. The result is work quietly attributed to whoever last held the
// tablet — which is worse than asking too often, because the log looks correct.
//
// Small and quiet by design. It is a label with an escape hatch, not a control
// anyone should have to think about.
import { UserCheck } from 'lucide-react';
import { useVerifiedPerson } from '../utils/useVerifiedPerson.js';

export default function ActingAs({ customerId, what = 'Changes' }) {
  const { person, forget } = useVerifiedPerson(customerId);
  if (!person) return null;

  return (
    <div className="small text-muted d-flex align-items-center gap-1 flex-wrap">
      <UserCheck size={13} className="flex-shrink-0" />
      <span>{what} recorded as <strong>{person.name}</strong></span>
      <button
        type="button"
        className="btn btn-link btn-sm p-0 align-baseline"
        onClick={forget}
        title="Forget who is at this device, so the next change asks again"
      >
        Not you?
      </button>
    </div>
  );
}
