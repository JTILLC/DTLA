// shared/components/LineLockPrompt.jsx
//
// "That isn't your line — is a supervisor here?"
//
// Shown only when someone tries to file against a line they are not assigned
// to. It is deliberately a way THROUGH rather than a wall: the work being
// recorded has usually already happened, and a record that cannot be written is
// worse than one written under supervision.
//
// Cancelling leaves the form exactly as it was. Nothing is discarded by
// declining — whatever was typed is still there to be saved against the right
// line, or once the assignment is corrected.
import PinPrompt from './PinPrompt.jsx';

export default function LineLockPrompt({ customerId, people, challenge, onAuthorise, onCancel }) {
  if (!challenge) return null;
  return (
    <PinPrompt
      customerId={customerId}
      people={people}
      requireRole="supervisor"
      title="Not your line"
      message={
        `${challenge.message} A supervisor can authorise this entry — `
        + 'it will be recorded as filed by the operator and authorised by them.'
      }
      onVerified={onAuthorise}
      onCancel={onCancel}
    />
  );
}
