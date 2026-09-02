import React, { useMemo, useState } from 'react';
import navmap from '../data/navmap.json';
import { screenInfo } from '../data/screenInfo';

/**
 * Every screen, one tap away.
 *
 * Explore is faithful: you reach a screen the way the machine makes you reach
 * it, and that is the point of it. But a trainer who wants a particular screen
 * in front of somebody should not have to walk the menu tree to get there, and
 * neither should anyone checking the artwork. This lists all of them.
 *
 * It is a deliberate departure from the real unit, which is why it lives in its
 * own mode rather than being available everywhere.
 */

/* Grouped by the family a slug belongs to, so the list reads like the machine
   rather than like an alphabet. */
const GROUPS = [
  ['Home & production', ['main-menu', 'run-']],
  ['Zero, drain, full open', ['zero-adjust', 'discharge-', 'hopper-']],
  ['Presets', ['preset-']],
  ['Totals', ['total-']],
  ['Access level', ['level-']],
  ['Machine set — adjustment', ['manual-', 'autoadj-']],
  ['Machine set — diagnosis', ['selfdiag-']],
  ['Machine set — display & data', ['display-']],
  ['Machine set — parameters', ['various-', 'weigh-']],
  ['Machine set — peripheral', ['pack-']],
  ['Control panel', ['panel-']],
  ['Other', ['assistant', 'memo']],
];

const groupFor = (slug) => {
  for (const [name, prefixes] of GROUPS) {
    if (prefixes.some((p) => (p.endsWith('-') ? slug.startsWith(p) : slug === p))) return name;
  }
  return 'Other';
};

export default function ScreenIndex({ current, onPick }) {
  const [filter, setFilter] = useState('');

  const grouped = useMemo(() => {
    const q = filter.trim().toLowerCase();
    const out = new Map(GROUPS.map(([name]) => [name, []]));
    out.set('Other', out.get('Other') || []);
    for (const slug of Object.keys(navmap.screens)) {
      const title = screenInfo[slug]?.title || slug;
      if (q && !`${title} ${slug}`.toLowerCase().includes(q)) continue;
      const name = groupFor(slug);
      if (!out.has(name)) out.set(name, []);
      out.get(name).push({ slug, title, captured: navmap.screens[slug].captured });
    }
    return [...out.entries()].filter(([, items]) => items.length);
  }, [filter]);

  const total = grouped.reduce((n, [, items]) => n + items.length, 0);

  return (
    <div className="screen-index">
      <div className="screen-index__head">
        <h2>All screens</h2>
        <p>
          Jump straight to any of them. Nothing is gated in this mode — the power
          rules and the menu tree still apply on a real machine, and Explore is
          where they hold.
        </p>
        <input
          className="screen-index__filter"
          value={filter}
          placeholder="Filter by name…"
          onChange={(e) => setFilter(e.target.value)}
          aria-label="Filter screens by name"
        />
        <span className="screen-index__count">
          {total} screen{total === 1 ? '' : 's'}
        </span>
      </div>

      {grouped.map(([name, items]) => (
        <section key={name} className="screen-index__group">
          <h3>{name}</h3>
          <div className="screen-index__list">
            {items.map(({ slug, title, captured }) => (
              <button
                key={slug}
                type="button"
                className={'screen-index__item' + (slug === current ? ' is-current' : '')}
                onClick={() => onPick(slug)}
              >
                <span className="screen-index__title">{title}</span>
                {captured && (
                  <span
                    className="screen-index__tag"
                    title="Photographed from the running original rather than extracted, so it carries the emulator's rendering"
                  >
                    captured
                  </span>
                )}
              </button>
            ))}
          </div>
        </section>
      ))}

      {!total && <p className="screen-index__empty">Nothing matches “{filter}”.</p>}
    </div>
  );
}
