/**
 * Per-screen training content.
 *
 * Every entry keyed by the screen slug in navmap.json. `ref` is the manual
 * section the text is drawn from — quote it to trainees so they can read
 * further. Bare section numbers ('6.10 Preset Menu') are the CCW-R Operation
 * Manual; sections prefixed 'Service' ('Service 4.4.3.2 …') are the CCW-R
 * Service Manual (reference/service-manual.txt). `source` is honest
 * provenance:
 *
 *   'manual'   — summary and key functions come from the Operation Manual
 *                (a few of these also cite the Service Manual where it adds
 *                something; the ref names both).
 *   'service'  — the screen is an engineering screen documented in the
 *                Service Manual, chapter 4 (Maintenance Service level
 *                functions) or 5 (appendix). The InfoPanel shows a notice
 *                that these are service-engineer settings.
 *   'observed' — the screen is covered by NEITHER manual we hold; the
 *                description states only what is visible on the captured
 *                screen itself. The InfoPanel shows a caution for these.
 *
 * The captured machine is a 14-head CCW-R running preset C1 "POTATO CHIPS",
 * 90.0 g target, 80 wpm. Those numbers are baked into the screenshots and
 * cannot change in the simulator.
 */

const OBSERVED_NOTE =
  'This engineering screen is not stepped through in the CCW-R Operation ' +
  'Manual or in the Service Manual we hold. The description states only ' +
  'what is visible on the screen. On a real machine these settings are the ' +
  'service engineer’s territory — consult Ishida before changing them.';

const SERVICE_NOTE =
  'This screen is documented in the CCW-R Service Manual, not the ' +
  'Operation Manual. These are service-engineer settings — changing them ' +
  'on a live machine is not an operator task. Work here to the Service ' +
  'Manual, not from memory.';

