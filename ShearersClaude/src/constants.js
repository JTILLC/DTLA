// src/constants.js
// Single source of truth for values that were previously redefined (and drifting)
// across MainLogger, Dashboard, HeadIssuesChart, RunningHeadsPage, Summary, HeadHistory.

export const HEADS_PER_LINE = 14;

// Issue types used in the logging flow + analytics (no "None").
export const ISSUE_TYPES = [
  'WDU Replacement',
  'Chute',
  'Operator',
  'Load Cell',
  'Detached Head',
  'Stepper Motor Error',
  'Hopper Issues',
  'Installed Wrong',
  'Other',
];

export const REPAIRED_TYPES = ['Not Fixed', 'Fixed'];

// Plant line sections (used by Dashboard and the running-heads views).
export const SECTIONS = [
  { name: 'PC Line',     lines: Array.from({ length: 7 }, (_, i) => `Line ${i + 1}`) },
  { name: 'Pellet Line', lines: Array.from({ length: 3 }, (_, i) => `Line ${i + 8}`) },
  { name: 'Extruded',    lines: Array.from({ length: 6 }, (_, i) => `Line ${i + 11}`) },
  { name: 'Hand Kettle', lines: Array.from({ length: 7 }, (_, i) => `Line ${i + 17}`) },
  { name: 'Twin Screw',  lines: Array.from({ length: 8 }, (_, i) => `Line ${i + 24}`) },
  { name: 'Sheeted 1',   lines: Array.from({ length: 6 }, (_, i) => `Line ${i + 32}`) },
  { name: 'Sheeted 2',   lines: Array.from({ length: 2 }, (_, i) => `Line ${i + 38}`) },
];
