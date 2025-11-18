// src/utils/dateUtils.js
const AZ_TZ = 'America/Phoenix';

export function toAzYmd(d) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: AZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);
}

export function normalizeToYmd(anyDateLike) {
  if (!anyDateLike) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(anyDateLike)) return anyDateLike;

  const mdy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;
  const m = String(anyDateLike).match(mdy);
  if (m) {
    const [, mm, dd, yyyy] = m.map(Number);
    return toAzYmd(new Date(Date.UTC(yyyy, mm - 1, dd, 12, 0, 0)));
  }
  const t = Date.parse(anyDateLike);
  if (!isNaN(t)) return toAzYmd(new Date(t));
  return String(anyDateLike);
}

export function normalizeDataDateKeys(data) {
  if (!data || typeof data !== 'object') return data || {};
  const out = {};
  Object.keys(data).forEach(k => {
    const norm = normalizeToYmd(k);
    out[norm] = Object.assign({}, out[norm], data[k]);
  });
  return out;
}
