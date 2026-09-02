import { useEffect, useRef, useState } from 'react';
import { pointInRect } from '../utils/navGraph';

/**
 * The RCU screen: the 800x600 capture with the real (extracted) hotspots
 * laid over it in percentage coordinates, so it scales to any size without
 * distorting the art. Also draws the Machine Set drawer, whose order and
 * contents are checked against the Service Manual's own figure (4.4, page 4-18)
 * and against the running program. Weigher Information appears only at
 * Maintenance level and we hold no artwork for it, so it is drawn disabled —
 * a drawer silently missing an item teaches the wrong menu just as surely as
 * one in the wrong order did.
 */
export default function Rcu({
  navmap,
  slug,
  showHotspots,
  highlight,      // null | {kind:'nav', to, via} | {kind:'spot', rect, label}
  lessonActive,
  drawerOpen,
  onToggleDrawer,
  onTap,          // ({type:'nav', to, button}) or ({type:'spot'})
  wrongFlash,     // increments to trigger the wrong-tap flash
}) {
  const { w: CW, h: CH } = navmap.canvas;
  const screen = navmap.screens[slug];
  const ms = navmap.machineSet;
  const [flashing, setFlashing] = useState(false);
  const flashTimer = useRef(null);

  useEffect(() => {
    if (!wrongFlash) return;
    setFlashing(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashing(false), 450);
    return () => clearTimeout(flashTimer.current);
  }, [wrongFlash]);

  if (!screen) return null;

  const pct = (v, total) => `${(v / total) * 100}%`;
  const rectStyle = (r) => ({
    left: pct(r.x, CW),
    top: pct(r.y, CH),
    width: pct(r.w, CW),
    height: pct(r.h, CH),
  });

  const hasBakedTab = ms && ms.screens.includes(slug);
  const drawsTab = ms && (ms.drawTabOn || []).includes(slug);
  const showsDrawer = hasBakedTab || drawsTab;

  const isNavTarget = (h) => {
    if (!highlight || highlight.kind !== 'nav' || h.to !== highlight.to) return false;
    // When a `via` point is given, highlight only the hotspot containing it —
    // several keys (HOME and Exit, say) can lead to the same screen.
    if (highlight.via) return pointInRect(highlight.via, h);
    return true;
  };

  return (
    <div className="rcu-wrap">
      <div
        className={
          'rcu-stage' +
          (showHotspots && !lessonActive ? ' show-hotspots' : '') +
          (flashing ? ' flash-wrong' : '')
        }
        style={{ width: '100%', maxWidth: `calc((100dvh - 120px) * ${CW / CH})` }}
      >
        <img
          className="rcu-screen"
          src={`/${screen.image}`}
          alt={slug}
          draggable={false}
        />

        {screen.hotspots.map((h, i) => (
          <button
            key={`${h.button}-${i}`}
            type="button"
            className={'hotspot' + (isNavTarget(h) ? ' hotspot--target' : '')}
            style={rectStyle(h)}
            aria-label={`Go to ${h.to}`}
            onClick={() => onTap({ type: 'nav', to: h.to, button: h.button })}
          />
        ))}

        {/* Lesson tap-spot: a real key that doesn't navigate */}
        {highlight?.kind === 'spot' && (
          <button
            type="button"
            className="hotspot hotspot--target"
            style={rectStyle(highlight.rect)}
            aria-label={highlight.label}
            onClick={() => onTap({ type: 'spot' })}
          />
        )}

        {/* Machine Set pop-up tab. On most engineering screens the tab is
            baked into the art; the main menu's capture lacks it, so a
            look-alike tab is drawn there (the manual, 6.4 key #8, places
            it exactly here). */}
        {showsDrawer && drawsTab && (
          <button
            type="button"
            className="mset-tab"
            style={{ ...rectStyle(ms.tab), fontSize: 'clamp(8px, 1.4cqw, 13px)' }}
            onClick={onToggleDrawer}
          >
            Machine Set <span aria-hidden="true">≡</span>
          </button>
        )}
        {showsDrawer && hasBakedTab && (
          <button
            type="button"
            className="hotspot"
            style={rectStyle(ms.tab)}
            aria-label="Machine Set pop-up"
            onClick={onToggleDrawer}
          />
        )}

        {showsDrawer && drawerOpen && (
          <div
            className="mset-drawer"
            style={{
              left: pct(ms.tab.x, CW),
              bottom: pct(CH - ms.tab.y, CH),
              width: pct(300, CW),
            }}
          >
            {/* column-reverse: first item ends up nearest the tab */}
            <div className="drawer-note" style={{ padding: '2% 4%', fontSize: 'clamp(7px, 1.2cqw, 11px)' }}>
              order checked against the Service Manual and the real unit
            </div>
            {[...ms.items].reverse().map((item) => (
              <button
                key={item.label}
                type="button"
                disabled={!item.to}
                title={item.note || undefined}
                style={{
                  padding: '2.5% 5%',
                  fontSize: 'clamp(9px, 1.6cqw, 14px)',
                  opacity: item.to ? 1 : 0.45,
                  cursor: item.to ? 'pointer' : 'not-allowed',
                }}
                onClick={() => item.to && onTap({ type: 'nav', to: item.to, drawer: true })}
              >
                {item.label}
                {!item.to && (
                  <span style={{ fontSize: '0.75em', opacity: 0.8 }}> · not captured</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
