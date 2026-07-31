import React, { createContext, useContext, useMemo, useState, useEffect } from 'react';

const AZ_TZ = 'America/Phoenix';
const toAzYmd = (d) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: AZ_TZ, year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(d);

const initialFiveAz = () => {
  const now = new Date();
  return Array.from({ length: 5 }, (_, i) =>
    toAzYmd(new Date(now.getTime() - i * 86400000))
  );
};

const normalizeYmd = (raw) => {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const t = Date.parse(raw);
  return isNaN(t) ? String(raw) : toAzYmd(new Date(t));
};

const sortDesc = (arr) => [...arr].sort((a, b) => new Date(b) - new Date(a));

const DatesContext = createContext(null);

export function DatesProvider({ children }) {
  // Persist under your existing key name so your old state loads
  const [dates, setDates] = useState(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('downtimeLoggerDates') || '[]');
      return Array.isArray(saved) && saved.length ? saved.map(normalizeYmd) : initialFiveAz();
    } catch {
      return initialFiveAz();
    }
  });

  useEffect(() => {
    localStorage.setItem('downtimeLoggerDates', JSON.stringify(dates));
  }, [dates]);

  const updateDateAtIndex = (index, newRaw) => {
    const newDate = normalizeYmd(newRaw);
    setDates((prev) => {
      if (!newDate || prev[index] === newDate) return prev;
      const next = [...prev];
      next[index] = newDate;
      // ensure unique + sorted newest→oldest keeps UI tidy
      return sortDesc(Array.from(new Set(next)));
    });
  };

  const replaceDatesFromDataKeys = (dataObj) => {
    const keys = Object.keys(dataObj || {});
    if (!keys.length) return;
    const next = sortDesc(keys).slice(0, 5);
    setDates(next);
  };

  const value = useMemo(
    () => ({ dates, setDates, updateDateAtIndex, replaceDatesFromDataKeys, toAzYmd }),
    [dates]
  );

  return <DatesContext.Provider value={value}>{children}</DatesContext.Provider>;
}

export function useDates() {
  const ctx = useContext(DatesContext);
  if (!ctx) throw new Error('useDates must be used within DatesProvider');
  return ctx;
}
