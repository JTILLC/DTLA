// Anything rendered must be a string. An object reaching JSX is React error
// #31, which whites out the page rather than degrading — and it did, after a
// backup had already succeeded.
import { describe, it, expect } from 'vitest';
import { progressText } from './progressText.js';

describe('progressText', () => {
  it('passes a plain message through — what the single backups send', () => {
    expect(progressText('Starting CCW Issues backup...')).toBe('Starting CCW Issues backup...');
  });

  it('reads the shape backupAllApps sends', () => {
    // The one that crashed the page.
    expect(progressText({ message: 'Backing up Timesheet', progress: 50 }))
      .toBe('Backing up Timesheet (50%)');
  });

  it('keeps 0% rather than dropping it as falsy', () => {
    expect(progressText({ message: 'Starting', progress: 0 })).toBe('Starting (0%)');
  });

  it('copes with a message and no percentage', () => {
    expect(progressText({ message: 'Removing the sandbox…' })).toBe('Removing the sandbox…');
  });

  it('returns a STRING for everything, never an object', () => {
    // The property that actually matters: whatever arrives, JSX gets text.
    [null, undefined, {}, { progress: 40 }, [], 0, false, { message: '' }].forEach((v) => {
      expect(typeof progressText(v)).toBe('string');
    });
  });

  it('says nothing when there is nothing to say', () => {
    expect(progressText(null)).toBe('');
    expect(progressText({})).toBe('');
    expect(progressText({ progress: 40 })).toBe('');   // a number with no words is not a message
  });
});
