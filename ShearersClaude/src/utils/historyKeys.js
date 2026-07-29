// src/utils/historyKeys.js
// Canonical hashing + keying for head-history entries.
// Shared by HeadHistory and Summary (previously copy-pasted in both).

export const canonicalString = (e) => {
  const date = (e.date ?? '').trim();
  const line = (e.line ?? '').trim();
  const head = e.head === '' || e.head === undefined || e.head === null ? '' : String(e.head).trim();
  const issue = (e.issue ?? '').trim();
  const repaired = (e.repaired ?? '').trim();
  const notes = (e.notes ?? '').trim();
  if (!head) return `MN|${date}|${line}|${notes}`;
  return `H|${date}|${line}|${head}|${issue}|${repaired}|${notes}`;
};

export const hashHex = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(16);
};

export const firebaseKeyForEntry = (e) => {
  const c = canonicalString(e);
  const type = c.startsWith('MN|') ? 'MN' : 'H';
  return `${type}_${hashHex(c)}`;
};
