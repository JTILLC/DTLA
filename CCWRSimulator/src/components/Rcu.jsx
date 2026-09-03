import React, { useEffect, useRef, useState } from 'react';
import { pointInRect, conditionsMet } from '../utils/navGraph';
import { shownValues, formatValue } from '../utils/feeder';
import ZeroAdjustPans from './ZeroAdjustPans';
import FeederChart from './FeederChart';
import ProductionRing from './ProductionRing';
import { bar as timingBar, visibleRows, hasSections, rowOf, rowLabel, valueKey } from '../utils/timing';

/**
 * The RCU screen: the 800x600 capture with the real (extracted) hotspots
 * laid over it in percentage coordinates, so it scales to any size without
 * distorting the art. Also draws the two pop-up drawers: Machine Set, whose
 * order and contents are checked against the Service Manual's own figure (4.4,
 * page 4-18) and against the running program, and Select Total, checked
 * against Operation Manual Table 6-32 (6.11) and the running program.
 * Weigher Information appears only at
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
  openDrawer,     // null | 'machineSet' | 'selectTotal'
  onToggleDrawer, // (name) => void
  onTap,          // ({type:'nav', to, button, requiresPower}) | ({type:'spot'}) | ({type:'power'})
  wrongFlash,     // increments to trigger the wrong-tap flash
  powerOn,        // control power: red/OFF or green/ON chip on the Power key
  powerBusy,      // true while the "Please wait a moment." power-up runs
  gatingOff,      // Free mode: nothing is withheld, so nothing is drawn as dead
  loadedPreset,   // which preset tile is currently loaded (Select Preset)
  selection,      // Zero Adjustment: 'wh' | 'df' | null — never both
  zeroing,        // true while "Please wait a moment." runs
  feeder,         // Feeder Adjustment state (see utils/feeder.js)
  notice,         // transient message (e.g. tapping a dead key with power off)
  flags,          // the machine's state: level, running, drain, lamps… (+ power)
  typed,          // what is typed on an open keypad
  timing,         // Timing Adjustment: selected row + values (utils/timing.js)
  machineOptions, // which units the machine has: {bh, th, dth}
  blink,          // the ? key: every pressable key blinks
}) {
  const { w: CW, h: CH } = navmap.canvas;
  const screen = navmap.screens[slug];
  const ms = navmap.machineSet;
  const st = navmap.selectTotal;
  const [flashing, setFlashing] = useState(false);
  const flashTimer = useRef(null);
  const [powerFrame, setPowerFrame] = useState(0);

  useEffect(() => {
    if (!powerBusy) { setPowerFrame(0); return undefined; }
    const t = setInterval(() => setPowerFrame((f) => Math.min(f + 1, 3)), 900);
    return () => clearInterval(t);
  }, [powerBusy]);

  useEffect(() => {
    if (!wrongFlash) return;
    setFlashing(true);
    clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashing(false), 450);
    return () => clearTimeout(flashTimer.current);
  }, [wrongFlash]);

  if (!screen) return null;

  const tiles = navmap.presetTiles?.tiles || [];
  const loaded = tiles.find((t) => t.no === loadedPreset) || tiles[0] || { no: 1, name: '', target: '' };

  /* Zero Adjustment shows what is selected by colouring the shapes blue, so
     the screen has one image per state rather than an overlay. */
  const za = navmap.zeroAdjust;
  const zaHere = za && za.screen === slug;
  /* The art answers to the machine's state: the Main Menu at Maintenance
     level has the Preset key and the Machine Set handle, the Weight page
     with Average Control on has its Lower Weight Limit. */
  // Timing Adjustment: the background is the capture of the selected row.
  const ta = navmap.timingAdjust;
  const taScreen = ta?.screens?.[slug] || null;
  const imageFor = () => {
    if (taScreen && timing) {
      // A booster machine shows its boosters on every cutaway.
      const key = rowOf(ta, timing.sel).cutaway;
      return (machineOptions?.bh && taScreen.cutawaysBH?.[key]) || taScreen.cutaways[key];
    }
    for (const [flag, image] of Object.entries(screen.imageBy || {})) {
      if (flags?.[flag] === true || (flag === 'level4' && flags?.level === 4)) return image;
    }
    return screen.image;
  };
  const holds = (when) => {
    if (!when) return true;
    if (when === 'stopped') return !flags?.running;
    if (when === 'level4') return flags?.level === 4;
    return Boolean(flags?.[when]);
  };

  const zaAnySelected = zaHere && selection
    && (selection.table || (selection.heads && selection.heads.length > 0));

  const faAll = navmap.feederAdjust;
  const faScreen = faAll?.screens?.[slug]
    || (screen.keepChart && faAll?.screens?.[screen.parent]) || null;
  const fa = faScreen ? { ...faAll, ...faScreen } : faAll;
  // A pop-up locks every other key on the original; the chart underneath
  // still shows, but the Feeder Adjust keys must not answer.
  const popupHere = screen.kind === 'popup';
  const feederShown = feeder && faScreen
    ? { time: formatValue(shownValues(feeder).time), amp: formatValue(shownValues(feeder).amp) }
    : { time: '', amp: '' };

  const pct = (v, total) => `${(v / total) * 100}%`;
  const rectStyle = (r) => ({
    left: pct(r.x, CW),
    top: pct(r.y, CH),
    width: pct(r.w, CW),
    height: pct(r.h, CH),
  });

  // On the Main Menu the handle exists only at Maintenance level (the frame
  // script shows Conp01 when KRlevel == 4), and the level-4 capture has it
  // baked in, so there it is a hotspot and never a drawn look-alike.
  const atMaintenance = flags?.level === 4;
  const mainMenuHere = slug === 'main-menu';
  const hasBakedTab = ms && (ms.screens.includes(slug) || (mainMenuHere && atMaintenance));
  const drawsTab = ms && (ms.drawTabOn || []).includes(slug) && !mainMenuHere;
  const showsDrawer = (hasBakedTab || drawsTab) && !(mainMenuHere && !atMaintenance);

  // The Select Total tab is baked into every capture that carries it (the
  // Main Menu and the six Total views), so it only ever needs an invisible
  // hotspot — never a drawn look-alike tab.
  const showsTotalTab = st && st.screens.includes(slug);

  // H DRV Spec Set's ▼Parameter1 header. The open list was never captured
  // (it did not respond under Ruffle), so the list is drawn, like the Select
  // Total drawer, and a picked set is written over the header's baked text.
  const hp = navmap.hdrvParameter;
  const hpHere = hp && hp.screens.includes(slug);
  const hpCurrent = (hpHere && flags?.hdrvParam?.[slug]) || 1;

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
          (blink ? ' blink-keys' : '') +
          (popupHere ? ' popup-open' : '') +
          (flashing ? ' flash-wrong' : '')
        }
        style={{ width: '100%', maxWidth: `calc((100dvh - 120px) * ${CW / CH})` }}
      >
        <img
          className="rcu-screen"
          src={`/${imageFor()}`}
          style={(zaHere || faScreen?.labelMap) ? { visibility: 'hidden' } : undefined}
          alt={slug}
          draggable={false}
        />

        {screen.hotspots.filter((h) => h.action !== 'zero-start'
          // The Target Wt key exists only while the dispersion feeder is picked.
          && (!h.dfOnly || feeder?.feeder === 'df')).map((h, i) => {
          const dead = !gatingOff && (
            (h.requiresPower && !powerOn)
            || !conditionsMet(h.requires, flags || {}, false));
          const what = h.label || (h.action === 'key' ? `Key ${h.char}` : h.to ? `Go to ${h.to}` : 'Key');
          return (
            <button
              key={`${h.button || h.label || h.to}-${i}`}
              type="button"
              className={
                'hotspot' +
                (isNavTarget(h) ? ' hotspot--target' : '') +
                (dead ? ' hotspot--gated' : '') +
                (h.action === 'key' ? ' hotspot--key' : '')
              }
              style={rectStyle(h)}
              aria-label={dead ? `${what} (dead in this state)` : what}
              title={h.note || (dead ? `${what} — dead in this state` : what)}
              onClick={() => onTap({
                type: 'nav', to: h.to, button: h.button, requiresPower: h.requiresPower,
                requires: h.requires, sets: h.sets, toggles: h.toggles,
                action: h.action, char: h.char, note: h.note, label: h.label, commit: h.commit,
              })}
            />
          );
        })}

        {/* Crops composited over the art: the Feeder tab's slide-out drawer
            over whichever chart mode is showing. */}
        {(screen.layers || []).map((l, i) => (
          <div key={`layer-${i}`} className="rcu-layer" style={rectStyle(l)}>
            <img
              src={`/${l.image}`}
              alt=""
              draggable={false}
              style={{
                width: `${(CW / l.w) * 100}%`,
                height: `${(CH / l.h) * 100}%`,
                left: `${-(l.x / l.w) * 100}%`,
                top: `${-(l.y / l.h) * 100}%`,
              }}
            />
          </div>
        ))}

        {/* Keys whose look follows the machine's state — Stop grey and Start
            lit once stopped, Drain STOP lit while draining — cut from captures
            of those states. */}
        {(screen.overlays || []).filter((o) => holds(o.when)).map((o, i) => (
          <img key={`ov-${i}`} className="key-lit key-lit--overlay" src={`/${o.image}`} alt="" style={rectStyle(o)} />
        ))}

        {/* Lamps: the small green bar at a key's edge while its flag holds. */}
        {(screen.lamps || []).filter((l) => flags?.[l.flag]).map((l, i) => (
          <img key={`lamp-${i}`} className="fa-lamp-on" src="/keys/lamp-on.png" alt="" style={rectStyle(l)} />
        ))}

        {/* An open keypad or keyboard: what has been typed, over the field. */}
        {screen.keypad && (
          <div
            className={'keypad-field' + (screen.keypad.password ? ' keypad-field--password' : '')}
            style={rectStyle(screen.keypad.field)}
            aria-live="polite"
          >
            <span className="keypad-field__value">
              {screen.keypad.password ? '•'.repeat(typed.length) : typed}
            </span>
          </div>
        )}

        {/* The Power key, and the lit keys that follow from it.
            The artwork is a fixed JPEG of a machine with its control power
            off, so pressing Power cannot recolour the pixels underneath.
            Instead the two keys that actually change — cut out of a powered
            capture by tools/extract_keys.py — are laid over the art.

            The lit Start is drawn ONLY where a power-gated hotspot exists,
            so the picture and the behavior come from the same fact and
            cannot drift: a key shown green is a key that works. Screens where
            we never checked what the bottom bar does show nothing, which is
            the honest answer. */}
        {navmap.powerKey && (
          <button
            type="button"
            className={
              'power-key' +
              (highlight?.kind === 'power' ? ' hotspot--target' : '') +
              (powerOn ? ' power-key--on' : '')
            }
            style={rectStyle(navmap.powerKey)}
            aria-label={`Power key — control power is ${powerBusy ? 'starting' : powerOn ? 'on' : 'off'}`}
            onClick={() => onTap({ type: 'power' })}
          >
            {powerOn && !powerBusy && (
              <img className="key-lit" src="/keys/power-on.png" alt="" />
            )}
          </button>
        )}

        {powerOn && !powerBusy && screen.hotspots
          .filter((h) => h.requiresPower)
          .map((h, i) => (
            <img
              key={`lit-${i}`}
              className="key-lit key-lit--overlay"
              src="/keys/start-on.png"
              alt=""
              style={rectStyle(h)}
            />
          ))}

        {/* Select Preset's tiles. Pressing one loads that preset on the real
            unit and rewrites the line above the grid; the screens here are a
            fixed capture, so the tile is marked and that one line is redrawn
            from the tile's own values. Nothing else can change, and the notice
            says so. */}
        {navmap.presetTiles && navmap.presetTiles.screen === slug && (
          <>
            <div
              className="preset-header"
              style={{
                ...rectStyle(navmap.presetTiles.header),
                background: navmap.presetTiles.header.bg,
              }}
            >
              <span className="preset-header__no">Preset No. {loaded.no}</span>
              <span className="preset-header__name">
                {loaded.name || `(empty — preset ${loaded.no})`}
              </span>
              <span className="preset-header__wt">{loaded.target}</span>
            </div>
            {navmap.presetTiles.tiles.map((t) => (
              <button
                key={t.no}
                type="button"
                className={'preset-tile' + (t.no === loaded.no ? ' preset-tile--loaded' : '')}
                style={rectStyle(t)}
                title={
                  t.configured
                    ? `Preset ${t.no}: ${t.name}, ${t.target} at ${t.speed}`
                    : `Preset ${t.no} — empty on this machine`
                }
                onClick={() => onTap({ type: 'preset', no: t.no })}
              >
                {t.no === loaded.no && <span className="preset-tile__flag">LOADED</span>}
              </button>
            ))}
          </>
        )}

        {zaHere && (
          <ZeroAdjustPans
            image={screen.image}
            labelMap={za.labelMap}
            tableLabel={za.tableLabel}
            selection={selection}
            showHotspots={showHotspots}
            onTapPan={(no) => onTap({ type: 'pan', no })}
            onTapTable={() => onTap({ type: 'pan-table' })}
          />
        )}

        {zaHere && ['df', 'wh'].map((which) => {
          const key = za.keys[which];
          const on = which === 'df' ? selection.table
            : (selection.heads.length === za.panCount && !selection.table);
          return (
            <button
              key={which}
              type="button"
              className={'za-key' + (on ? ' za-key--on' : '')}
              style={rectStyle(key)}
              aria-label={`${key.label} — ${on ? 'selected' : 'not selected'}`}
              title={`${key.label}: selects (or clears) the whole group`}
              onClick={() => onTap({ type: 'select', which })}
            />
          );
        })}

        {/* The in-screen Start. Dimmed in the artwork; it lights only when
            something is selected AND the control power is on, so the lit key is
            laid over it exactly then. */}
        {zaHere && (
          <button
            type="button"
            className={'za-key za-start' + (zaAnySelected && powerOn ? ' za-start--live' : '')}
            style={rectStyle(za.keys.start)}
            aria-label={`Start — ${zaAnySelected && powerOn ? 'ready' : 'dead'}`}
            title={zaAnySelected && powerOn
              ? 'Start: begins zero adjustment on what is selected'
              : (!powerOn ? 'Start: dead — the machine is not powered on'
                          : 'Start: dead — nothing is selected')}
            onClick={() => onTap({ type: 'zero-start' })}
          >
            {zaAnySelected && powerOn && !zeroing && (
              <img className="key-lit" src="/keys/za-start-on.png" alt="" />
            )}
          </button>
        )}

        {/* 4.4.6: "The message 'Please wait a moment.' will appear and zero
            adjustment will start." It shows in the bar's own message panel. */}
        {zaHere && zeroing && (
          <div className="za-message" style={rectStyle(za.messageBar)} role="status">
            {za.message}
          </div>
        )}

        {/* Feeder Adjustment (6.12): pick the heads, light Time and/or AMP,
            then Increase or Decrease. The screen's own graphs are empty in the
            artwork, so the values are drawn into the lamp keys the way the
            Production feeder screen prints them. */}
        {faScreen && faScreen.style === 'preset' && feeder && (
          <>
            {['rf', 'df'].map((which) => (
              <button
                key={which}
                type="button"
                className={'fa-key' + (feeder.feeder === which ? ' fa-key--on' : '')}
                style={rectStyle(fa.keys[which])}
                aria-label={`${fa.keys[which].label} — ${feeder.feeder === which ? 'selected' : 'not selected'}`}
                title={fa.keys[which].note || (which === 'rf'
                  ? 'Radial feeders — one per head, so the head strip applies'
                  : 'Dispersion feeder — a single feeder, no head selection')}
                /* The (1) is a toggle on the program: pressed again it clears. */
                onClick={() => onTap({ type: 'feeder-select',
                  which: which === 'df' && feeder.feeder === 'df' ? 'rf' : which })}
              />
            ))}

            {/* Seen on the running program: with DF picked the (1) is blue and
                a Target Wt key appears above Read OptimumVal, showing the DF
                target weight. Both are cut from that capture. */}
            {feeder.feeder === 'df' && faScreen.dfOn && (
              <img className="key-lit key-lit--overlay" src={`/${faScreen.dfOn.image}`} alt=""
                style={rectStyle(faScreen.dfOn)} />
            )}
            {feeder.feeder === 'df' && faScreen.targetWt && (
              <>
                <img className="key-lit key-lit--overlay" src={`/${faScreen.targetWt.image}`} alt=""
                  style={rectStyle(faScreen.targetWt)} />
                <span className="fa-run-value fa-run-value--top" style={rectStyle(faScreen.targetWt.value)}>
                  {feeder.dfTargetWt}
                </span>
              </>
            )}

            {/* The bars ARE the values (measured off the program, see
                feederAdjust.screens.preset-feeder.bars): a navy Time bar and a
                magenta AMP bar per head, 1 px per unit, and the DF pair on its
                own baseline. They grow and shrink as Increase and Decrease are
                pressed. */}
            {faScreen.bars && (() => {
              const b = faScreen.bars;
              const bar = (key, x, w, baseline, v, param) => (
                <div
                  key={key}
                  className="fa-bar"
                  style={{
                    left: pct(x, CW),
                    width: pct(w, CW),
                    top: pct(baseline - v * b.pxPerUnit, CH),
                    height: pct(v * b.pxPerUnit, CH),
                    background: b.colours[param],
                  }}
                />
              );
              return [
                ...fa.heads.flatMap((h) => {
                  const x = b.rf.x0 + b.rf.pitch * (h.no - 1);
                  return [
                    bar(`t${h.no}`, x + b.rf.time.dx, b.rf.time.w, b.rf.baseline, feeder.rf[h.no].time, 'time'),
                    bar(`a${h.no}`, x + b.rf.amp.dx, b.rf.amp.w, b.rf.baseline, feeder.rf[h.no].amp, 'amp'),
                  ];
                }),
                bar('dft', b.df.time.x, b.df.time.w, b.df.baseline, feeder.df.time, 'time'),
                bar('dfa', b.df.amp.x, b.df.amp.w, b.df.baseline, feeder.df.amp, 'amp'),
              ];
            })()}

            {/* The lamp on each key goes green while that parameter is lit —
                the same lamp Production's keys use. */}
            {faScreen.lamps && ['time', 'amp'].filter((w) => feeder.params[w]).map((which) => (
              <img
                key={`lamp-${which}`}
                className="fa-lamp-on"
                src={`/${faAll.lampOn}`}
                alt=""
                style={rectStyle(faScreen.lamps[which])}
              />
            ))}

            {['time', 'amp'].map((which) => (
              <button
                key={which}
                type="button"
                className={'fa-key fa-lamp' + (feeder.params[which] && !faScreen.lamps ? ' fa-lamp--lit' : '')}
                style={rectStyle(fa.keys[which])}
                aria-label={`${fa.keys[which].label} lamp — ${feeder.params[which] ? 'lit' : 'off'}`}
                title={`${fa.keys[which].label}: light it, then press Increase or Decrease`}
                onClick={() => onTap({ type: 'feeder-param', which })}
              >
                <span className="fa-value">{feederShown[which]}</span>
              </button>
            ))}

            {[['up', +1], ['down', -1]].map(([which, dir]) => {
              /* Dimmed in the artwork, and dead on the real unit until there is
                 something to move: a lamp lit, and on RF a head selected. */
              const live = (feeder.params.time || feeder.params.amp)
                && (feeder.feeder === 'df' || feeder.heads.length > 0);
              return (
                <button
                  key={which}
                  type="button"
                  className={'fa-key fa-arrow' + (live ? ' fa-arrow--live' : '')}
                  style={rectStyle(fa.keys[which])}
                  aria-label={`${fa.keys[which].label} — ${live ? 'ready' : 'dead'}`}
                  title={live
                    ? `${fa.keys[which].label} the lit values of the selected head(s)`
                    : `${fa.keys[which].label}: dead — light Time or AMP first`
                      + (feeder.feeder === 'rf' ? ', and select a head' : '')}
                  onClick={() => onTap({ type: 'feeder-adjust', direction: dir })}
                >
                  {live && <img className="key-lit" src={`/${fa.arrowLit[which]}`} alt="" />}
                </button>
              );
            })}

            {feeder.feeder === 'rf' && fa.heads.map((h) => (
              <button
                key={h.no}
                type="button"
                className={'fa-head' + (feeder.heads.includes(h.no) ? ' fa-head--on' : '')}
                style={rectStyle(h)}
                aria-label={`Head ${h.no} — ${feeder.heads.includes(h.no) ? 'selected' : 'not selected'}`}
                title={`Head ${h.no}: RF time ${feeder.rf[h.no].time.toFixed(1)}, amp ${feeder.rf[h.no].amp.toFixed(1)}`}
                onClick={() => onTap({ type: 'feeder-head', no: h.no })}
              />
            ))}
          </>
        )}

        {/* Production's Feeder Adjust (6.12). Same procedure, different keys:
            the lamp on each key goes GREEN when that parameter is selected, and
            the arrows move the values of the selected pans. */}
        {faScreen && faScreen.style === 'run' && feeder && (
          <>
            {/* The dispersion feeder's key is the ① printed on the centre
                disc (found on the original: the disc turns blue, the arrow
                reads DF, the chart draws circles). Press again for RF. */}
            <button
              type="button"
              className={'fa-key fa-round' + (feeder.feeder === 'df' ? ' fa-key--on' : '')}
              style={rectStyle(faScreen.keys.rf)}
              aria-label={`${faScreen.keys.rf.label} — ${feeder.feeder === 'df' ? 'selected' : 'not selected'}`}
              title={faScreen.keys.rf.note}
              onClick={() => onTap({ type: 'feeder-select', which: feeder.feeder === 'rf' ? 'df' : 'rf' })}
            />

            {['time', 'amp'].map((which) => (
              <button
                key={which}
                type="button"
                className="fa-key fa-lamp"
                style={rectStyle(faScreen.keys[which])}
                aria-label={`${faScreen.keys[which].label} lamp — ${feeder.params[which] ? 'lit' : 'off'}`}
                title={`${faScreen.keys[which].label}: light it, then press Increase or Decrease`}
                onClick={() => onTap({ type: 'feeder-param', which })}
              />
            ))}

            {/* The lamp itself, lifted off the artwork's own lit AMP key. */}
            {['time', 'amp'].filter((w) => feeder.params[w]).map((which) => (
              <img
                key={`lamp-${which}`}
                className="fa-lamp-on"
                src={`/${faAll.lampOn}`}
                alt=""
                style={rectStyle(faScreen.lamps[which])}
              />
            ))}

            {/* Live values over the ones baked into the key. */}
            {['time', 'amp'].map((which) => (
              <span
                key={`val-${which}`}
                className="fa-run-value"
                style={rectStyle(faScreen.values[which])}
              >
                {feederShown[which]}
              </span>
            ))}

            {/* The CIRCULAR keys are Increase and Decrease: arrows out of the
                red ring raise, arrows into it lower. The -> and <- arrows are
                something else and are left unwired until the original says
                what. */}
            {[['up', +1], ['down', -1]].map(([which, dir]) => {
              const live = (feeder.params.time || feeder.params.amp)
                && (feeder.feeder === 'df' || feeder.heads.length > 0);
              return (
                <button
                  key={which}
                  type="button"
                  className={'fa-key fa-round' + (live ? ' fa-round--live' : '')}
                  style={rectStyle(faScreen.keys[which])}
                  aria-label={`${faScreen.keys[which].label} — ${live ? 'ready' : 'dead'}`}
                  title={live
                    ? `${faScreen.keys[which].label} the lit values of the selected pans`
                    : 'Dead — light Time or AMP first'
                      + (feeder.feeder === 'rf' ? ', and select a head' : '')}
                  onClick={() => onTap({ type: 'feeder-adjust', direction: dir })}
                />
              );
            })}

            {/* The trough wedges, the radar chart's outer ring and the
                magenta amplitude trace, all drawn live on one canvas: tapping a
                head turns its whole wedge AND its ring segment blue, and its
                amplitude marker sits further out the higher the value. */}
            <FeederChart
              baseImage={faScreen.baseImage}
              wedgeMap={faScreen.labelMap}
              ringMap={faScreen.ringMap}
              chart={faScreen.chart}
              heads={feeder.heads}
              values={feeder.rf}
              params={feeder.params}
              df={feeder.feeder === 'df'}
              dfValues={feeder.df}
              showHotspots={showHotspots}
              onTapHead={(no) => onTap({ type: 'feeder-pan', no })}
            />

            {/* With DF picked a real CCW-R relabels the top row: DF Time, DF
                AMP, DF Weight and Target Wt. Drawn from a photograph of a
                running machine — the Flash program keeps its RF labels — and
                the screen's notes say so. */}
            {feeder.feeder === 'df' && faScreen.dfKeys && (
              <>
                {Object.values(faScreen.dfKeys).map((k) => (
                  /* Key faces only: they sit UNDER the lamps and the live
                     values, which are drawn over them exactly as over the
                     RF keys they replace. */
                  <img key={k.image} className="key-lit key-lit--overlay fa-df-key" src={`/${k.image}`} alt=""
                    style={rectStyle(k)} title={faScreen.dfNote} />
                ))}
                {!popupHere && (
                  <button
                    type="button"
                    className="fa-key fa-lamp"
                    style={rectStyle(faScreen.dfKeys.weight)}
                    aria-label={`DF Weight lamp — ${feeder.params.weight ? 'lit' : 'off'}`}
                    title={'DF Weight: weight control of the dispersion feeder, held at the Target Wt beside it. '
                      + 'Drawn from a photograph; what Increase and Decrease do with it lit was not seen.'}
                    onClick={() => onTap({ type: 'feeder-param', which: 'weight' })}
                  />
                )}
                {feeder.params.weight && (
                  <img className="fa-lamp-on" src={`/${faAll.lampOn}`} alt=""
                    style={rectStyle(faScreen.dfWeightLamp)} />
                )}
                <span className="fa-run-value fa-run-value--top fa-run-value--centre"
                  style={rectStyle(faScreen.dfTargetValue)}>
                  {feeder.dfTargetWt}
                </span>
              </>
            )}

            {/* A trainer's key (not on the RCU): back to head 1 alone. */}
            {faScreen.deselectKey && !popupHere && (
              <button
                type="button"
                className="rcu-key-drawn"
                style={{ ...rectStyle(faScreen.deselectKey), fontSize: `clamp(7px, ${(11 / CW) * 100}cqw, 14px)` }}
                title={faScreen.deselectKey.note}
                aria-label="Deselect — back to head 1 alone"
                disabled={feeder.feeder === 'rf' && feeder.heads.length === 1 && feeder.heads[0] === 1}
                onClick={() => onTap({ type: 'feeder-deselect' })}
              >
                {faScreen.deselectKey.label}
              </button>
            )}

            {faScreen.dfLabel && feeder.feeder === 'df' && (
              <img className="key-lit key-lit--overlay" src={`/${faScreen.dfLabel.image}`} alt="DF"
                style={rectStyle(faScreen.dfLabel)} />
            )}

            {(faScreen.unknownKeys || []).map((k, i) => (
              <div
                key={`unk-${i}`}
                className="fa-unknown"
                style={rectStyle(k)}
                title={`${k.label}: ${k.note}`}
              />
            ))}
          </>
        )}

        {/* Power-up: the original shows "Please wait a moment." with an
            hourglass and a progress bar for ~10 s, the whole bottom bar (HOME
            included) locked out. These are four frames of that pop-up cut
            from captures of the real thing, played in turn. */}
        {powerBusy && (
          <img
            className="power-popup-art"
            src={`/keys/power-wait-${powerFrame}.png`}
            alt="Please wait a moment — powering up"
            style={rectStyle({ x: 180, y: 180, w: 392, h: 186 })}
            draggable={false}
          />
        )}

        {notice && (
          <div className="rcu-notice" role="alert">
            {notice}
          </div>
        )}

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
            onClick={() => onToggleDrawer('machineSet')}
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
            onClick={() => onToggleDrawer('machineSet')}
          />
        )}

        {showsDrawer && openDrawer === 'machineSet' && (
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

        {/* Timing Adjustment (6.13): the table is drawn from the values — the
            rows depend on which units the machine has — over a capture of the
            selected row's cutaway with its table erased. Rows are keys, the
            arrows step the selected one by 10 or 100 ms, and the bars are a
            timeline: each starts where the ones before it end. */}
        {taScreen && timing && (() => {
          const tb = taScreen.table;
          const rows = visibleRows(ta, machineOptions);
          const selRow = rowOf(ta, timing.sel);
          const sections = hasSections(machineOptions);
          const sec = sections ? ta.sections[String(timing.section)] : ta.single;
          const fontPx = (px) => `clamp(6px, ${(px / CW) * 100}cqw, ${px * 1.5}px)`;
          const dthBase = (timing.section - 1) * 2 + 1;
          const unitLit = (unit) => selRow.unit === unit;
          const cw = taScreen.cutaway;
          return (
            <>
              {/* Header: section and heads on one line, the selected row on the next. */}
              <div className="ta-header" style={{ ...rectStyle(taScreen.header), fontSize: fontPx(taScreen.header.textPx) }} aria-hidden="true">
                <span>{sec.label}:{sec.heads}</span>
                <span>{rowLabel(selRow, timing)}</span>
              </div>
              {sections && (
                <div className="ta-lamps" style={rectStyle(taScreen.c12)}>
                  {[1, 2].map((n) => (
                    <button
                      key={n}
                      type="button"
                      className={'ta-lamp' + (timing.section === n ? ' ta-lamp--on' : '')}
                      style={{ fontSize: fontPx(9) }}
                      aria-label={`${ta.sections[String(n)].label} — heads ${ta.sections[String(n)].heads}${timing.section === n ? ', selected' : ''}`}
                      title={`${ta.sections[String(n)].label}: heads ${ta.sections[String(n)].heads}. ${n === 1 ? 'Adjusts TH1; owns DTH1 and DTH2.' : 'Adjusts TH2; owns DTH3 and DTH4.'}`}
                      onClick={() => onTap({ type: 'timing-section', section: n })}
                    >
                      <i /> {ta.sections[String(n)].label}
                    </button>
                  ))}
                </div>
              )}

              {rows.map((row, i) => {
                const y = tb.top + i * tb.pitch;
                const sel = timing.sel === row.key;
                const v = timing.values[valueKey(row, timing)];
                const b = timingBar(timing, ta, taScreen.bar, row);
                const label = rowLabel(row, timing);
                return (
                  <React.Fragment key={row.key}>
                    <button
                      type="button"
                      className={'ta-cell' + (sel ? ' ta-cell--sel' : '')}
                      style={{ ...rectStyle({ x: tb.x, y, w: tb.right - tb.x, h: tb.rowH }), fontSize: fontPx(tb.textPx) }}
                      aria-label={`${label} row — ${v} ms${sel ? ', selected' : ''}`}
                      title={row.desc}
                      onClick={() => onTap({ type: 'timing-row', key: row.key })}
                    >
                      <span className="ta-cell__label" style={{ left: pct(tb.labelX - tb.x, tb.right - tb.x) }}>
                        <i /> {label}
                      </span>
                      <span className="ta-cell__value" style={{ right: pct(tb.right - tb.valueRight, tb.right - tb.x) }}>{v}</span>
                      <span className="ta-cell__divider" style={{ left: pct(tb.divider - tb.x, tb.right - tb.x) }} />
                      <span className="ta-cell__divider" style={{ left: pct(taScreen.bar.x - 1 - tb.x, tb.right - tb.x) }} />
                    </button>
                    {b.w > 0 && (
                      <div
                        className="ta-bar"
                        style={{
                          ...rectStyle({ x: b.x, y: y + taScreen.bar.inset, w: b.w, h: tb.rowH - 2 * taScreen.bar.inset }),
                          background: taScreen.bar.colour,
                        }}
                      />
                    )}
                  </React.Fragment>
                );
              })}

              {machineOptions?.dth && (
                <div className="ta-lamps ta-lamps--radio" style={rectStyle(taScreen.dthRadio)}>
                  {[0, 1].map((pick) => (
                    <button
                      key={pick}
                      type="button"
                      className={'ta-lamp' + (timing.dthPick === pick ? ' ta-lamp--on' : '')}
                      style={{ fontSize: fontPx(9) }}
                      aria-label={`DTH${dthBase + pick}${timing.dthPick === pick ? ', selected' : ''}`}
                      title={`The IS-DTH row edits DTH${dthBase + pick} (${sec.label} owns DTH${dthBase} and DTH${dthBase + 1})`}
                      onClick={() => onTap({ type: 'timing-dth', pick })}
                    >
                      <i /> DTH{dthBase + pick}
                    </button>
                  ))}
                </div>
              )}

              {[['dec100', -100], ['dec10', -10], ['inc10', 10], ['inc100', 100]].map(([k, delta]) => (
                <button
                  key={k}
                  type="button"
                  className="hotspot"
                  style={rectStyle(taScreen.keys[k])}
                  aria-label={taScreen.keys[k].label}
                  title={`${taScreen.keys[k].label} on the selected row (${rowLabel(selRow, timing)})`}
                  onClick={() => onTap({ type: 'timing-step', delta })}
                />
              ))}

              {/* Look-alike units on the cutaway. The boosters are in the
                  artwork (the weigh-hopper ring cut and set one ring lower,
                  see tools/timing_table.py); the timing hopper under the
                  chute and the section's two diverting timing hoppers below
                  it are drawn. They light the way the captured hoppers do. */}
              {machineOptions?.th && (
                <div className={'ta-unit-box' + (unitLit('th') ? ' ta-unit--lit' : '')} style={{ ...rectStyle(cw.th), fontSize: fontPx(9) }} aria-hidden="true" title="Timing hopper (drawn)">
                  TH{timing.section}
                </div>
              )}
              {machineOptions?.dth && (
                <div className="ta-unit-pair" style={rectStyle(cw.dth)} aria-hidden="true" title="Diverting timing hoppers (drawn)">
                  {[0, 1].map((pick) => (
                    <span key={pick} className={'ta-unit-box' + (unitLit('dth') && timing.dthPick === pick ? ' ta-unit--lit' : '')} style={{ fontSize: fontPx(8) }}>
                      DTH{dthBase + pick}
                    </span>
                  ))}
                </div>
              )}
            </>
          );
        })()}

        {/* The access level's dots on the key icon. Every extracted frame
            carries four lit (the movie was dumped at Maintenance), so they
            are drawn from the live level: Operator 1, up to Maintenance 4. */}
        {navmap.levelDots && (
          <div className="level-dots" style={rectStyle({ x: navmap.levelDots.x, y: navmap.levelDots.y,
            w: navmap.levelDots.gap * (navmap.levelDots.n - 1) + navmap.levelDots.d, h: navmap.levelDots.d })} aria-hidden="true"
            title={`Access level ${flags?.level ?? 1} of 4`}>
            {Array.from({ length: navmap.levelDots.n }, (_, i) => (
              <i key={i} className={i < (flags?.level ?? 1) ? 'is-lit' : ''} />
            ))}
          </div>
        )}

        {/* Production's Combination screen, running: the combination badges,
            the readout and the scrolling legend (components/ProductionRing). */}
        {navmap.production && navmap.production.screen === slug && (
          <ProductionRing spec={navmap.production} running={Boolean(flags?.running)} rectStyle={rectStyle} pct={pct} CW={CW} />
        )}

        {/* Values the artwork cannot change, written over it: a field's
            picked entry, a header's picked set. Data-driven (screen.liveText);
            the baked art shows through while the value is the default. */}
        {(screen.liveText || []).map((t, i) => {
          const v = flags?.[t.flag] ?? t.default;
          if (v === t.default && t.style !== 'field') return null;
          const text = t.template ? t.template.replace('{v}', v) : (t.labels?.[v] ?? String(v));
          return (
            <div
              key={`lt-${i}`}
              className={'live-text' + (t.style === 'header' ? ' hdrv-header' : ' live-text--field')}
              style={{ ...rectStyle(t.rect), fontSize: `clamp(6px, ${(t.textPx / CW) * 100}cqw, ${t.textPx * 1.5}px)`,
                background: t.bg, color: t.colour }}
              aria-hidden="true"
              title={t.note}
            >
              {text}
            </div>
          );
        })}

        {hpHere && (
          <button
            type="button"
            className="hotspot"
            style={rectStyle(hp.header)}
            aria-label={`Parameter ${hpCurrent} drop-down — pick parameter set 1, 2 or 3 for ${hp.units[slug]}`}
            title={hp.note}
            onClick={() => onToggleDrawer('hdrvParam')}
          />
        )}
        {hpHere && hpCurrent !== 1 && (
          <div className="hdrv-header" style={{ ...rectStyle(hp.header), fontSize: 'clamp(9px, 1.7cqw, 15px)' }} aria-hidden="true">
            ▼Parameter{hpCurrent}
          </div>
        )}
        {hpHere && openDrawer === 'hdrvParam' && (
          <div
            className="mset-drawer mset-drawer--down"
            style={{
              left: pct(hp.header.x, CW),
              top: pct(hp.header.y + hp.header.h, CH),
              width: pct(hp.header.w, CW),
            }}
          >
            {hp.options.map((o) => (
              <button
                key={o.no}
                type="button"
                className={o.no === hpCurrent ? 'is-hl' : ''}
                style={{ padding: '2.5% 5%', fontSize: 'clamp(9px, 1.6cqw, 14px)' }}
                onClick={() => onTap({ type: 'hdrv-param', unit: slug, no: o.no })}
              >
                <span>Parameter{o.no}</span>
                <small>{o.desc}</small>
              </button>
            ))}
            <div className="drawer-note" style={{ padding: '2% 4%', fontSize: 'clamp(7px, 1.2cqw, 11px)' }}>
              {hp.drawerNote}
            </div>
          </div>
        )}

        {/* Select Total pop-up tab: baked into the Main Menu and Total
            captures (6.11 — "the Select Total pop-up key on the left side of
            the Main menu"). The expanded drawer was not captured, so the six
            buttons are drawn look-alikes, in the order of Table 6-32. */}
        {showsTotalTab && (
          <button
            type="button"
            className="hotspot"
            style={rectStyle(st.tab)}
            aria-label="Select Total pop-up"
            onClick={() => onToggleDrawer('selectTotal')}
          />
        )}

        {showsTotalTab && openDrawer === 'selectTotal' && (
          <div
            className="mset-drawer mset-drawer--left"
            style={{
              left: pct(st.tab.x + st.tab.w, CW),
              top: pct(st.tab.y, CH),
              width: pct(230, CW),
            }}
          >
            <div className="drawer-note" style={{ padding: '2% 4%', fontSize: 'clamp(7px, 1.2cqw, 11px)' }}>
              order checked against Table 6-32 and the real unit
            </div>
            {st.items.map((item) => (
              <button
                key={item.label}
                type="button"
                title={item.note || undefined}
                style={{
                  padding: '2.5% 5%',
                  fontSize: 'clamp(9px, 1.6cqw, 14px)',
                }}
                onClick={() => onTap({ type: 'nav', to: item.to, drawer: true })}
              >
                {item.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
