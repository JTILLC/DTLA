import { describe, it, expect } from 'vitest';
import spec from '../data/rcuFields.json';
import {
  normalizeLabel, matchField, applyReadings, settingsTable, gaps,
  emptyCenterline, mappedSection, photoSection, copyFrom,
} from './centerline';

const weightFields = spec.screens['preset-weight'].fields;

describe('matchField', () => {
  it('matches the label exactly as printed on the screen', () => {
    expect(matchField('Target Weight', weightFields).key).toBe('targetWeight');
  });

  it('matches across the spellings the RCU uses in different places', () => {
    // The screen says "Upper Weight Limit"; case and spacing must not matter.
    expect(matchField('UPPER WEIGHT LIMIT', weightFields).key).toBe('upperWeightLimit');
    expect(matchField('upper  weight limit', weightFields).key).toBe('upperWeightLimit');
  });

  it('matches an abbreviated export label to its screen field', () => {
    const scaleish = [{ key: 'autoZeroTolerance', label: 'Auto Zero Tolerance' }];
    expect(matchField('AUTO ZERO TOL.', scaleish).key).toBe('autoZeroTolerance');
  });

  it('returns null rather than guessing at a label it does not know', () => {
    // A near-miss must NOT be attached to a field. A value on the wrong setting
    // is the one failure a centerline cannot survive.
    expect(matchField('Upper Limit', weightFields)).toBeNull();
    expect(matchField('', weightFields)).toBeNull();
  });

  it('does not confuse two fields that share a prefix', () => {
    expect(matchField('Extended Upper Limit', weightFields).key).toBe('extendedUpperLimit');
    expect(matchField('Extended Upper Limit Dump Cycle', weightFields).key)
      .toBe('extendedUpperLimitDumpCycle');
  });
});

describe('applyReadings', () => {
  it('places what it recognises and hands back what it does not', () => {
    const { values, unmatched } = applyReadings([
      { label: 'Target Weight', value: '227.0g' },
      { label: 'Something Else', value: '5' },
    ], weightFields);
    expect(values.targetWeight).toBe('227.0g');
    expect(unmatched).toHaveLength(1);
    expect(unmatched[0].label).toBe('Something Else');
  });

  it('never drops an unmatched reading silently', () => {
    const { unmatched } = applyReadings(
      [{ label: 'Mystery', value: '1' }, { label: 'Other', value: '2' }], weightFields);
    expect(unmatched.map((u) => u.label)).toEqual(['Mystery', 'Other']);
  });

  it('keeps a value as typed, decimals included', () => {
    const { values } = applyReadings([{ label: 'Target Weight', value: '90.0' }], weightFields);
    expect(values.targetWeight).toBe('90.0');
  });
});

describe('settingsTable', () => {
  const cl = {
    ...emptyCenterline(),
    sections: [
      mappedSection('preset-weight', { targetWeight: '227.0', upperWeightLimit: '' }, 'imported'),
      photoSection('Various Parameter Setting', 'data:,', [
        { label: 'Stable Count', value: '6', confident: true },
        { label: 'Blank one', value: '' },
      ]),
    ],
  };

  it('lists only settings that actually have a value', () => {
    const rows = settingsTable(cl, spec);
    expect(rows.map((r) => r.label)).toEqual(['Target Weight', 'Stable Count']);
  });

  it('carries where each value came from', () => {
    const rows = settingsTable(cl, spec);
    expect(rows[0].source).toBe('imported');
    expect(rows[1].source).toBe('photo');
  });
});

describe('gaps', () => {
  it('names the settings a mapped screen is still missing', () => {
    const cl = { ...emptyCenterline(),
      sections: [mappedSection('preset-weight', { targetWeight: '227.0' })] };
    const [g] = gaps(cl, spec);
    expect(g.screen).toBe('Preset - Weight Setting');
    expect(g.missing).toContain('Upper Weight Limit');
    expect(g.missing).toContain('Extended Upper Limit');
  });

  it('does not ask for a field the screen itself greys out', () => {
    // Lower Weight Limit is disabled on this screen; demanding it would send
    // the engineer looking for a setting that isn't there.
    const cl = { ...emptyCenterline(),
      sections: [mappedSection('preset-weight', { targetWeight: '227.0' })] };
    expect(gaps(cl, spec)[0].missing).not.toContain('Lower Weight Limit');
  });

  it('is empty when every field is filled', () => {
    const values = {};
    for (const f of weightFields) if (!f.disabledOnScreen) values[f.key] = '1';
    const cl = { ...emptyCenterline(), sections: [mappedSection('preset-weight', values)] };
    expect(gaps(cl, spec)).toEqual([]);
  });
});

describe('copyFrom', () => {
  it('gives the copy its own identity and today\'s date', () => {
    const prev = { ...emptyCenterline(), id: 'cl_old', date: '2020-01-01', customer: "Shearer's",
      sections: [mappedSection('preset-weight', { targetWeight: '90.0' })] };
    const next = copyFrom(prev);
    expect(next.id).not.toBe('cl_old');
    expect(next.date).toBe(new Date().toISOString().slice(0, 10));
    expect(next.customer).toBe("Shearer's");
  });

  it('marks copied values as copied, not as freshly measured', () => {
    const prev = { ...emptyCenterline(),
      sections: [mappedSection('preset-weight', { targetWeight: '90.0' }, 'photo')] };
    expect(copyFrom(prev).sections[0].source).toBe('copied');
  });

  it('does not share state with the centerline it came from', () => {
    const prev = { ...emptyCenterline(),
      sections: [mappedSection('preset-weight', { targetWeight: '90.0' })] };
    const next = copyFrom(prev);
    next.sections[0].values.targetWeight = '227.0';
    expect(prev.sections[0].values.targetWeight).toBe('90.0');
  });
});
