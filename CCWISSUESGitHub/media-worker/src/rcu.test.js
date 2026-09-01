// What the RCU reader must never let through to a centerline.
import { describe, it, expect } from 'vitest';
import { readResult } from './rcu.js';

const claims = { sub: 'test-uid' };
const reply = (payload, stop = 'end_turn') => ({
  stop_reason: stop,
  content: [{ type: 'text', text: JSON.stringify(payload) }],
  usage: { input_tokens: 1, output_tokens: 1 },
});

const good = {
  screenTitle: 'Various Parameter Setting',
  activeTab: 'Weigh Spec Set',
  fields: [
    { label: 'Stable Judgment Weight', value: '0.30g', enabled: true, confident: true },
    { label: 'Empty Judgment Weight', value: '8.0g', enabled: true, confident: true },
  ],
  notes: '',
};

describe('readResult', () => {
  it('passes a clean read through', () => {
    const out = readResult(reply(good), claims);
    expect(out.screenTitle).toBe('Various Parameter Setting');
    expect(out.activeTab).toBe('Weigh Spec Set');
    expect(out.fields).toHaveLength(2);
    expect(out.fields[0]).toEqual({
      label: 'Stable Judgment Weight', value: '0.30g', enabled: true, confident: true,
    });
  });

  it('keeps a value exactly as displayed', () => {
    // 90.0 must not become 90: a centerline is a spec, and the decimal is part
    // of it. Values stay strings for the same reason.
    const out = readResult(reply({ ...good, fields: [
      { label: 'Target Weight', value: '90.0g', enabled: true, confident: true },
    ] }), claims);
    expect(out.fields[0].value).toBe('90.0g');
  });

  it('drops a field with no label rather than emitting a nameless setting', () => {
    const out = readResult(reply({ ...good, fields: [
      { label: '', value: '12.00g', enabled: true, confident: true },
      { label: '   ', value: '6', enabled: true, confident: true },
      { label: 'Auto Zero Interval', value: '6', enabled: true, confident: true },
    ] }), claims);
    expect(out.fields.map((f) => f.label)).toEqual(['Auto Zero Interval']);
  });

  it('never reports a malformed field as a blank value', () => {
    // An `undefined` value reaching the form prints as an empty setting, which
    // reads as "this is set to nothing" rather than "this was not read".
    const out = readResult(reply({ ...good, fields: [
      { label: 'Stable Count', enabled: true, confident: true },
    ] }), claims);
    expect(out.fields[0].value).toBe('');
  });

  it('treats confidence as opt-in, not opt-out', () => {
    // A field that omits `confident` must not be presented as verified.
    const out = readResult(reply({ ...good, fields: [
      { label: 'IIR', value: '160', enabled: true },
    ] }), claims);
    expect(out.fields[0].confident).toBe(false);
  });

  it('carries a greyed-out field through as disabled', () => {
    // Lower Weight Limit is dimmed on the preset screen. Reported as enabled it
    // would print on the centerline as a setting that is in force.
    const out = readResult(reply({ ...good, fields: [
      { label: 'Lower Weight Limit', value: '0.0g', enabled: false, confident: true },
    ] }), claims);
    expect(out.fields[0].enabled).toBe(false);
  });

  it('survives a response with no fields at all', () => {
    const out = readResult(reply({
      screenTitle: '', activeTab: '', fields: [], notes: 'Not an RCU screen.',
    }), claims);
    expect(out.fields).toEqual([]);
    expect(out.notes).toBe('Not an RCU screen.');
  });

  it('reports a refusal as a refusal, not a parse failure', () => {
    expect(() => readResult({ stop_reason: 'refusal', content: [] }, claims))
      .toThrowError(/declined/i);
  });

  it('reports a truncated read rather than returning half a screen', () => {
    // Half a settings screen looks exactly like a complete one to the reader.
    expect(() => readResult({ ...reply(good), stop_reason: 'max_tokens' }, claims))
      .toThrowError(/ran out of room/i);
  });

  it('turns unparseable output into an operator-readable error', () => {
    const bad = { stop_reason: 'end_turn', content: [{ type: 'text', text: 'not json' }] };
    let err;
    try { readResult(bad, claims); } catch (e) { err = e; }
    expect(err.status).toBe(502);
    expect(err.message).toMatch(/glare/i);
  });
});
