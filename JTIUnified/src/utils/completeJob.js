// src/utils/completeJob.js
//
// What "mark this job complete" would actually write.
//
// The board stores no status: every tick is derived from a real thing — a
// signed PDF, an invoice, a built packet, the Tracker's paid field. Marking a
// job complete therefore is not setting a flag, it is making each of those
// things true one at a time, and two of them are assertions about the outside
// world (the report and the invoice exist somewhere this app cannot see) while
// one is an assertion about money.
//
// So the plan is computed first and shown to the person before anything is
// written. A button that quietly asserts an invoice was raised and the customer
// paid is not a button anybody should press without reading it.

/** Steps this action can satisfy, in the order they are written. */
const WRITABLE = ['serviceReport', 'invoice', 'packet', 'sent', 'paid'];

const LABEL = {
  serviceReport: 'service report filed (on your word — no file is here)',
  invoice: 'invoice raised (on your word — no file is here)',
  packet: 'packet built',
  sent: 'packet sent to accounts payable',
  paid: 'PAID — recorded in the Jobs Tracker',
};

/**
 * What is left to do on this row, and whether it can be done at all.
 *
 * `blocked` is a reason, not a boolean: a control that refuses without saying
 * why reads as broken.
 */
export const completionPlan = (row) => {
  if (!row) return { blocked: 'No job.', steps: [] };

  const steps = row.steps || [];
  const byKey = (k) => steps.find((s) => s.key === k);

  // The job has to exist in the Tracker before anything else can be true of
  // it, and this cannot conjure one — that is a real record with a customer
  // and dates on it, created deliberately.
  if (!byKey('created')?.done) {
    return {
      blocked: 'This job is not in the Jobs Tracker yet. Create it there first — the other steps hang off it.',
      steps: [],
    };
  }

  const outstanding = WRITABLE.filter((key) => {
    const step = byKey(key);
    return step && !step.done;
  });

  // Paid is written onto the Tracker job itself, which needs its document id.
  // A job read from the archived year files has none.
  if (outstanding.includes('paid') && !row.jobId) {
    return {
      blocked: 'This job came from the archived year files, so its paid status cannot be written. Mark it paid in the Jobs Tracker.',
      steps: outstanding.filter((k) => k !== 'paid'),
      partial: true,
    };
  }

  return { blocked: null, steps: outstanding };
};

/**
 * The plan in words, for the confirm that has to be read before pressing.
 *
 * A partial plan — one that can do most of it but not the money — says both:
 * what it cannot do, and then what it still will. Returning only the refusal
 * printed the reason twice and never listed the steps.
 */
export const describePlan = (plan, sr) => {
  if (!plan) return '';
  if (plan.blocked && !plan.steps.length) return plan.blocked;
  if (!plan.steps.length) return `${sr} is already complete.`;
  return (plan.blocked ? `${plan.blocked}\n\n` : '')
    + `Mark ${sr} complete?\n\nThis records:\n`
    + plan.steps.map((k) => `  • ${LABEL[k]}`).join('\n')
    + '\n\nEach one can be undone on the job packet page.';
};

export const STEP_LABEL = LABEL;
export default { completionPlan, describePlan, STEP_LABEL };
