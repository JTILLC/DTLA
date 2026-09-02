/**
 * Per-screen training content.
 *
 * Every entry keyed by the screen slug in navmap.json. `ref` is the section
 * of the Ishida CCW R Operation Manual the text is drawn from — quote it to
 * trainees so they can read further. `source` is honest provenance:
 *
 *   'manual'   — summary and key functions come from the Operation Manual.
 *   'observed' — the screen is NOT covered by the Operation Manual (it is an
 *                engineering screen); the description states only what is
 *                visible on the captured screen itself. The InfoPanel shows a
 *                caution for these.
 *
 * The captured machine is a 14-head CCW-R running preset C1 "POTATO CHIPS",
 * 90.0 g target, 80 wpm. Those numbers are baked into the screenshots and
 * cannot change in the simulator.
 */

const OBSERVED_NOTE =
  'This engineering screen is not covered by the CCW-R Operation Manual. ' +
  'The description states only what is visible on the screen. On a real ' +
  'machine these settings are normally the service engineer’s territory — ' +
  'consult the Technical Manual before changing them.';

export const screenInfo = {
  'main-menu': {
    title: 'Main Menu',
    ref: '6.4 Main Menu',
    source: 'manual',
    summary:
      'The home screen. It appears when the main power switch is turned on ' +
      '(at the Operator level, unless the level was changed at the ' +
      'Installation level). The preset display in the middle shows the ' +
      'selected preset: here C1 “POTATO CHIPS”, 90.0 g target at 80 wpm.',
    keys: [
      { name: 'Zero Adjst', desc: 'Opens the Zero Adjustment menu (6.5).' },
      { name: 'Drain', desc: 'Opens the Drain menu and starts draining the product left in the weigher (6.7, 4.4.9).' },
      { name: 'Full Open', desc: 'Opens the Full Open Lock menu (6.8).' },
      { name: 'Select Preset (photo key)', desc: 'The photo at top right — opens the Select Preset menu (6.9).' },
      { name: 'Preset', desc: 'Opens the Preset menu for editing the product settings (6.10). Needs Site Engineer level or above.' },
      { name: 'Preset item buttons', desc: 'The small squares beside Product Name, Target Weight, Speed etc. change that one value directly via ten-key or keyboard (6.10.5).' },
      { name: 'Select Total pop-up', desc: 'The vertical tab on the left edge selects which total to display (6.11). Not wired in this simulator.' },
      { name: 'Machine Set pop-up', desc: 'The pull-up tab at the bottom selects the Machine Set and Check menus (engineering screens).' },
      { name: 'Power / Stop / Start', desc: 'Control power on-off, stop production, start production (4.4.7). Dimmed keys cannot be pressed.' },
      { name: 'Upper setting bar', desc: 'Message Board, information, Start-up Assistant, language, operation level, Control Panel, date & time and Help keys (6.3).' },
    ],
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
      { name: 'Start', desc: 'Starts zero adjustment for whatever is selected. Dimmed until something is selected.' },
      { name: 'Exit', desc: 'Returns to the Main Menu.' },
    ],
    note:
      'If a hopper does not read 0.0±0.1 g afterwards, run zero adjustment ' +
      'again (4.4.6). In this capture nothing is selected, so Start is dimmed.',
  },

  'run-combination': {
    title: 'Production — Combination',
    ref: '6.6 Production Menu / 6.6.1 Combination Menu',
    source: 'manual',
    summary:
      'The Production menu appears when Start is pressed. The Combination ' +
      'tab shows each discharge: the combination weight on the big display ' +
      'and, per head, which hoppers took part.\n\n' +
      'Lamp colours on the weight display: green = proper weight, yellow = ' +
      'overweight, red = underweight. To stop production (4.4.8): turn ' +
      'Infeed Control off, press Stop, then Exit to return to the Main Menu.',
    keys: [
      { name: 'Combination weight display', desc: 'The weight of each discharge with a green / yellow / red lamp for proper / over / under weight.' },
      { name: 'Hopper display', desc: 'Head symbols show weighed-and-stable, participated-in-combination (circle colour = stability), empty, unstable, auto-zero, error and non-participating heads.' },
      { name: 'Select Preset area', desc: 'Shows the running preset. The squares beside items change a value temporarily during production — the preset itself is not updated (6.10.5).' },
      { name: 'Infeed Control', desc: 'Lamp on = product infeed to the weigher is controlled automatically; lamp off = infeed stopped.' },
      { name: 'Tabs', desc: 'Combination, Feeder Adjust, Timing Adjust, Total Data and Weight Display switch the production view.' },
      { name: 'Exit', desc: 'Returns to the Main Menu.' },
    ],
    note:
      'WARNING (6.6): when Start is pressed the feeders and hoppers start ' +
      'moving — confirm the surroundings are safe first.',
  },

  'run-feeder': {
    title: 'Production — Feeder Adjust',
    ref: '6.6.2 Feeder Adjust Menu / 6.12 Feeder Adjustment Menu',
    source: 'manual',
    summary:
      'Feeder adjustment sets the amplitude and operating time of the ' +
      'radial and dispersion feeders — how much product moves out to the ' +
      'pool hoppers. Select a head on the illustration or the radar chart, ' +
      'turn on the RF Time or RF AMP lamp key, and use the Increase / ' +
      'Decrease arrows.\n\nFeeder values changed here during production ARE ' +
      'written back to the preset (6.6.2).',
    keys: [
      { name: 'Head select keys', desc: 'Pick the head to adjust — the illustration and the chart work together.' },
      { name: 'RF Time / RF AMP lamps', desc: 'Choose whether the arrows change feeder time or feeder amplitude.' },
      { name: 'Head mean / Section mean lamps', desc: 'Overlay the mean infeed per weigh hopper (pink) or per section (red) on the chart.' },
      { name: 'Increase / Decrease', desc: 'Adjust the selected head’s value.' },
      { name: 'Write feeder OptimumVal', desc: 'Visible at the bottom of the production tabs on this machine.' },
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
      'stops. Pressing the Drain key on the Main Menu opens this menu and ' +
      'draining starts. When it finishes, pause the drain and press Exit ' +
      '— Exit stops the drain and returns to the Main Menu.\n\nFeeder and ' +
      'timing values adjusted on the Drain menu are NOT written back to ' +
      'the preset.',
    keys: [
      { name: 'Auto Zero', desc: 'Lamp on = zero adjustment is performed automatically during drain (normally left off).' },
      { name: 'Infeed Control', desc: 'Lamp on = product infeed continues automatically; off = infeed stopped.' },
      { name: 'Drain STOP', desc: 'Pauses the drain.' },
      { name: 'Drain START', desc: 'Starts (resumes) the drain.' },
      { name: 'Exit', desc: 'Stops drain and displays the Main Menu.' },
      { name: 'Tabs', desc: 'Weight Display, Feeder Adjust and Timing Adjust.' },
    ],
    note:
      'In this capture the control power is off, so the drain keys are dimmed.',
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
      { name: 'DF', desc: 'Sets whether to operate the dispersion feeders.' },
      { name: 'RF', desc: 'Sets whether to operate the radial feeders.' },
      { name: 'WH', desc: 'Sets whether to fully open the weigh hoppers.' },
      { name: 'PH', desc: 'Sets whether to fully open the pool hoppers.' },
      { name: 'Open / Close', desc: 'Fully opens or fully closes the selected hoppers.' },
    ],
    note:
      'NOTE (6.8): do not use the Power key during full open lock — doing ' +
      'so may damage the weigher.',
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
      { name: 'Preset tiles', desc: 'One per preset — press to load it on the real unit.' },
      { name: 'Preset No.', desc: 'Select a preset number directly via the ten-key.' },
      { name: 'Slct Dsply', desc: 'Switches to the list display, which shows many presets at once without photos.' },
      { name: 'Exit', desc: 'Returns to the Main Menu.' },
    ],
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
      'Machine behaviour for this product: Speed is the number of packs ' +
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
    ref: '6.3.5 Control Panel / 6.3.5.1 Screen Control',
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
  },

  'panel-password': {
    title: 'Control Panel — Password Set / Language Select',
    ref: '6.3.5.2 Password Set / 6.3.4 Selecting an Operation Level',
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
    ref: null,
    source: 'observed',
    summary:
      'Communication settings tab of the Control Panel. The Operation ' +
      'Manual’s Control Panel section (6.3.5) documents Screen Control, ' +
      'Password Set and Destination ID but not this tab, so only its ' +
      'presence is described here.',
    keys: [],
    note: OBSERVED_NOTE,
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
      { name: 'Line thickness / colour', desc: 'Thick, medium or thin; red, blue or black.' },
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
      'SLCT/CLR key, and dimmed Zero Adjst and Adjustment keys that ' +
      'activate once heads are selected.',
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
    ref: null,
    source: 'observed',
    summary:
      'Live anti-floor-vibration monitor: a ±160-count trace for AFV1–4 ' +
      'with zoom in/out keys and Drive Stop / Drive Start keys.',
    keys: [],
    note: OBSERVED_NOTE,
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
      'Communication Check and LCD Dot Failure Check greyed out; Exec. ' +
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
      'which controller’s tree is analysed, and Reconfigure Count shows ' +
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
    note: OBSERVED_NOTE,
  },

  'selfdiag-test': {
    title: 'Self-diagnosis — Test Drive',
    ref: null,
    source: 'observed',
    summary:
      'Exercises units without product: select All WH, DF, RF, PH or WH ' +
      'and use Drive Start / Drive Stop to run them as a test.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'display-screen': {
    title: 'Display & Data Manager — Layout Setting',
    ref: null,
    source: 'observed',
    summary:
      'Sets where Head No. 1 sits on the on-screen hopper ring so the ' +
      'display matches the physical machine orientation.',
    keys: [],
    note: OBSERVED_NOTE,
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
    ref: null,
    source: 'observed',
    summary:
      'Copies machine settings (Weigh Spec, Combination Set, Section Set, ' +
      'Infeed Control, Packer Interlock, H DRV Spec, FD Spec, AFV, ' +
      'Frequency settings) between Memory and Card — the way a machine ' +
      'backup is taken or restored.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'display-all-edit': {
    title: 'Display & Data Manager — All Setting Mngr',
    ref: null,
    source: 'observed',
    summary:
      'Bulk initialise: Memory Initialize, EEPROM Initialize and Card ' +
      'Initialize, each with its own Initialize key. Destructive — on a ' +
      'real machine this erases stored settings.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'display-hopper': {
    title: 'Display & Data Manager — Hopper Name Set',
    ref: null,
    source: 'observed',
    summary:
      'Renames the auxiliary hoppers: RingShutter (RS), ' +
      'DivertingTimingHppr (DTH) and TimingHopper (TH) display names.',
    keys: [],
    note: OBSERVED_NOTE,
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
    note: OBSERVED_NOTE,
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
    note: OBSERVED_NOTE,
  },

  'various-hdrv': {
    title: 'Various Parameter Setting — H DRV Spec Set',
    ref: null,
    source: 'observed',
    summary:
      'Hopper drive specification per unit (Pool Hopper, Weigh Hopper, ' +
      'Booster Hopper, RingShutter, DivertingTimingHppr, TimingHopper): ' +
      'actuator type (stepping motor / air), brake time, phase type, ' +
      'drive stop and power parameters, and pulse counts.',
    keys: [],
    note: OBSERVED_NOTE,
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
    ref: null,
    source: 'observed',
    summary:
      'Machine geometry used to compute timing automatically: RF-PH and ' +
      'PH-WH drop distances (230 mm), WH-to-chute distance (700 mm), ' +
      'chute angle (53°) and weigh hopper shape (single / double open).',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'weigh-network': {
    title: 'Weigher Setting — Network Setting',
    ref: null,
    source: 'observed',
    summary:
      'Configures the internal network layout — the same WCU / ICU / DMU ' +
      'tree as Self-diagnosis Network Analyze, but editable: head DUCs, ' +
      'FDRV / FDC units, EXC 0–4 and MHIC 1–4 assignments.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'weigh-adf': {
    title: 'Weigher Setting — AFD Setting',
    ref: null,
    source: 'observed',
    summary:
      'Auto feed control options: AFD Stop for Fewer Available Head ' +
      '(target value), Cleaning Request On/Off, DF Adjust for Overfeed ' +
      'and DF WT Adjustment On/Off.',
    keys: [],
    note: OBSERVED_NOTE,
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
    ref: null,
    source: 'observed',
    summary:
      'Anti-floor-vibration auto adjustment: per weigh hopper the AFV ' +
      'coefficient (or adjustment count) is listed, with live AFV1–4 ' +
      'readouts at the top, and Registration / Recall / Output / Start / ' +
      'Stop keys.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'autoadj-neutral': {
    title: 'Auto Adjustment — Ntrl Freq. Adj',
    ref: null,
    source: 'observed',
    summary:
      'Neutral (natural) frequency adjustment of the radial feeder ' +
      'troughs: per trough RF01… the measured frequency, with Freq. ' +
      'Adjust / Freq. Set modes and a Start key to run the measurement.',
    keys: [],
    note: OBSERVED_NOTE,
  },

  'autoadj-drive': {
    title: 'Auto Adjustment — Drive Freq. Adj',
    ref: null,
    source: 'observed',
    summary:
      'Drive frequency adjustment: per trough the drive frequency (around ' +
      '48–50 Hz on this capture) with up/down keys and Drive Start / ' +
      'Drive Stop to test.',
    keys: [],
    note: OBSERVED_NOTE,
  },
};

export default screenInfo;
