// Extract machine-model tokens from any free-form text.

// Words that show up after "CCW" / "CCW-" in prose but aren't real model
// suffixes. Without this filter, tokens like "AND", "IS", "IN", "ON" leak
// through and look like fake models in the filter pills.
const CCW_NOISE = new Set([
  'AND', 'IS', 'IN', 'ON', 'AT', 'TO', 'THE', 'A', 'AN', 'OR', 'IF',
  'OF', 'BY', 'AS', 'IT', 'WAS', 'BUT', 'HAS', 'HAD', 'DO', 'NO', 'SO',
  'NOT', 'ARE', 'ALL', 'ANY', 'NEW', 'OLD', 'OUT', 'SET', 'GET', 'PUT',
  'RAN', 'RUN', 'FIX', 'BAD', 'OFF',
]);

const MACHINE_PATTERNS = [
  // Real CCW models are always written with a hyphen: CCW-R, CCW-Z, CCW-M,
  // CCW-NZ, CCW-NS, CCW-RZ, CCW-RV, CCW-SE, etc. Require the literal hyphen
  // and uppercase letters so prose ("CCW. And replaced...") doesn't slip in.
  { re: /\bCCW-([A-Z]{1,3})\b/g, fmt: (m) => (CCW_NOISE.has(m[1]) ? null : `CCW-${m[1]}`) },
  { re: /\bAtlas[-\s]?(\d{2,4})[-\s]?([A-Z])?\b/gi, fmt: (m) => `Atlas-${m[1]}${m[2] ? '-' + m[2].toUpperCase() : ''}` },
  { re: /\bApex[-\s]?(\d{2,4})\s*([A-Z])?\b/gi, fmt: (m) => `Apex ${m[1]}${m[2] ? m[2].toUpperCase() : ''}` },
  { re: /\b(\d{3}E)\b/g, fmt: (m) => m[1].toUpperCase() },
  { re: /\bFDRV\s*#?\s*(\d)?\b/gi, fmt: (m) => `FDRV${m[1] ? ' #' + m[1] : ''}` },
  { re: /\bITPS\b/gi, fmt: () => 'ITPS' },
  { re: /\bRCU\b/g, fmt: () => 'RCU' },
  { re: /\bRF\s*board(s)?\b/gi, fmt: () => 'RF Board' },
  { re: /\bADC\s*board(s)?\b/gi, fmt: () => 'ADC Board' },
  { re: /\bload\s*cell(s)?\b/gi, fmt: () => 'Load Cell' },
  { re: /\bstepper\s*motor(s)?\b/gi, fmt: () => 'Stepper Motor' },
  { re: /\bDU['']?s?\b/g, fmt: () => 'DU (Drive Unit)' },
  { re: /\bAstro-?S?-?\d+\b/gi, fmt: (m) => m[0].replace(/\s+/g, '') },
];

export function extractMachines(text) {
  if (!text) return [];
  const found = new Set();
  for (const { re, fmt } of MACHINE_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const token = fmt(m);
      if (token) found.add(token);
    }
  }
  return [...found];
}

export function buildMachineList(symptoms, entries) {
  const map = new Map();
  const bump = (token) => map.set(token, (map.get(token) || 0) + 1);
  for (const sym of symptoms || []) {
    const body = sym.title + ' ' + (sym.blocks ? sym.blocks.join(' ') : '');
    extractMachines(body).forEach(bump);
  }
  for (const e of entries || []) {
    const blob = `${e.customer || ''} ${(e.body || []).join(' ')}`;
    extractMachines(blob).forEach(bump);
  }
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => ({ name, count }));
}