export const screenInfo = {
  'main-menu': {
    title: 'Main Menu',
    ref: '6.4 Main Menu / Service 4.2 Maintenance Service Level Menu',
    source: 'manual',
    summary:
      'The home screen. It appears when the main power switch is turned on ' +
      '(at the Operator level, unless the level was changed at the ' +
      'Installation level). The preset display in the middle shows the ' +
      'selected preset: here C1 “POTATO CHIPS”, 90.0 g target at 80 wpm.',
    keys: [
      { name: 'Zero Adjst', desc: 'Opens the Zero Adjustment menu (6.5).' },
      { name: 'Drain', desc: 'Opens the Drain menu (6.7, 4.4.9). Draining itself is started there with Drain START — entering the menu moves nothing.' },
      { name: 'Full Open', desc: 'Opens the Full Open Lock menu (6.8).' },
      { name: 'Select Preset (photo key)', desc: 'The photo at top right — opens the Select Preset menu (6.9).' },
      { name: 'Preset', desc: 'Opens the Preset menu for editing the product settings (6.10). Needs Site Engineer level or above.' },
      { name: 'Preset item buttons', desc: 'The small squares beside Product Name, Target Weight, Speed etc. change that one value directly via ten-key or keyboard (6.10.5).' },
      { name: 'Select Total pop-up', desc: 'The vertical tab on the left edge opens the Select Total drawer: six views of the accumulated production statistics and logs (6.11). Real operator content — the totals are how a run is judged.' },
      { name: 'Select operation level (key icon)', desc: 'The key with four dots in the upper bar switches between the Operator, Site Engineer, Installation and Maintenance levels (6.3.4). Available at every level.' },
      { name: 'Machine Set pop-up', desc: 'The pull-up tab at the bottom selects the Machine Set and Check menus (engineering screens).' },
      { name: 'Power / Stop / Start', desc: 'Control power on-off, stop production, start production (4.4.7). Dimmed keys cannot be pressed. Observed on the running program: with power off, Start and Stop are dimmed and completely dead; pressing Power shows “Please wait a moment.” with a progress bar for about ten seconds (whole bottom bar locked out), then the icon turns from red to green and Start lights. Powering OFF is instant, with no pop-up — and a single Power press while production runs stops the machine AND cuts power.' },
      { name: 'Upper setting bar', desc: 'Message Board, information, Start-up Assistant, language, operation level, Control Panel, date & time and Help keys (6.3).' },
    ],
    note:
      'Operation levels (Service 4.2): the CCW-R stacks Operator, Site ' +
      'Engineer, Installation and Maintenance levels, selected from the ' +
      '[Select operation level] key in the upper bar; the factory password ' +
      'for the Maintenance Service level is 123 (Service 4.2.1). What the ' +
      'Main Menu shows depends on the level: the Operator-level menu tree ' +
      '(Service 1.3) has no Preset key and no Machine Set pull-up at all — ' +
      'they are absent, not merely dimmed — confirmed against the real ' +
      'program. Switching the machine on at the main power switch starts ' +
      'the panel at Operator level (6.3.4); on the running program the ' +
      'on-screen Power key did NOT reset the level. These captures were ' +
      'taken at Maintenance level (four lit dots on the key icon), so the ' +
      'simulator always shows everything.',
  },

  'zero-adjust': {
    title: 'Zero Adjustment',
    ref: '6.5 Zero Adjustment Menu / 4.4.6 Zero Adjustment',
    source: 'manual',
    summary:
      'Zero adjustment memorises the weight of each empty weigh hopper and ' +
      'the dispersion table as 0 g. Perform it after starting the weigher ' +
      'and before starting production, with no product in the hoppers.\n\n' +
      'Procedure (4.4.6): press Slct All WH, press Start, wait for ' +
      '“Please wait a moment.”, then confirm every weigh hopper reads ' +
      '0.0±0.1 g. Repeat with Slct All DF for the dispersion table ' +
      '(confirm 0.0 g), then press Exit.',
    keys: [
      { name: 'Hopper keys', desc: 'Press an individual hopper to select it for adjustment.' },
      { name: 'Dispersion table key', desc: 'The disc in the middle — selects the dispersion table.' },
      { name: 'Slct All DF', desc: 'Selects (or clears) the dispersion table.' },
      { name: 'Slct All WH', desc: 'Selects (or clears) every weigh hopper at once.' },
      { name: 'Start', desc: 'Starts zero adjustment for whatever is selected. Lights only when power is on AND at least one hopper is selected — with power off it is dimmed and dead (observed on the running program).' },
      { name: 'Exit', desc: 'Returns to the Main Menu. Stays live with power off.' },
    ],
    note:
      'If a hopper does not read 0.0±0.1 g afterwards, run zero adjustment ' +
      'again (4.4.6). Observed on the running program: the menu opens with ' +
      'every hopper already selected; pressing Start shows “Please wait a ' +
      'moment.” with a progress bar (~12 s, whole bottom bar locked out), ' +
      'then the hoppers deselect (turn gray) and Start dims until ' +
      'something is reselected. This capture shows that finished state — ' +
      'nothing selected, so Start is dimmed. Note the bottom-bar Start is ' +
      'dimmed on this screen even with power on; production is not started ' +
      'from here.',
  },

  'run-combination': {
    title: 'Production — Combination',
    ref: '6.6 Production Menu / 6.6.1 Combination Menu',
    source: 'manual',
    summary:
      'The Production menu appears when Start is pressed. The Combination ' +
      'tab shows each discharge: the combination weight on the big display ' +
      'and, per head, which hoppers took part.\n\n' +
      'Lamp colors on the weight display: green = proper weight, yellow = ' +
      'overweight, red = underweight. To stop production (4.4.8): turn ' +
      'Infeed Control off, press Stop, then Exit to return to the Main Menu.',
    keys: [
      { name: 'Combination weight display', desc: 'The weight of each discharge with a green / yellow / red lamp for proper / over / under weight.' },
      { name: 'Hopper display', desc: 'Head symbols show weighed-and-stable, participated-in-combination (circle color = stability), empty, unstable, auto-zero, error and non-participating heads.' },
      { name: 'Select Preset area', desc: 'Shows the running preset. The squares beside items change a value temporarily during production — the preset itself is not updated (6.10.5).' },
      { name: 'Infeed Control', desc: 'Lamp on = product infeed to the weigher is controlled automatically; lamp off = infeed stopped.' },
      { name: 'Tabs', desc: 'Combination, Feeder Adjust, Timing Adjust, Total Data and Weight Display switch the production view.' },
      { name: 'Exit', desc: 'Returns to the Main Menu.' },
      { name: 'While running (seen on the program)', desc: 'Every cycle a combination of hoppers is chosen and its members get the filled Selected badge; the readout shows that combination\'s weight, a few tenths over target; now and then a hopper shows the cyan triangle (Auto Zero) or the red dash (Empty) in place of its number; the legend strip along the bottom scrolls. The hoppers themselves stay blue. The simulator plays the same thing at the program\'s 80 wpm cadence with made-up weights; Stop freezes it with the readout holding.' },
    ],
    note:
      'WARNING (6.6): when Start is pressed the feeders and hoppers start ' +
      'moving — confirm the surroundings are safe first. Observed on the ' +
      'running program: while production runs, HOME, Exit and Start are ' +
      'all dimmed and dead — Stop first, then leave. After Stop, power ' +
      'stays on and Start relights. A single press of Power while running ' +
      'stops the machine AND cuts control power in one stroke. This ' +
      'capture shows the running state (Stop live, HOME/Exit dimmed); the ' +
      'simulator’s HOME hotspot stays usable so you are never trapped, ' +
      'but on the machine that key is dead until Stop is pressed.',
  },

  'run-feeder': {
    title: 'Production — Feeder Adjust',
    ref: '6.6.2 Feeder Adjust Menu / 6.12 Feeder Adjustment Menu',
    source: 'manual',
    summary:
      'Feeder adjustment sets the amplitude and operating time of the ' +
      'radial and dispersion feeders — how much product moves out to the ' +
      'pool hoppers. Select a head on the illustration or the radar chart, ' +
      'turn on the RF Time or RF AMP lamp key, and press the round Increase ' +
      'or Decrease key. Any number of heads can be selected at once, and one ' +
      'press moves every one of them by 1.0.\n\nThe chart is the values ' +
      'themselves: each head\u2019s magenta triangle sits further out the ' +
      'higher its amplitude, and its navy square the higher its time. A ' +
      'parameter whose lamp is off is drawn grey and its number is blank \u2014 ' +
      'the value is not lost, and comes straight back when the lamp is lit.' +
      '\n\nWith several heads selected the readout shows their mean.' +
      '\n\nFeeder values changed here during production ARE ' +
      'written back to the preset (6.6.2).',
    keys: [
      { name: 'Head select keys', desc: 'Pick the heads to adjust — tap a number on the trough or its segment on the chart ring; both light together.' },
      { name: 'RF Time / RF AMP lamps', desc: 'Choose whether the arrows change feeder time or feeder amplitude.' },
      { name: 'Head mean / Section mean lamps', desc: 'Overlay the mean infeed per weigh hopper (pink) or per section (red) on the chart.' },
      { name: 'Increase / Decrease', desc: 'The two ROUND keys. One press moves every lit parameter on every selected head by 1.0. The blue → ← arrows beside the trough are not these: pressed on the original in every state, they do nothing at all.' },
      { name: 'Write feeder OptimumVal', desc: 'Visible at the bottom of the production tabs on this machine.' },
      { name: '(1) on the centre disc', desc: 'Picks the dispersion feeder: the disc turns blue, the arrow reads DF, and the chart draws one circle per parameter. Tap any head to come back to the radial feeders.' },
      { name: 'DF Time / DF AMP / DF Weight / Target Wt', desc: 'What the top row becomes with DF picked on a real CCW-R (photographed on a running machine, 2026-09-03): the lamp keys read DF, a DF Weight lamp key replaces Head mean, and Target Wt shows the DF target weight — the weight the dispersion pan is held at, NOT the preset target weight. Target Wt opens the DF Weight Setting keypad (Maximum 9999, Minimum 1). The Flash program this trainer is built from keeps the RF labels here, so these four keys are drawn from the photograph.' },
    ],
  },

  'run-timing': {
    title: 'Production — Timing Adjust',
    ref: '6.6.3 Timing Adjut Menu / 6.13 Timing Adjustment Menu',
    source: 'manual',
    summary:
      'Timing adjustment tunes when each driving part acts so product ' +
      'flows smoothly: WH-DS (discharge request to completion), IS-WH, ' +
      'WH-PH (weigh hopper to pool hopper), PH-RF and STAGGER. Select the ' +
      'item key, then step the value in 10 ms or 100 ms units or enter it ' +
      'directly via the ten-key.\n\nTiming values changed here during ' +
      'production ARE written back to the preset (6.6.3).',
    keys: [
      { name: 'Timing item keys', desc: 'Select which interval to adjust; the blue arrow shows the direction between units.' },
      { name: '10 ms / 100 ms keys', desc: 'Step the selected value up or down.' },
      { name: 'Enter Time', desc: 'Type the value directly on the ten-key.' },
      { name: 'What was seen on the program and a running machine', desc: 'The same table as Preset > Timing Adjustment, live: tap a row to select it and the cutaway paints its hoppers; the single arrows move it by 10 ms, the double arrows by 100; Entr Time writes into it (1..2550). The bars are a timeline of delays, each starting where the ones before it end. The BH / TH / DTH toggles in the app bar add the rows of a booster, timing-hopper or DTH machine, with C1 (heads 1-8) and C2 (9-16) keys. The program\'s first row read WH-PH here - its typo for IS-DS.' },
    ],
  },

  'run-totals': {
    title: 'Production — Total Data',
    ref: '6.6.4 Total Data Tab / 6.11 Total Menu',
    source: 'manual',
    summary:
      'Production statistics for the current run: start/stop time, weigher ' +
      'and production speed, proper count, total weight, mean weight, ' +
      'standard deviation, max/min and range, with a weight histogram on ' +
      'the right. It is the same data as the Total Menu reached from the ' +
      'Main Menu’s Select Total pop-up (6.11).',
    keys: [
      { name: 'Total Log drop-down', desc: 'Chooses which total record to display.' },
      { name: 'Output / PRINT', desc: 'Prints the total data or writes it to file — where it goes is set under Destination ID (6.3.5.3).' },
      { name: 'Select Total pop-up', desc: 'Switches between the total menus.' },
    ],
  },

  'run-weight': {
    title: 'Production — Weight Display',
    ref: '6.6.5 Weight Display Menu',
    source: 'manual',
    summary:
      'Shows the live weight in every hopper and on each dispersion table ' +
      'during production. The per-head status symbols are the same as on ' +
      'the Combination tab.',
    keys: [
      { name: 'Hopper weight display', desc: 'Current weight per weigh hopper.' },
      { name: 'Dispersion table display', desc: 'Weight per dispersion table.' },
    ],
  },

  'discharge-weight': {
    title: 'Drain — Weight Display',
    ref: '6.7 Drain Menu / 4.4.9 Draining the Products',
    source: 'manual',
    summary:
      'Drain empties the product remaining in the weigher after production ' +
      'stops. Pressing the Drain key on the Main Menu opens this menu; ' +
      'draining is then started with Drain START (it does not start by ' +
      'itself — observed on the running program). When it finishes, pause ' +
      'the drain and press Exit — Exit stops the drain and returns to the ' +
      'Main Menu.\n\nFeeder and timing values adjusted on the Drain menu ' +
      'are NOT written back to the preset.',
    keys: [
      { name: 'Auto Zero', desc: 'Lamp on = zero adjustment is performed automatically during drain (normally left off). Works with power off.' },
      { name: 'Infeed Control', desc: 'Lamp on = product infeed continues automatically; off = infeed stopped. Works with power off.' },
      { name: 'Drain STOP', desc: 'Pauses the drain. Lit only while draining.' },
      { name: 'Drain START', desc: 'Starts (resumes) the drain. POWER-GATED: with power off it is dimmed and pressing it does nothing — settled by pressing it on the running program. With power on it draws live and green.' },
      { name: 'Exit', desc: 'Stops drain and displays the Main Menu. On the running program Exit stayed live with power off.' },
      { name: 'Tabs', desc: 'Weight Display, Feeder Adjust and Timing Adjust.' },
    ],
    note:
      'Power gates the drain: Drain START and Drain STOP are dimmed and ' +
      'dead until the Power key has been pressed (bottom bar, red → ' +
      'green). While draining, Drain START dims, Drain STOP lights, and ' +
      'HOME is locked out. The bottom-bar Start stays dimmed on this ' +
      'screen even with power on. This capture shows every one of those ' +
      'keys dimmed — including Exit, which on the running program stayed ' +
      'live with power off; trust the behavior described here over the ' +
      'baked pixels.',
  },

  'discharge-feeder': {
    title: 'Drain — Feeder Adjust',
    ref: '6.7 Drain Menu / 6.12 Feeder Adjustment Menu',
    source: 'manual',
    summary:
      'The feeder adjustment view while draining — same controls as the ' +
      'production feeder menu (select a head, RF Time or RF AMP, Increase ' +
      '/ Decrease). Values changed here apply to the drain only; they are ' +
      'NOT reflected to the preset data (6.7 note).',
    keys: [],
  },

  'discharge-timing': {
    title: 'Drain — Timing Adjust',
    ref: '6.7 Drain Menu / 6.13 Timing Adjustment Menu',
    source: 'manual',
    summary:
      'The timing adjustment view while draining — same controls as the ' +
      'production timing menu. Values changed here are NOT reflected to ' +
      'the preset data (6.7 note).',
    keys: [],
  },

  'hopper-discharge': {
    title: 'Full Open Lock — Unit Select',
    ref: '6.8 Full Open Lock Menu / 6.8.1 Full Open Lock',
    source: 'manual',
    summary:
      'Full open lock holds the pool and weigh hoppers open, and can run ' +
      'the feeders, so you can check the operation of each unit (and get ' +
      'at the hoppers for cleaning checks).\n\nProcedure (6.8.1): press the ' +
      'lamp keys of the units to operate (they light green), press Open to ' +
      'hold the hoppers open / run the feeders, press Close to shut them, ' +
      'then Exit to return to the Main Menu.',
    keys: [
      { name: 'DF', desc: 'Sets whether to operate the dispersion feeders. Selection works even with power off (observed).' },
      { name: 'RF', desc: 'Sets whether to operate the radial feeders.' },
      { name: 'WH', desc: 'Sets whether to fully open the weigh hoppers.' },
      { name: 'PH', desc: 'Sets whether to fully open the pool hoppers.' },
      { name: 'Open / Close', desc: 'Fully opens or fully closes the selected hoppers. POWER-GATED: with power off BOTH keys are dimmed and pressing Open does nothing — settled by pressing it on the running program. With power on both draw live.' },
    ],
    note:
      'Power gates the action, not the selection: the DF/RF/PH/WH lamp ' +
      'keys respond with power off, but Open and Close are dimmed and ' +
      'dead until the Power key has been pressed. While units are held ' +
      'open, HOME and Exit lock out until Close is pressed. NOTE (6.8): ' +
      'do not use the Power key during full open lock — doing so may ' +
      'damage the weigher.',
  },

  'hopper-feeder': {
    title: 'Full Open Lock — Feeder Adjust',
    ref: '6.8.2 Feeder Adjust Menu',
    source: 'manual',
    summary:
      'Feeder adjustment inside Full Open Lock, used while exercising the ' +
      'feeders. Feeder values adjusted here are NOT reflected to the ' +
      'preset data.',
    keys: [],
  },

  'preset-select-a': {
    title: 'Select Preset — Photo Display',
    ref: '6.9 Select Preset Menu / 6.9.1 Photo Display / 4.4.5 Select Preset',
    source: 'manual',
    summary:
      'Choose which preset (product recipe) the weigher runs. Each tile is ' +
      'one preset showing its photo, product name, target weight, upper ' +
      'limit and speed. On the real unit, pressing a tile loads that ' +
      'preset (a confirmation appears); in this simulator the tiles are ' +
      'display-only.',
    keys: [
      { name: 'Preset tiles', desc: 'One per preset — press to load it on the real unit. Selection works with power off (observed).' },
      { name: 'Preset No.', desc: 'Select a preset number directly via the ten-key.' },
      { name: 'Slct Dsply', desc: 'Switches to the list display, which shows many presets at once without photos.' },
      { name: 'Exit', desc: 'Returns to the Main Menu — the only way back: HOME is dimmed and dead on this screen in both power states (observed).' },
      { name: 'Start (bottom bar)', desc: 'POWER-GATED, and live here: with power on, pressing Start on this screen drops straight into Production running — verified by pressing it on the running program. With power off it is dimmed and dead.' },
    ],
    note:
      'The capture shows the power-off state (red Power icon, Start ' +
      'dimmed). With power on, the bottom-bar Start lights on this screen ' +
      'and works.',
  },

  'preset-select-b': {
    title: 'Select Preset — List Display',
    ref: '6.9.2 List Display',
    source: 'manual',
    summary:
      'The list form of Select Preset: each row is a key that loads its ' +
      'preset, showing preset number, product class, name, target weight, ' +
      'speed, dump count and record time. Pressing a column header sorts ' +
      'the list ascending on that column.',
    keys: [
      { name: 'Preset rows', desc: 'Press a row to load that preset (real unit).' },
      { name: 'Column headers', desc: 'Sort the list by the pressed column.' },
      { name: 'Slct Dsply', desc: 'Back to the photo display.' },
      { name: 'Preset No.', desc: 'Direct selection via ten-key.' },
    ],
  },

  'preset-product': {
    title: 'Preset — Product Tab',
    ref: '6.10 Preset Menu / 6.10.1.1 Product Tab Menu',
    source: 'manual',
    summary:
      'The Preset menu edits everything about how a product runs. The ' +
      'Product tab holds identity: product name, code and category ' +
      '(entered on the pop-up keyboard) and the product photo, which can ' +
      'be taken with the connected camera.\n\nPreset functions need the ' +
      'Site Engineer level or above (6.10 note). Exit enters the changes ' +
      'and returns to the Main Menu; Cancel discards them.',
    keys: [
      { name: 'Product Name / Code / Category', desc: 'Keyboard entry; the set value shows on the key. Category is free-form and useful for grouping products.' },
      { name: 'Photo select / Camera', desc: 'Pick or take the preset photo — one photo per preset; a new one replaces the old.' },
      { name: 'Tabs', desc: 'Product, Machine, Item, Others (6.10.1); the right-hand indexes jump to Feeder, Timing and Weight settings.' },
      { name: 'Output', desc: 'Prints or file-outputs the whole preset (6.10.6).' },
      { name: 'Cancel', desc: 'Cancels changes to the preset content.' },
    ],
  },

  'preset-machine': {
    title: 'Preset — Machine Tab',
    ref: '6.10.1.2 Machine Tab Menu',
    source: 'manual',
    summary:
      'Machine behavior for this product: Speed is the number of packs ' +
      'discharged per minute — set it to suit the product, target weight ' +
      'and packer capacity. Dump Count splits a discharge into several ' +
      'drops so bulky product does not clog the packer.',
    keys: [
      { name: 'Speed', desc: 'Packs per minute, via ten-key.' },
      { name: 'Dump Count', desc: 'Number of split discharges per pack (Table 6-20 gives the optimum by range and target weight).' },
      { name: 'Average Control', desc: 'On = the target is controlled so the average discharge weight approaches the target; Off = never dump below target.' },
      { name: 'Interlock Parameter Number', desc: 'Packer interlock mode, e.g. master, slave, stroke on demand, bag on demand (Table 6-21).' },
      { name: 'Section Parameter Number', desc: 'Selects the sectioning pattern when the heads are split to weigh different products; patterns are set at the Installation level.' },
    ],
  },

  'preset-item': {
    title: 'Preset — Item Tab',
    ref: '6.10.1.3 Item Tab Menu',
    source: 'manual',
    summary:
      'Advanced weighing environment settings for the product.',
    keys: [
      { name: 'Auto Feed Target', desc: 'How many heads should make up the target weight; with a feeder control mode other than MANUAL, infeed is auto-controlled to achieve it.' },
      { name: 'Disch. Priority Count', desc: 'After the set number of cycles (5–30) without discharging, a head gets priority to join the combination.' },
      { name: 'AFD Auto Adjustment limit amp / time', desc: 'Lower and upper limits for AFD amplitude and time auto-adjustment.' },
      { name: 'Feed Multiplier', desc: 'Multiplying factor (1–8) for the feeder time pitch.' },
      { name: 'Hopper Action Parameter Number', desc: 'Open/close action parameter (0, 1 or 2, factory set) for pool and weigh hoppers.' },
      { name: 'Photo SW / Shutter Drive', desc: 'On/Off for the phototube and the shutter drive.' },
    ],
  },

  'preset-other': {
    title: 'Preset — Others Tab',
    ref: '6.10.1.4 Others Tab Menus',
    source: 'manual',
    summary:
      'Remaining product settings. Stable Time sets how long a weigh must ' +
      'settle before it is judged stable — a weigh faster than this is ' +
      'not treated as a stable result.',
    keys: [
      { name: 'Stable Time', desc: 'Ten-key entry of the stability judgment time.' },
    ],
  },

  'preset-feeder': {
    title: 'Preset — Feeder Adjustment',
    ref: '6.10.2 Feeder Adjustment',
    source: 'manual',
    summary:
      'The preset’s stored feeder values. Turn on Time or AMP, select ' +
      'heads on the bar display, and use the arrows to raise or lower the ' +
      'radial feeder time or amplitude. The graph relates radial feeder, ' +
      'dispersion feeder and amplitude.',
    keys: [
      { name: 'Time / AMP', desc: 'Choose whether the arrows adjust feeder time or amplitude.' },
      { name: 'Head select keys', desc: 'The numbered keys select heads; selected heads show blue.' },
      { name: 'Read Default / Read OptimumVal', desc: 'Load stored default or optimum feeder values (as shown on this machine).' },
      { name: 'AFD pop-up', desc: 'Opens the AFD Set menu.' },
      { name: '(1) under the DF bar', desc: 'Picks the dispersion feeder (seen on the running program): the (1) turns blue, a Target Wt key appears above Read OptimumVal, and the arrows move the DF values. Press it again, or a head number, to clear it.' },
      { name: 'Target Wt', desc: 'Only shown with DF picked. The DF target weight — the weight the dispersion pan is held at, not the preset target weight. Opens the DF Weight Setting keypad: 500 on this machine, Maximum 9999, Minimum 1; digits append to the shown value.' },
    ],
  },

  'preset-timing': {
    title: 'Preset — Timing Adjustment',
    ref: '6.10.3 Timing Adjustment',
    source: 'manual',
    summary:
      'The preset’s stored timing values. Select the timing item, then ' +
      'adjust in 10 ms or 100 ms steps or enter the time directly. The ' +
      'arrow shows which two units the selected interval runs between.',
    keys: [
      { name: 'Timing item keys', desc: 'WH-DS, IS-WH, WH-PH, PH-RF, STAGGER — see Table 6-43 for what each interval means.' },
      { name: '10 ms / 100 ms keys', desc: 'Step adjustment.' },
      { name: 'Enter Time', desc: 'Direct ten-key entry.' },
      { name: 'What was seen on the program and a running machine', desc: 'Tap a row to select it: the band moves and the cutaway paints the hoppers that row is about, with the DS/IS tags and the blue arrow following. The single arrows move the selected row by 10 ms, the double arrows by 100; a row at 0 goes no lower. Entr opens Time Input (Maximum 2550, Minimum 1, digits append) and writes into the row. The bars are a timeline of delays: each starts where the ones before it end, so raising IS-WH slides everything after it right.' },
      { name: 'BH / TH / DTH (app bar)', desc: 'Which units the machine has. The program is a plain 14-head single section; a real line may have booster hoppers (adds WH-BH, BH-WH, BH ON), a timing hopper (adds IS-TH and makes two sections, C1 heads 1-8 and C2 heads 9-16) and diverting timing hoppers (adds IS-DTH; DTH1 and DTH2 belong to C1, DTH3 and DTH4 to C2, the radio under the table picking which). The extra units on the cutaway are drawn, not captured. Values and defaults come from a running two-section machine.' },
    ],
  },

  'preset-weight': {
    title: 'Preset — Weight Setting',
    ref: '6.10.4 Weight Setting',
    source: 'manual',
    summary:
      'The weight window for the product. Target Weight is what each pack ' +
      'should weigh (here 90.0 g). Upper Weight Limit sets the top of the ' +
      'proper-weight window above target — with 90.0 g target and 3.0 g ' +
      'upper limit, discharges of 90.0–93.0 g count as proper. Lower ' +
      'Weight Limit only applies when Average Control is on — on this ' +
      'machine it is off, so the key is dimmed.',
    keys: [
      { name: 'Target Weight', desc: 'Ten-key entry. Range depends on head capacity (Table 6-27): up to 99999.0 g, minimum step 0.1/0.2 g standard.' },
      { name: 'Upper Weight Limit', desc: '0.0–999.0 g above target; 0.0 means no upper limit.' },
      { name: 'Lower Weight Limit', desc: 'Below-target allowance when average control is on; auto-set from the target (Table 6-31) and manually reducible.' },
      { name: 'Extended Upper Limit', desc: 'The allowable upper limit used when no corrected weight exists, with its dump cycle count.' },
    ],
  },

  'panel-screen-control': {
    title: 'Control Panel — Screen Control',
    ref: '6.3.5 Control Panel / 6.3.5.1 Screen Control / Service 4.3.1.1 Touch Panel Coordinate Adjustment',
    source: 'manual',
    summary:
      'Operation panel housekeeping. All Control Panel functions need the ' +
      'Installation level or above. Backlight Saver selects Saver On / ' +
      'Semi brightness / Full brightness; BL Saver On Time is the idle ' +
      'time before the saver kicks in. Tune-up recalibrates the touch ' +
      'panel (Maintenance level work). Wallpaper and Characters change the ' +
      'screen background and the message-window character whose face ' +
      'reflects unit status.',
    keys: [
      { name: 'Backlight Saver / BL Saver On Time', desc: 'Saver mode and its idle delay. Below 5°C, backlight life shortens — keep it On in cold rooms.' },
      { name: 'Touch Panel Tune-up', desc: 'Touch calibration (Maintenance level).' },
      { name: 'Wallpaper / Characters', desc: 'Cosmetic screen settings.' },
      { name: 'Tabs', desc: 'Screen Control, Password Set / LangSlct Set, Destination ID, Com. Setting.' },
    ],
    note:
      'The Tune-up procedure is Service 4.3.1.1: press Tune-up, confirm ' +
      'with Yes, press Cal 4 Point on the Touchkit screen, then touch the ' +
      'four coordinate marks in the order they appear (a ball-point pen or ' +
      'similar is used here). It is Maintenance-level work.',
  },

  'panel-password': {
    title: 'Control Panel — Password Set / Language Select',
    ref: '6.3.5.2 Password Set / 6.3.4 Selecting an Operation Level / Service 4.3.2 Password Set–Language Select',
    source: 'manual',
    summary:
      'Sets the password for each operation level. The CCW-R has ' +
      'stacked operation levels — Operator, Site Engineer, Installation ' +
      '(and Maintenance for service work) — selected from the key icon in ' +
      'the upper setting bar; higher levels unlock more menus. Pick a ' +
      'level here, enter its password on the keyboard, and press return.',
    keys: [
      { name: 'Level keys', desc: 'Choose the operation level whose password to change.' },
      { name: 'Exit', desc: 'Ends the setting.' },
    ],
    note:
      'The same tab carries the display-language selection — pick from the ' +
      '[Select display language] pop-up (Service 4.3.2.1). The factory ' +
      'password for the Maintenance Service level is 123 (Service 4.2.1); ' +
      'while a password is typed, the keypad shows *** (Service 4.2.1).',
  },

  'panel-data-output': {
    title: 'Control Panel — Destination ID',
    ref: '6.3.5.3 Destination ID',
    source: 'manual',
    summary:
      'Where Print keys send their data: printer, file or e-mail (or NO ' +
      'for none). “File” writes to the memory card in the card slot. Also ' +
      'holds the website address shown by the information key and the ' +
      'e-mail transmission settings (e-mail setup is Maintenance level).',
    keys: [
      { name: 'Destination ID drop-down', desc: 'Printer / File / E-mail / NO.' },
      { name: 'Access Address', desc: 'Website address for the Information display key.' },
      { name: 'E-mail Setting', desc: 'Transmission setup for e-mailed output.' },
    ],
  },

  'panel-comms': {
    title: 'Control Panel — Com. Setting',
    ref: 'Service 4.3.4 Communication Set',
    source: 'service',
    summary:
      'Network setup for the operation panel and its link to the weigher. ' +
      'The RCU box holds the panel’s own IP address, gateway and subnet ' +
      'mask (Service 4.3.4.1); the Main Body box holds the IP address, ' +
      'password, user name and so on of the main-body controller the panel ' +
      'talks to (Service 4.3.4.2); Server IP Address is set under Service ' +
      '4.3.4.3. Standard values are set at the factory — use them as they ' +
      'are, and change them only when interlocking with a computer after ' +
      'the equipment is received.',
    keys: [
      { name: 'RCU: IP Address / GATEWAY / Subnet Mask', desc: 'The panel’s own network parameters (Service 4.3.4.1). The MAC Address line is a display, not a key.' },
      { name: 'Main Body drop-down', desc: 'Selects the main-body controller (here DACS); its IP Address, Password, User Name and the port fields below are set here (Service 4.3.4.2).' },
      { name: 'Server IP Address', desc: 'The server address (Service 4.3.4.3).' },
      { name: 'Setting', desc: 'Lamp key beneath the Server IP Address fields — not described individually in the Service Manual.' },
      { name: 'Tabs', desc: 'Screen Control, Password Set / LangSlct Set, Destination ID, Com. Setting.' },
      { name: 'Exit', desc: 'Leaves the Control Panel.' },
    ],
    note:
      'NOTE (Service 4.3.4.3): be sure not to make an incorrect change — ' +
      'it may cause a communication failure. ' + SERVICE_NOTE,
  },

  assistant: {
    title: 'Start-up Assistant',
    ref: '6.3.2 Start-up Assistant / 4.4.4 Startup Assistant Function',
    source: 'manual',
    summary:
      'The Start-up Assistant guides the whole path to production: Power ' +
      'Up → Select Preset → WH Zero Adjustment → DF Zero Adjustment → ' +
      'Start. It shows messages, blinks the key to press next, and draws ' +
      'the outline of the work down the left side. If zero adjustment has ' +
      'not been done for 30 minutes after power-on the weigh hoppers show ' +
      'red and the assistant will not move on until it is performed.',
    keys: [
      { name: 'Next', desc: 'Continues the assistant.' },
      { name: 'Cancel', desc: 'Skips the assistant and returns to the Main Menu.' },
    ],
  },

  memo: {
    title: 'Message Board',
    ref: '6.3.1 Message Board',
    source: 'manual',
    summary:
      'Handwrite free notes on the panel with a fingertip — a memo about ' +
      'the run, or a message for the next shift. While a memo exists, the ' +
      'message board key in the upper bar blinks on every menu. Erasing ' +
      'with the eraser alone does not clear the memo data — use Erase All ' +
      'to clear it and stop the blinking.',
    keys: [
      { name: 'Line thickness / color', desc: 'Thick, medium or thin; red, blue or black.' },
      { name: 'Eraser / Erase All', desc: 'Erase traced parts, or the whole board (with confirmation).' },
      { name: 'Transmit', desc: 'Sends the board as an image by e-mail (destination set under Destination ID, Maintenance level).' },
      { name: 'Exit', desc: 'Returns to the previous menu.' },
    ],
    note:
      'CAUTION (6.3.1): write with a fingertip only — a pen or pointed ' +
      'tool damages the operation panel.',
  },

  /* ---------------- Engineering screens (Machine Set menus) ------------- */

  'manual-scale-adjust': {
    title: 'Manual Adjustment — Weighing Adjst',
    ref: null,
    source: 'observed',
    summary:
      'Per-head manual weighing check. The screen shows all 14 weigh ' +
      'hoppers with their current readings (0.0 g empty), an All Head ' +
      'SLCT/CLR key, and Zero Adjst / WH Span Adjustment keys. Those two ' +
      'keys need BOTH control power on and at least one head selected — ' +
      'with heads selected but power off they dim again (observed on the ' +
      'running program). Selection itself works with power off.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'manual-combination': {
    title: 'Manual Adjustment — Combi. Calcltn',
    ref: null,
    source: 'observed',
    summary:
      'Manual combination calculation: the layout mirrors the production ' +
      'Combination view (weight display, hopper ring, preset summary) for ' +
      'exercising combination weighing by hand. The legend shows Error, ' +
      'Deactivated and Unavailable head markers.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'manual-vibration': {
    title: 'Manual Adjustment — AFV Monitor',
    ref: 'Service 5.3 AFV (Anti Floor Vibration)',
    source: 'service',
    summary:
      'Live view of the four anti-floor-vibration load cells. The CCW-R ' +
      'carries four AFV load cells (AFV1–4) whatever the head count; the ' +
      'floor-vibration component they measure is subtracted from each ' +
      'weigh signal, which lets a short, high-cutoff filter do what a ' +
      'long slow one otherwise would (Service 5.3.1–5.3.2). This monitor ' +
      'traces all four on a ±160-count scale. With the AFV setting in ' +
      'auto, compensation switches itself off below a capacity-dependent ' +
      'vibration threshold (0.15–0.5 g) and on above it (5.3.3).',
    keys: [
      { name: '+ / − magnifier keys', desc: 'Zoom the trace scale.' },
      { name: 'Drive Stop / Drive Start', desc: 'Dimmed on this capture; not described individually in the Service Manual.' },
    ],
    note:
      'The AFV system, coefficients and thresholds are Service 5.3; the ' +
      'monitor screen itself is not stepped through in the manual. ' +
      SERVICE_NOTE,
  },

  'manual-weight-waveform': {
    title: 'Manual Adjustment — WeighData Disp.',
    ref: null,
    source: 'observed',
    summary:
      'Weigh data display: select a head and a unit type (DF / RF / PH / ' +
      'WH), choose the filter output (Auto, 3rdFilter, 4thFilter) and use ' +
      'Drive Start to capture the weight waveform.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'selfdiag-device': {
    title: 'Self-diagnosis — Device Check',
    ref: null,
    source: 'observed',
    summary:
      'Runs device checks and reports into the Diagnosis Result box. On ' +
      'this capture DMU Backup Memory Check is selectable, with ' +
      'Communication Check and LCD Dot Failure Check grayed out; Exec. ' +
      'starts the selected check.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'selfdiag-io': {
    title: 'Self-diagnosis — In/Output Signal',
    ref: null,
    source: 'observed',
    summary:
      'Live I/O signal monitor: input pins (interlock signals 1–2, AUX ' +
      '1–6) on the left, output pins (discharge completion, error, infeed ' +
      'control and control signals) on the right, with a relay unit ' +
      'number selector and DIP-switch display.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'selfdiag-network': {
    title: 'Self-diagnosis — Network Analyze',
    ref: null,
    source: 'observed',
    summary:
      'Draws the weigher’s internal network: the 14 head DUCs, feeder ' +
      'drivers (FDRV) and FDC on one bus into HUB 1, then WCU / ICU / DMU ' +
      'with the RCU, ADC and EXC units. The WCU / ICU / DMU keys switch ' +
      'which controller’s tree is analyzed, and Reconfigure Count shows ' +
      'how often the network re-formed.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'selfdiag-program': {
    title: 'Self-diagnosis — Program Number',
    ref: null,
    source: 'observed',
    summary:
      'Firmware inventory: every unit (PACK, DMU, FDC, ADC, EXC, ICU and ' +
      'each head DUC) with its node number, program number and revision. ' +
      'The FDC Information box shows switch setting, FD power frequency ' +
      'and voltage. Output prints the list — useful before requesting ' +
      'service.',
    keys: [],
    note:
      OBSERVED_NOTE +
      ' The Service Manual’s frequency troubleshooting reads this screen: ' +
      'if the WCU and FDC program numbers show here but no ' +
      'natural-frequency response comes back, the FDRV board (or the ' +
      'WCU–FDC wiring) is suspect (Service 5.4.3.1).',
  },

  'selfdiag-test': {
    title: 'Self-diagnosis — Test Drive',
    ref: null,
    source: 'observed',
    summary:
      'Exercises units without product: select All WH, DF, RF, PH or WH ' +
      'and use Drive Start / Drive Stop to run them as a test.\n\n' +
      'NOT power-gated — the exception on this machine: with control ' +
      'power OFF, Drive Start is live and pressing it runs the test drive ' +
      '(observed on the running program). While the test runs, the unit ' +
      'selectors dim and Drive Stop lights.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'display-screen': {
    title: 'Display & Data Manager — Layout Setting',
    ref: 'Service 4.4.2.1 Layout Setting',
    source: 'service',
    summary:
      'Sets where head No. 1 is drawn on the on-screen hopper ring, so the ' +
      'display matches how the machine actually stands. No. 1 can be ' +
      'placed in any position; No. 2 and later follow counterclockwise ' +
      'from it. Nothing moves physically — only the display changes ' +
      '(Service 4.4.2.1 TIP).',
    keys: [
      { name: 'Head No 1 Location Setting ring', desc: 'The 14 hopper symbols — the display position for head No. 1 is chosen on this ring (Service 4.4.2.1).' },
      { name: 'Tabs', desc: 'Layout Setting, Preset Manager, Machine Set Mngr, All Setting Mngr, Hopper Name Set.' },
    ],
    note: SERVICE_NOTE,
  },

  'display-preset': {
    title: 'Display & Data Manager — Preset Manager',
    ref: null,
    source: 'observed',
    summary:
      'Copies presets between source and destination (Memory or Card): ' +
      'pick source and destination slots, then Copy or All Select. ' +
      'Initialize wipes the chosen store. On this capture presets 1–3 ' +
      'hold POTATO CHIPS.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'display-machine-edit': {
    title: 'Display & Data Manager — Machine Set Mngr',
    ref: 'Service 4.4.2.2 Machine Set Manager',
    source: 'service',
    summary:
      'Moves machine-setting data between the weigher’s memory and the ' +
      'memory card — how a machine backup is taken or restored. The keys ' +
      'here initialize all parameters on the memory card (RCU, DMU), write ' +
      'all parameter numbers to the card, and read them back from it ' +
      '(Service 4.4.2.2). The list shows what travels: Weigh Spec, ' +
      'Combination, Section, Infeed Control, Packer Interlock, H DRV Spec, ' +
      'FD Spec, AFV and Frequency settings.',
    keys: [
      { name: 'Source / Destination drop-downs', desc: 'Memory or Card at each end of the copy (Memory → Card on this capture).' },
      { name: 'Copy', desc: 'Copies the selected slot from Source to Destination; the numbered boxes above it show the slots.' },
      { name: 'All Select', desc: 'Selects every parameter set at once.' },
      { name: 'Initialize', desc: 'Initialises all parameters on the memory card (Service 4.4.2.2).' },
    ],
    note:
      'Initialize erases the card’s stored parameters. Before restoring, ' +
      'be sure which direction the copy runs — Source overwrites ' +
      'Destination. ' + SERVICE_NOTE,
  },

  'display-all-edit': {
    title: 'Display & Data Manager — All Setting Mngr',
    ref: 'Service 4.4.2.3 All Setting Manager',
    source: 'service',
    summary:
      'Bulk initialisation of stored settings. Memory Initialize wipes the ' +
      'weigher’s memory — confirm with Yes, then reboot the main power as ' +
      'the screen instructs (Service 4.4.2.3.1). Card Initialize wipes a ' +
      'memory card: insert it in the remote control’s card slot, press ' +
      'Initialize, confirm, and remove the card when it finishes (Service ' +
      '4.4.2.3.2). EEPROM Initialize is in the Maintenance menu tree ' +
      '(Service 1.3, item 25.5.3) but is not stepped through in the manual.',
    keys: [
      { name: 'Memory Initialize — Initialize', desc: 'Initialises the memory; needs a main-power reboot afterwards (Service 4.4.2.3.1).' },
      { name: 'Card Initialize — Initialize', desc: 'Initialises the memory card in the card slot (Service 4.4.2.3.2).' },
      { name: 'EEPROM Initialize — Initialize', desc: 'Listed in the menu tree only (Service 1.3); not described in the manual.' },
    ],
    note:
      'Destructive — everything initialized here is erased. Feeder ' +
      'frequency data can be lost with the RAM data (memory ' +
      'initialisation with DMU DIP SW 2-6 ON): save the frequencies to the ' +
      'memory card first (Service 5.4.2.3). ' + SERVICE_NOTE,
  },

  'display-hopper': {
    title: 'Display & Data Manager — Hopper Name Set',
    ref: 'Service 4.4.2.4 Hopper Name Setting',
    source: 'service',
    summary:
      'Chooses the display names for the three auxiliary hopper positions. ' +
      'Three settings can be selected; pick the desired hopper name from ' +
      'the menu under each (Service 4.4.2.4). The manual’s figures show ' +
      'the choices run through the timing-hopper family — Ring Shutter, ' +
      'Timing Hopper, Diverting Timing Hopper and the other variants.',
    keys: [
      { name: 'RingShutter (RS) / DivertingTimingHppr (DTH) / TimingHopper (TH)', desc: 'One drop-down per position; select the desired hopper name from the list in each menu (Service 4.4.2.4).' },
    ],
    note: SERVICE_NOTE,
  },

  'various-scale-detail': {
    title: 'Various Parameter Setting — Weigh Spec Set',
    ref: null,
    source: 'observed',
    summary:
      'Core weighing specification: Range (400 g / 800 g), Stable ' +
      'Judgment Weight, Empty Judgment Weight, Stable Count, Auto Zero ' +
      'Tolerance and Auto Zero Interval, plus the AFV filter table ' +
      '(Filter0–4, Off/Auto).',
    keys: [],
    note:
      OBSERVED_NOTE +
      ' One corner is covered: the filter/AFV relationship (Service ' +
      '5.3.4). Filters 0 and 1 are weak against low-frequency floor ' +
      'vibration, so the AFV works with them; filter 2 may be Off or ' +
      'Auto, judged by conditions; with filters 3 and 4 the AFV does not ' +
      'operate.',
  },

  'various-combination': {
    title: 'Various Parameter Setting — Combination Set',
    ref: null,
    source: 'observed',
    summary:
      'Combination error policy: Compensation Value, Auto Compensation ' +
      'Revision, and the Action for Error table — what happens on Zero ' +
      'Error, hopper errors and Overscale Error (Auto CLR / Stop / No ' +
      'Act), Error Stop Head Number, Overweight Error Stop Count and ' +
      'Recheck Error handling.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'various-section': {
    title: 'Various Parameter Setting — Sectioning Set',
    ref: null,
    source: 'observed',
    summary:
      'Sectioning patterns: an 8×8 grid assigning head ranges to sections ' +
      'S1–S8 per pattern number (here pattern 1 and 2 give S1 heads ' +
      '1–14), with smallest / largest head number keys. Sectioning lets ' +
      'one weigher run different products on head groups — the pattern is ' +
      'selected per preset on the Machine tab (6.10.1.2).',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'various-fd': {
    title: 'Various Parameter Setting — FD Spec Set',
    ref: null,
    source: 'observed',
    summary:
      'Feeder drive specification: standard and boost amplitude min/max ' +
      'values, Amplitude Selection (STD AMP / Boost AMP), RF/DF Slow ' +
      'Start, RF Shutter Drive Condition and Photo Eye Switch RF Stop.',
    keys: [],
    note:
      OBSERVED_NOTE +
      ' This screen’s section does exist — Service 4.4.3.1 Feeder Drive ' +
      'Specifications, and the Maintenance menu tree (Service 1.3, items ' +
      '26.4.x) confirms these item names — but pages 4-19 to 4-25 are ' +
      'missing from our copy of the Service Manual PDF, so the key ' +
      'functions are not described here.',
  },

  'various-hdrv': {
    title: 'Various Parameter Setting — H DRV Spec Set',
    ref: 'Service 4.4.3.2 Hopper Drive Specification Setting',
    source: 'service',
    summary:
      'How each hopper’s motor physically drives, one parameter page per ' +
      'unit — Pool, Weigh and Booster hoppers follow Service 4.4.3.2.1, ' +
      'the DTH / TH / RingShutter follow 4.4.3.2.3. Three parameter sets ' +
      'exist per unit, chosen per preset: Parameter 1 is the standard ' +
      'drive pattern, 2 opens and closes faster, 3 pauses at full open ' +
      'and is slower (4.4.3.2.1). Scrolling down reveals the Hopper ' +
      'Open/Close Drive Pattern — up to 8 sections of Range / Speed / ' +
      'Hold Time / Slow Start / Slow Stop that shape the motor’s rotation ' +
      '(4.4.3.2.2).',
    keys: [
      { name: 'Parameter1 drop-down', desc: 'Selects the parameter set for the unit (4.4.3.2.1 describes three: 1 the standard drive pattern, 2 opens and closes faster, 3 pauses at full open and is slower; the program\'s list runs to 4). Tap it here to open the list. It is drawn — this header never opened on the program, though the same header on the Peripheral screen does.' },
      { name: 'Pool Hopper … TimingHopper', desc: 'Selects which hopper unit the page edits.' },
      { name: 'Actuator Type', desc: 'Stepping Motor or Air. Air is only for hoppers driven by an air cylinder — with Air set, the other drive settings become inoperative.' },
      { name: 'Brake Time', desc: '0–2550 ms of brake holding the stepping-motor phase after the motor stops. Usually 100 ms (RS: 2550 ms).' },
      { name: 'Phase Type', desc: '1, 2 or 1-2 phase — step angle and torque change with it. Always set 1-2 phase for hopper open/close.' },
      { name: 'Drive Stop Parameter', desc: 'Slit or Pulse. PH/WH/BH detect the stop position by slit signal — always Slit. DTH/TH/RS use the pulse-count / photo options instead (4.4.3.2.3).' },
      { name: 'Drive Power Parameter', desc: 'Half or Full motor power. Not an energy saver — always set Full.' },
      { name: 'Stop Delay Pulse Count', desc: 'Steps from slit detection until the motor stops, 0–255. Factory values differ per hopper (PH 44, WH 2, BH 2, DTH 4, TH 4); other values make the home position unstable and the open/close louder — do not change.' },
      { name: 'Minimum Output Pulse Count', desc: 'Steps after motor start during which slit signals are not looked at. Usually 100.' },
      { name: 'Error Detect Pulse Count', desc: 'Step difference between normal and reverse rotation that raises an error. 0 disables the check (overlap errors still occur); usually 20.' },
      { name: 'Output', desc: 'Prints the hopper drive parameters (4.4.3.2).' },
      { name: 'Scroll down (seen on the program)', desc: 'The scrollbar\'s down arrow scrolls the page to the Hopper Open/Close Drive Pattern table (4.4.3.2.2): eight sections of Range, Speed, Hold Time, Slow Start and Slow Stop for the pool, weigh and booster hoppers; the RingShutter, DTH and TimingHopper show a 16-section table of Speed (multiplying power) and Repeat (pulse) over two pages. The Graphic/Numerical radio did not respond on the program. Scroll up returns to the parameters, and picking a unit returns to the top.' },
    ],
    note:
      'The manual is emphatic here: always 1-2 Phase, always Slit for ' +
      'PH/WH/BH, always Full power, and leave Stop Delay Pulse Count at ' +
      'the factory value. In the drive-pattern table, never set a section ' +
      'speed above 300 rpm — operation is not guaranteed there (4.4.3.2.2 ' +
      'NOTE). ' + SERVICE_NOTE,
  },

  'weigh-participation': {
    title: 'Weigher Setting — Active Head',
    ref: null,
    source: 'observed',
    summary:
      'Selects which heads participate in weighing: press heads on the ' +
      'ring (or All Head SLCT/CLR) to activate or deactivate them.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'weigh-auto-timing': {
    title: 'Weigher Setting — Auto Timing Set',
    ref: 'Service 4.4.4.1 Automatic Timing Setting',
    source: 'service',
    summary:
      'The machine geometry the weigher uses to work out its own timing ' +
      '(Service 4.4.4.1). Enter the real distances product falls through, ' +
      'the collection chute angle, and the weigh hopper shape. The ' +
      'matching delay times in the preset’s timing adjustment then follow ' +
      'automatically when a hopper open time is changed.',
    keys: [
      { name: 'RF-PH', desc: 'Distance from the radial feeder edge to the pool hopper bottom, in mm (230 mm here). Ten-key entry.' },
      { name: 'PH-WH', desc: 'Distance from the pool hopper edge to the weigh hopper bottom, in mm.' },
      { name: 'WH-chute', desc: 'Distance from the weigh hopper edge to the packer — or to the TH bottom where a timing hopper is fitted — in mm.' },
      { name: 'Angle', desc: 'Collection chute angle in degrees.' },
      { name: 'WH Shape', desc: 'Single Open or Double Open, matching the weigh hopper in use.' },
      { name: 'Output', desc: 'Prints the automatic-timing parameters (4.4.4.1).' },
    ],
    note: SERVICE_NOTE,
  },

  'weigh-network': {
    title: 'Weigher Setting — Network Setting',
    ref: 'Service 4.4.4.2 Network Setting',
    source: 'service',
    summary:
      'Configures the weigher’s internal network — the head DUCs, FDRV / ' +
      'FDC feeder units, WCU / ICU / DMU controllers, ADC, EXC 0–4 and ' +
      'MHIC 1–4 shown in the tree (the same layout Self-diagnosis Network ' +
      'Analyze draws read-only). The standard network is initialized at ' +
      'the factory and the required setting is already in place; this ' +
      'screen is used when an option unit is added after delivery ' +
      '(Service 4.4.4.2).',
    keys: [
      { name: 'Unit blocks', desc: 'The network tree; used to set up a newly added option unit (4.4.4.2).' },
      { name: 'Output', desc: 'Print key.' },
    ],
    note:
      'NOTE (Service 4.4.4.2): no setting of this screen is required ' +
      'again at the site — touch it only to add an option unit. ' +
      SERVICE_NOTE,
  },

  'weigh-adf': {
    title: 'Weigher Setting — AFD Setting',
    ref: 'Service 4.4.4.3 AFD Setting',
    source: 'service',
    summary:
      'Options for the automatic feed (AFD) control system (Service ' +
      '4.4.4.3). When more heads than the Target Value cannot join the ' +
      'combination (unstable, full scale and so on), dispersion-feeder ' +
      'control pauses and the RCU says so — that is AFD Stop for Fewer ' +
      'Available Head. Cleaning Request watches per-WH empty counters and ' +
      'stops DF control when a head looks under-supplied. DF Adjust for ' +
      'Overfeed recalculates the dispersion time every weigh cycle to ' +
      'steady the dispersion feeder’s discharge; DF WT Adjustment ' +
      'classifies the weigh status into 5 types and runs the dispersion ' +
      'weigh to suit.',
    keys: [
      { name: 'AFD Stop for Fewer Available Head — Target Value', desc: 'Ten-key entry; usually 2 (4.4.4.3).' },
      { name: 'Cleaning Request Off / On', desc: 'Usually Off (4.4.4.3).' },
      { name: 'DF Adjust for Overfeed Off / On', desc: 'Usually Off (4.4.4.3).' },
      { name: 'DF WT Adjustment Off / On', desc: 'Usually Off (4.4.4.3).' },
    ],
    note:
      'TIP (Service 4.4.4.3): product flow can defeat the AFD function — ' +
      'turn the AFD settings off when accuracy or speed drops. On this ' +
      'capture Cleaning Request, DF Adjust for Overfeed and DF WT ' +
      'Adjustment are all On; the manual’s usual setting for each is Off. ' +
      SERVICE_NOTE,
  },

  'pack-bagmaker': {
    title: 'Peripheral Equipment Setting — Pckr Intrlck Set',
    ref: null,
    source: 'observed',
    summary:
      'Packer interlock parameters (parameter set 1 shown): Dump Confirm ' +
      'Hold time, Interface Master/Slave, Multi and Manual Dump Initiate ' +
      '(Self/Sync) and Dump Confirm settings. The right-hand list steps ' +
      'through the peripheral units: Pckr Intrick Set, RingShutter, ' +
      'DivertingTimingHppr, TimingHopper.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'pack-ring': {
    title: 'Peripheral Equipment Setting — RingShutter',
    ref: null,
    source: 'observed',
    summary:
      'RingShutter unit setup: Use On/Off, min/max weight head numbers, ' +
      'EXC number and port, Pool in Multi Dump, Cycle Pool, Discharge ' +
      'Direction (proper to side 1 / error to side 2) and Product Hold ' +
      'step.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'pack-distribution': {
    title: 'Peripheral Equipment Setting — DivertingTimingHppr',
    ref: null,
    source: 'observed',
    summary:
      'Diverting timing hopper setup — the same parameter set as the ' +
      'RingShutter page (Use, head range, EXC number/port, pool and ' +
      'discharge direction options) applied to the diverting timing ' +
      'hopper (DTH1, port J412).',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'pack-timing': {
    title: 'Peripheral Equipment Setting — TimingHopper',
    ref: null,
    source: 'observed',
    summary:
      'Timing hopper setup — same parameter set applied to the timing ' +
      'hopper (TH1, port J411).',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'pack-supply': {
    title: 'Peripheral Equipment Setting — Infeedr Cntl Set',
    ref: null,
    source: 'observed',
    summary:
      'Infeeder control: per infeeder number, the head range it serves ' +
      '(1–14 here), Transient Interrupt (0.2 s) and Feed Interrupt (2 s) ' +
      'times, and the infeed detector type (Weight or Photo).',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'autoadj-afv': {
    title: 'Auto Adjustment — AFV Adjustment',
    ref: 'Service 5.3 AFV (Anti Floor Vibration)',
    source: 'service',
    summary:
      'Anti-floor-vibration adjustment. The CCW-R carries four AFV load ' +
      'cells (AFV1–4 — the live readouts at the top) whatever the head ' +
      'count; the floor-vibration component they measure is subtracted ' +
      'from each weigh signal (Service 5.3.1–5.3.2). The per-head AFV ' +
      'coefficient in the table corrects for sensitivity differences ' +
      'between the weigh and AFV load cells — roughly 40000 to 80000 on ' +
      'this series. Adjustment runs with the machine set on soft rubber: ' +
      'alternating halves of the pool hoppers open and close and the ' +
      'feeders drive to apply vibration, and when the calculation count ' +
      'reaches 400 for every head it completes automatically (5.3.2).',
    keys: [
      { name: 'AFV Coeffic. / AFV Adj. CNT', desc: 'Switches the table between each head’s coefficient and its adjustment count (the manual shows both views, Figures 5-1 and 5-2).' },
      { name: 'Registration', desc: 'Registers per-head AFV coefficients — done after replacing the WCU board, from the values recorded in the delivered reference material (5.3.2 NOTE).' },
      { name: 'Recall', desc: 'Recalling sets every head’s AFV coefficient to 60000 (5.3.2 NOTE).' },
      { name: 'Output', desc: 'Print key.' },
      { name: 'Start / Stop', desc: 'Run and stop the automatic adjustment; dimmed on this capture. Power alone does not light them — on the running program they stayed dimmed with control power on as well (the adjustment needs its own preconditions, Service 5.3.2).' },
      { name: 'Interface drop-down (seen on the program)', desc: 'The arrow bar under Interface opens a list: Slave, Master, Stroke On Demand, Bag On Demand — the packer interlock modes of Table 6-21. The program closes the list on a pick but leaves the field reading Master; the simulator writes the pick into the field.' },
      { name: 'Parameter 1 header (seen on the program)', desc: 'Opens the list of parameter sets, Parameter1 to Parameter4, in place of the menu. The program keeps the header reading Parameter 1 whichever is picked; the simulator relabels it.' },
    ],
    note:
      'NOTE (Service 5.3.2): the AFV adjustment is performed before ' +
      'factory shipment and is not necessary after receiving. ' +
      SERVICE_NOTE,
  },

  'autoadj-neutral': {
    title: 'Auto Adjustment — Ntrl Freq. Adj',
    ref: 'Service 5.4.4.1 Adjustment of Natural Frequency',
    source: 'service',
    summary:
      'Automatic measurement of each radial-feeder trough’s natural ' +
      'frequency (Service 5.4.4.1). Select Freq. Adjust, press the trough ' +
      'keys so their figures turn blue (all of them for a full pass), then ' +
      'Start: the troughs gray out, the table shows Adjusting, and each ' +
      'frequency fills in as it completes. All feeders take about 30 ' +
      'minutes on an R-216B-D; a single feeder about 15. The result is ' +
      'memorised in both the FDRV board and the DMU, and the two are ' +
      'checked against each other automatically — a feeder will not drive ' +
      'while they disagree (5.4.2.1, 5.5.1.1).',
    keys: [
      { name: 'Freq. Adjust / Freq. Set', desc: 'Mode switch; the manual’s automatic procedure runs in Freq. Adjust (5.4.4.1). Freq. Set is not stepped through in the manual.' },
      { name: 'Trough No. keys (RF01…)', desc: 'Select which troughs to measure; selected troughs show blue, gray while adjusting (5.4.4.1).' },
      { name: 'Start / Stop', desc: 'Start the automatic adjustment, or cancel it mid-run (5.4.4.1).' },
      { name: 'Output', desc: 'Prints the natural frequencies for storage — photocopy the thermal printout onto plain paper; thermal paper does not keep (5.4.4.1).' },
    ],
    note:
      'TIPs (Service 5.4.4.1): if a single trough errors, check whether ' +
      'the supply chute or the adjacent trough is touching it, fix that ' +
      'and retry; errors on every trough point at the FDRV board or the ' +
      'feeder power unit. ' + SERVICE_NOTE,
  },

  'autoadj-drive': {
    title: 'Auto Adjustment — Drive Freq. Adj',
    ref: 'Service 5.4.4.2 Drive Frequency Check',
    source: 'service',
    summary:
      'Sets the drive frequency each radial feeder actually runs at — a ' +
      'corrected value offset from the natural frequency, because driving ' +
      'a feeder at resonance makes the amplitude far too large (Service ' +
      '5.4.1). Select a trough, step the frequency in 0.1 Hz units, press ' +
      'Drive Start, and check the amplitude with the indicator board on ' +
      'the trough (5.4.4.2). On this PWM-controlled feeder, amplitude is ' +
      'adjusted by frequency, never by the leaf springs: lower frequency ' +
      'gives more amplitude — roughly 0.1 mm per 0.1 Hz — aiming at a ' +
      'maximum feeder amplitude of 2.0 mm (5.4.4.3).',
    keys: [
      { name: 'Trough No. / Frequency table', desc: 'Per-trough drive frequency, displayed and set in 0.1 Hz units (5.4.2.2).' },
      { name: 'Up / down arrows', desc: 'Step the selected trough’s drive frequency by 0.1 Hz (5.4.4.2).' },
      { name: 'Drive Start / Drive Stop', desc: 'Vibrate the selected feeder to check the amplitude, and stop it (5.4.4.2).' },
      { name: 'Output', desc: 'Print key.' },
    ],
    note:
      'NOTE (Service 5.4.4.2): the setting range is 35.0–130.0 Hz, and ' +
      'for safety the drive frequency must never equal the natural ' +
      'frequency. A feeder driven at an improper frequency is damaged ' +
      '(5.5.1.1). Do not adjust amplitude with a leaf spring — change the ' +
      'drive frequency instead (5.4.4.3 NOTE). ' + SERVICE_NOTE,
  },

  /* ------------------------------------------------------------------
   * Total Menu (Select Total pop-up on the Main Menu) and the operation
   * level dialogs. These eight screens are composed at runtime, so their
   * artwork is a Ruffle capture of the running program, not a bitmap
   * extracted from the movie (assets/captured/README.md).
   * ------------------------------------------------------------------ */

  'total-current': {
    title: 'Current Total',
    ref: '6.11 Total Menu / 6.11.1 Current Total Menu',
    source: 'manual',
    summary:
      'The total and histogram accumulated since the total was last ' +
      'cleared (6.11.1). The left table is the total data of Table 6-34: ' +
      'Start Time (first proper-weight drain after combination weighing ' +
      'started) and Stop Time, weigher and production speed, the Proper ' +
      'count, and total / mean / S.D. / MAX / MIN weight with the weight ' +
      'range (MAX minus MIN) — proper-weight drains only, between the ' +
      'start and stop times. The right side shows the efficiency since ' +
      'the total started and the weight histogram.\n\nThis is the same ' +
      'data as the Total Data tab on the Production menu (6.6.4); here it ' +
      'is reached from the Main Menu through the Select Total pop-up.',
    keys: [
      { name: 'Total Log drop-down', desc: 'Selects which total record to display (6.11.1).' },
      { name: 'Output', desc: 'Prints the total data or writes it to file (the manual’s Print key).' },
      { name: 'Select Total pop-up', desc: 'The left-edge tab — switches to the other total views (6.11).' },
      { name: 'HISTOGRAM', desc: 'Count of drains per weight class, from the target weight up.' },
      { name: 'Effcncy', desc: 'Efficiency since the total started.' },
      { name: 'Exit', desc: 'Returns to the Main Menu.' },
    ],
    note:
      'The manual gives Production Speed in wpm (Table 6-34); this ' +
      'capture shows it in bpm. The numbers here — 15 proper drains, ' +
      '90.5 g mean — are baked into the capture and cannot change in the ' +
      'simulator.',
  },

  'total-xbar': {
    title: 'X-bar Chart',
    ref: '6.11.2 X-bar Chart Menu',
    source: 'manual',
    summary:
      'A control chart of the average weight: each point is the average ' +
      'per 250 rotations, added since the total started (Table 6-35). The ' +
      'red lines are the upper and lower limits at ±3Σ (Σ = standard ' +
      'deviation) around the center line, and the current standard ' +
      'deviation is read out above the chart. Points pushing toward a ' +
      '±3Σ line mean the process is drifting — worth investigating ' +
      'before packs go out of spec.',
    keys: [
      { name: 'Total Log drop-down', desc: 'Selects the total log to be displayed (6.11.1).' },
      { name: 'Output', desc: 'Prints or data-outputs the chart (the manual’s Print key).' },
      { name: 'Exit', desc: 'Returns to the Main Menu.' },
    ],
  },

  'total-transitional': {
    title: 'Transitional Data of Weigher',
    ref: '6.11.3 Transitional Data of Weigher Menu',
    source: 'manual',
    summary:
      'The weigher’s operation plotted against time: time on the ' +
      'horizontal axis, the chosen quantities on the vertical, with up to ' +
      'four graphs displayed at once (6.11.3). This capture shows one: ' +
      '“Average Head’s Selected” — how many heads the combination picked ' +
      'on average, here settling around 4 of the 14.',
    keys: [
      { name: 'SelectItem drop-down', desc: 'Picks up to four items to plot: Average Head’s Selected, Average Stable Heads, Average Empty Heads, Proper/Over Wt/Over Scale, Efficiency, Mean, Standard Deviation, Speed, Average Infeed Weight, Piece Weight Revision, Parent Dump Weight (Table 6-36).' },
      { name: 'Output', desc: 'Prints or data-outputs the graph (the manual’s Print key).' },
      { name: 'Exit', desc: 'Returns to the Main Menu.' },
    ],
  },

  'total-participation': {
    title: 'Cmb. Participation Data per Head',
    ref: '6.11.4 Participation Data per Head Menu',
    source: 'manual',
    summary:
      'The weigher’s operation status per head, drawn as a radar chart — ' +
      'one spoke per head, 1 to 14 on this machine — with up to four ' +
      'items overlaid at once (6.11.4). This capture plots “Ratio of ' +
      'selection”: how often each head’s hopper was picked into the ' +
      'combination. A head whose ratio sits far below its neighbours is ' +
      'the one to look at — poor infeed, an unstable load cell, or a ' +
      'sticking hopper shows up here first.',
    keys: [
      { name: 'SelectItem drop-down', desc: 'Picks up to four items: Selected / Stable / Empty / Auto Zero / Error / Over Scale ratios, plus filter-selected, unstable, and infeed-amount statistics (Table 6-37).' },
      { name: 'Output', desc: 'Prints or data-outputs the chart (the manual’s Print key).' },
      { name: 'Exit', desc: 'Returns to the Main Menu.' },
    ],
  },

  'total-setting': {
    title: 'Total Setting',
    ref: '6.11.5 Total Setting Menu',
    source: 'manual',
    summary:
      'How the totals are gathered and output (Table 6-38). Every ' +
      'Combination Output prints each combination weight during ' +
      'production; Operation Log Output prints the log, with the four ' +
      'checkboxes choosing which contents (error stops, warnings, machine ' +
      'operations, key operations). Action for Statistical Mem. Full sets ' +
      'what happens when the statistical memory fills: Stop halts ' +
      'production, Continu deletes the oldest data and keeps running. ' +
      'Batch Total Interval sets how often the batch total is output, and ' +
      'Data Sampling Interval sets the sampling period.',
    keys: [
      { name: 'Every Combination Output', desc: 'On: outputs the weight of every combination during production (Table 6-38).' },
      { name: 'Operation Log Output + contents', desc: 'On: outputs the operation log; the checkboxes pick error stop / warning / machine operation / key operation contents.' },
      { name: 'Action for Statistical Mem. Full', desc: 'Stop: stops production when the statistical data is full. Continu: deletes the old data and continues.' },
      { name: 'BATCH TOTAL INTERVAL', desc: 'Time interval for outputting the batch total, in hours.' },
      { name: 'Data Sampling Interval', desc: 'The sampling interval. The manual’s table says hours; this capture is labeled Minute.' },
      { name: 'All Total', desc: 'Clears the accumulated statistical data (Table 6-38) — everything the other five views show. Not a key to press casually.' },
      { name: 'Output', desc: 'Prints or data-outputs the settings (the manual’s Print key).' },
      { name: 'Exit', desc: 'Returns to the Main Menu.' },
    ],
    note:
      'NOTE (6.11): the Total Setting key is displayed at the Site ' +
      'Engineer level or over — an Operator does not see this view in the ' +
      'Select Total drawer. The manual names the first two keys “Print”; ' +
      'this machine labels them Output.',
  },

  'total-operation-log': {
    title: 'Operation Log',
    ref: '6.11.6 Operation Log Menu',
    source: 'manual',
    summary:
      'The weigher’s own diary: numbered, dated rows of what happened — ' +
      'preset selections, drain start/stop, and errors with their detail ' +
      '(row 4 in this capture is a WH ERROR: “DUC STEPPING MOTOR DRIVE ' +
      'ERROR WH12”). The Log Item checkboxes on the right filter which ' +
      'logs are listed (Table 6-39). When a machine “was fine yesterday”, ' +
      'this screen says what actually happened in between.',
    keys: [
      { name: 'Error Stop Log', desc: 'Errors that stopped the weigher.' },
      { name: 'Warning Log', desc: 'Warnings the weigher released.' },
      { name: 'Machine Operation Log', desc: 'Operations the weigher performed.' },
      { name: 'Key Operation Log', desc: 'The key presses made on the operation panel.' },
      { name: 'Output', desc: 'Prints or data-outputs the log (the manual’s Print key).' },
      { name: 'Exit', desc: 'Returns to the Main Menu.' },
    ],
  },

  'level-select': {
    title: 'Select Operation Level',
    ref: 'Service 4.2.1 Maintenance Service Level Display / 6.3.4 Selecting an Operation Level (Operation Manual)',
    source: 'service',
    summary:
      'The pop-up behind the key icon in the upper bar. Four levels ' +
      'stack, each shown with its key-and-dots icon: Operator (1 dot), ' +
      'Site Engineer (2), Installation (3), Maintenance (4). The operable ' +
      'items differ by level, and this is the trainee-critical part: at ' +
      'the Operator level the Main Menu has NO Preset key and NO Machine ' +
      'Set pull-up — absent, not dimmed. Site Engineer or above restores ' +
      'them, and adds the Total Setting view to the Select Total drawer ' +
      '(6.11 NOTE).\n\nSelecting Operator switches immediately, with no ' +
      'password (6.3.4.1) — even from a higher level, and doing so from a ' +
      'menu other than the Main Menu jumps to the Operator Main Menu. ' +
      'Selecting Site Engineer, Installation or Maintenance opens the ' +
      'password keyboard first (6.3.4.2, Service 4.2.1). The strip at the ' +
      'foot of the pop-up collapses it.',
    keys: [
      { name: 'Operator', desc: 'Switches to the Operator level at once — no password (6.3.4.1).' },
      { name: 'Site Engineer / Installation / Maintenance', desc: 'Opens the password keyboard for that level (6.3.4.2, Service 4.2.1).' },
      { name: 'Collapse strip', desc: 'The striped bar at the bottom of the pop-up closes it.' },
      { name: 'HOME', desc: 'Still live under the pop-up — returns to the Main Menu.' },
    ],
    note:
      'The operation panel starts at the Operator level every time the ' +
      'power is turned on (6.3.4) — pressing Power resets the level, so ' +
      'raising it is part of every start-up that needs Preset or Machine ' +
      'Set. The factory password for the Maintenance Service level is 123 ' +
      '(Service 4.2.1 TIP). Work at the lowest level that does the job: ' +
      'the levels exist so a production operator cannot change the ' +
      'machine’s engineering settings by accident.',
  },

  'level-password': {
    title: 'Password Input',
    ref: 'Service 4.2.1 Maintenance Service Level Display / 6.3.4 Selecting an Operation Level (Operation Manual)',
    source: 'service',
    summary:
      'The on-screen keyboard that guards the upper operation levels: a ' +
      'digits row, a full QWERTY layout with CAPS and SHIFT, a space bar, ' +
      'BS (backspace), CLR (clear), CANCEL and the large Return key. Type ' +
      'the password for the level you chose — it displays as *** — and ' +
      'press Return; the Main Menu for that level appears (Service ' +
      '4.2.1). CANCEL abandons the entry and leaves the level as it was.',
    keys: [
      { name: 'Keyboard', desc: 'Types the password; each character displays as * (Service 4.2.1 TIP). The letter keys matter — passwords can be changed from the factory numbers (4.3.2.2 Password Setting).' },
      { name: 'BS / CLR', desc: 'Backspace one character / clear the entry.' },
      { name: 'CANCEL', desc: 'Abandons the password entry — the operation level does not change.' },
      { name: 'Return', desc: 'Confirms the password and switches to the selected level.' },
    ],
    note:
      'The password set at the factory for the Maintenance Service level ' +
      'is 123 (Service 4.2.1 TIP) — and on the machine this program was ' +
      'checked against, 123 also opened the Site Engineer level. In the ' +
      'simulator both CANCEL and Return lead back to the Main Menu; on ' +
      'the real unit Return only proceeds when the password is right. ' +
      'Remember: pressing Power drops the level back to Operator (6.3.4).',
  },
};

export default screenInfo;
