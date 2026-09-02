/**
 * Guided lessons. Declarative and data-driven: the engine in App.jsx walks
 * `steps`, forcing the RCU onto each step's `screen`.
 *
 * Step kinds:
 *   'read'     — informational; the trainee reads and presses Continue.
 *   'tap-nav'  — the trainee must tap a real navigation hotspot that goes to
 *                `to`. `via` is a point (screen px) inside the intended key,
 *                used to highlight exactly that key when more than one
 *                hotspot reaches the same screen (e.g. HOME vs Exit).
 *   'tap-spot' — the trainee taps a real key that does not navigate (its
 *                rect is authored from the screenshot); the simulator cannot
 *                change the baked-in image, so `explain` says what the real
 *                unit would do.
 *
 * Every procedure here is taken from the CCW R Operation Manual — the `ref`
 * on each lesson names the sections. Progress is saved and resumable.
 */

export const lessons = [
  {
    id: 'zero-adjust',
    title: 'Zero-adjust the weigher',
    ref: '4.4.6 Zero Adjustment / 6.5 Zero Adjustment Menu',
    blurb:
      'Memorise the empty weight of every weigh hopper and the dispersion ' +
      'table as 0 g — done after start-up, before every production run.',
    steps: [
      {
        screen: 'main-menu',
        kind: 'read',
        instruction:
          'Zero adjustment teaches the weigher what “empty” weighs. Do it ' +
          'after starting the weigher and before starting production, with ' +
          'no product in the hoppers or on the dispersion table (6.5).',
      },
      {
        screen: 'main-menu',
        kind: 'tap-nav',
        to: 'zero-adjust',
        via: { x: 378, y: 77 },
        instruction: 'Press the Zero Adjst key — top of the left-hand column.',
        explain: 'The Zero Adjustment menu appears (Figure 4-21).',
      },
      {
        screen: 'zero-adjust',
        kind: 'read',
        instruction:
          'The 14 weigh hoppers sit in a ring around the dispersion table. ' +
          'Each key shows that hopper’s current reading. You can select ' +
          'hoppers one at a time, or all at once with the keys at the ' +
          'bottom right.',
      },
      {
        screen: 'zero-adjust',
        kind: 'tap-spot',
        rect: { x: 503, y: 452, w: 88, h: 64 },
        label: 'Slct All WH',
        instruction: 'Press the Slct All WH key to select every weigh hopper.',
        explain:
          'On the real unit all 14 hoppers turn blue and the Start key ' +
          'lights up. (The picture here can’t change — it was captured ' +
          'with nothing selected, which is why Start looks dimmed.)',
      },
      {
        screen: 'zero-adjust',
        kind: 'read',
        instruction:
          'Next you would press Start: “Please wait a moment.” appears ' +
          'while the weigher zeroes each hopper, then every key shows its ' +
          'reading. Confirm each weigh hopper reads 0.0±0.1 g — if one ' +
          'doesn’t, run zero adjustment again (4.4.6).\n\nThen repeat for ' +
          'the dispersion table: press Slct All DF, confirm the table is ' +
          'empty, press Start, and confirm it reads 0.0 g.',
      },
      {
        screen: 'zero-adjust',
        kind: 'tap-nav',
        to: 'main-menu',
        via: { x: 748, y: 484 },
        instruction: 'Press the Exit key to return to the Main Menu.',
        explain:
          'Zero adjustment done. The weigher is ready for preset selection ' +
          'and production.',
      },
    ],
  },

  {
    id: 'select-preset',
    title: 'Select a preset and start production',
    ref: '4.4.5 Select Preset / 6.9 Select Preset Menu / 4.4.7 Starting Production / 6.6 Production Menu',
    blurb:
      'Load the product recipe, start the weigher, and read the ' +
      'production screens.',
    steps: [
      {
        screen: 'main-menu',
        kind: 'read',
        instruction:
          'The preset display in the middle shows what the weigher will ' +
          'run: preset C1, POTATO CHIPS, 90.0 g target at 80 wpm. To run a ' +
          'different product you select its preset first.',
      },
      {
        screen: 'main-menu',
        kind: 'tap-nav',
        to: 'preset-select-a',
        via: { x: 750, y: 102 },
        instruction:
          'Press the Select Preset key — the product photo at the top ' +
          'right.',
        explain: 'The Select Preset menu opens in photo display (6.9.1).',
      },
      {
        screen: 'preset-select-a',
        kind: 'read',
        instruction:
          'Each tile is one preset: photo, product name, target weight, ' +
          'upper limit and speed. On the real unit you press a tile to ' +
          'load that preset (a confirmation appears), or use the Preset ' +
          'No. key to type the number directly. In this simulator the ' +
          'tiles are display-only.',
      },
      {
        screen: 'preset-select-a',
        kind: 'tap-nav',
        to: 'preset-select-b',
        via: { x: 741, y: 172 },
        instruction:
          'Press the Slct Dsply key to switch to the list display.',
        explain:
          'The list shows many presets at once without photos; pressing a ' +
          'column header sorts by that column (6.9.2).',
      },
      {
        screen: 'preset-select-b',
        kind: 'tap-nav',
        to: 'main-menu',
        via: { x: 741, y: 482 },
        instruction:
          'Press Exit to return to the Main Menu.',
        explain:
          'Production is started from the Main Menu, not from here. The ' +
          'Start key is dimmed and dead on the preset screens — checked ' +
          'against the real unit — so a trainee taught to press it here ' +
          'would be stuck in front of a machine that does nothing.',
      },
      {
        screen: 'main-menu',
        kind: 'tap-nav',
        to: 'run-combination',
        via: { x: 746, y: 559 },
        instruction:
          'With the preset loaded, press the green Start key at the ' +
          'bottom right to start production.',
        explain:
          'WARNING (6.6): the feeders and hoppers start moving the moment ' +
          'Start is pressed — always confirm the surroundings are safe ' +
          'first. On the real unit Start only lights once the machine is ' +
          'powered on. The Production menu appears on the Combination tab.',
      },
      {
        screen: 'run-combination',
        kind: 'read',
        instruction:
          'The big display shows each discharge’s combination weight, ' +
          'with a lamp: green = proper weight, yellow = overweight, red = ' +
          'underweight. The ring shows each head’s state — which hoppers ' +
          'weighed stable, which joined the combination, which are empty ' +
          'or in error (6.6.1).',
      },
      {
        screen: 'run-combination',
        kind: 'tap-nav',
        to: 'run-totals',
        via: { x: 469, y: 442 },
        instruction: 'Press the Total Data tab.',
        explain:
          'Run statistics: proper count, total and mean weight, standard ' +
          'deviation, max/min, and the weight histogram (6.6.4). The same ' +
          'data lives in the Total Menu (6.11).',
      },
      {
        screen: 'run-totals',
        kind: 'tap-nav',
        to: 'run-combination',
        via: { x: 75, y: 442 },
        instruction: 'Go back to the Combination tab.',
        explain: null,
      },
      {
        screen: 'run-combination',
        kind: 'read',
        instruction:
          'To stop production (4.4.8): press Infeed Control so its lamp ' +
          'goes off (the product supply pauses), press the Stop key, then ' +
          'Exit to return to the Main Menu.',
      },
      {
        screen: 'run-combination',
        kind: 'tap-nav',
        to: 'main-menu',
        via: { x: 52, y: 560 },
        instruction:
          'Press HOME to go back to the Main Menu.',
        explain:
          'HOME leaves the screen; it does NOT stop the weigher — production ' +
          'keeps running and Stop is still available from the Main Menu. ' +
          'Exit is dimmed and dead on the Production screens, checked ' +
          'against the real unit, so HOME and Stop are the only ways out. ' +
          'After a run, drain the product left in the weigher — that’s the ' +
          'Drain lesson.',
      },
    ],
  },

  {
    id: 'target-weight',
    title: 'Change the target weight',
    ref: '6.10 Preset Menu / 6.10.4 Weight Setting',
    blurb:
      'Find where the pack weight lives in the preset and how the ' +
      'proper-weight window works.',
    steps: [
      {
        screen: 'main-menu',
        kind: 'read',
        instruction:
          'Every product setting — name, speed, feeder values, timing and ' +
          'the pack weight — lives in the preset. Editing presets needs ' +
          'the Site Engineer level or above (6.10).',
      },
      {
        screen: 'main-menu',
        kind: 'tap-nav',
        to: 'preset-product',
        via: { x: 750, y: 225 },
        instruction:
          'Press the Preset key on the right side, below the product photo.',
        explain:
          'The Preset menu opens on the Product tab: product name, code, ' +
          'category and photo (6.10.1.1).',
      },
      {
        screen: 'preset-product',
        kind: 'read',
        instruction:
          'The tabs along the bottom (Product, Machine, Item, Others) ' +
          'hold the product’s settings; the indexes on the right jump to ' +
          'Feeder Adjustment, Timing Adjustment and Weight Setting.',
      },
      {
        screen: 'preset-product',
        kind: 'tap-nav',
        to: 'preset-weight',
        via: { x: 700, y: 249 },
        instruction: 'Press Weight Setting in the right-hand index.',
        explain: 'The Weight Setting menu appears (6.10.4).',
      },
      {
        screen: 'preset-weight',
        kind: 'read',
        instruction:
          'Read the weight window on the left: Target Weight 90.0 g and ' +
          'Upper Weight Limit 3.0 g mean discharges of 90.0–93.0 g count ' +
          'as proper weight (6.10.4.2). Lower Weight Limit is dimmed ' +
          'because Average Control is Off on this machine’s Machine tab — ' +
          'with average control off the weigher never dumps below target.',
      },
      {
        screen: 'preset-weight',
        kind: 'tap-spot',
        rect: { x: 69, y: 268, w: 238, h: 64 },
        label: 'Target Weight',
        instruction: 'Press the Target Weight key.',
        explain:
          'On the real unit the ten-key pad pops up to type the new ' +
          'target (range in Table 6-27: up to 99999.0 g, minimum step ' +
          '0.1/0.2 g standard). The 90.0 g here is part of the captured ' +
          'image, so it won’t change in the simulator.',
      },
      {
        screen: 'preset-weight',
        kind: 'read',
        instruction:
          'Exit enters the changed preset content; Cancel throws the ' +
          'changes away. Note the Start key cannot be pressed while ' +
          'presetting — finish with Exit first (6.6 note).',
      },
      {
        screen: 'preset-weight',
        kind: 'tap-nav',
        to: 'main-menu',
        via: { x: 745, y: 484 },
        instruction: 'Press the Exit key to enter the preset and return.',
        explain: 'The Main Menu shows the preset’s values again.',
      },
    ],
  },

  {
    id: 'drain',
    title: 'Drain the weigher after production',
    ref: '4.4.9 Draining the Products / 6.7 Drain Menu',
    blurb:
      'Empty the product left in the hoppers and feeders at the end of a ' +
      'run.',
    steps: [
      {
        screen: 'main-menu',
        kind: 'read',
        instruction:
          'After stopping production there is still product on the ' +
          'dispersion table, in the troughs and in the hoppers. Drain ' +
          'runs the machine empty (4.4.9).',
      },
      {
        screen: 'main-menu',
        kind: 'tap-nav',
        to: 'discharge-weight',
        via: { x: 378, y: 152 },
        instruction: 'Press the Drain key — middle of the left-hand column.',
        explain:
          'The Drain menu appears and draining starts. This capture was ' +
          'taken with control power off, so the Drain STOP / START and ' +
          'Exit keys show dimmed.',
      },
      {
        screen: 'discharge-weight',
        kind: 'read',
        instruction:
          'Watch the hopper weights fall as product clears. Drain STOP ' +
          'pauses the drain; Drain START resumes it. Auto Zero (normally ' +
          'off) would re-zero automatically during the drain; Infeed ' +
          'Control stops or allows product supply (6.7).',
      },
      {
        screen: 'discharge-weight',
        kind: 'tap-nav',
        to: 'discharge-feeder',
        via: { x: 206, y: 443 },
        instruction: 'Press the Feeder Adjust tab.',
        explain:
          'Feeder values can be tweaked to push stubborn product through ' +
          '— but adjustments made on the Drain menu are NOT written back ' +
          'to the preset (6.7 note).',
      },
      {
        screen: 'discharge-feeder',
        kind: 'tap-nav',
        to: 'discharge-weight',
        via: { x: 75, y: 443 },
        instruction: 'Go back to the Weight Display tab.',
        explain: null,
      },
      {
        screen: 'discharge-weight',
        kind: 'tap-nav',
        to: 'main-menu',
        via: { x: 748, y: 484 },
        instruction:
          'When the machine is empty, press Exit — it stops the drain and ' +
          'returns to the Main Menu.',
        explain:
          'Drain finished. Power-down from here is: Power key, then the ' +
          'main power switch (4.4.10).',
      },
    ],
  },
];

export default lessons;
