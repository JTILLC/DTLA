# Service Work Troubleshooting Reference

> Compiled from `service-work-master.txt` (Apr 2008 – present, ~14,500 lines).
> For each symptom or component, lists the conditions that produced it and the fix(es) that worked.
> Use this guide to look up recurring issues and proven solutions—do not scroll the timeline.

---

## Bagmaker / Film Sealing Issues

### Symptom: Seals pop / weak seals / leaking bags
- **Cause:** Film too thick for cooling time at target speed
  - **Fix:** Increase cooling time in seal mechanism. Reduce speed if needed. Proven to stop pops at Atlas-202-R and similar bagmakers (2008–present).
  - *Seen on:* Atlas-202-R Frito-Lay; multiple sites over 18 years.

- **Cause:** Jaws misaligned or not seating properly
  - **Fix:** Align jaws precisely. Also adjust home position prox sensors. Will resolve seal quality issues immediately.
  - *Seen on:* Atlas-202-R Fayetteville TN (2011-01-23).

- **Cause:** Seal pressure set too low; overlap weaknesses between end and back seals
  - **Fix:** Increase seal pressure to 2100 lbs or higher. Adjust seal time (typically 10+ cycles). Replace jaw faces with aggressive jaws if tear notch needed.
  - *Seen on:* Multiple bagmakers where end/back seal overlap was leaking (2009–2010).

- **Cause:** Bagmaker never lubricated; M3 motor sensors set incorrectly
  - **Fix:** Lubricate bagmaker completely. Correct M3 motor sensor settings. Adjust cam followers. 
  - *Seen on:* Bagmaker requiring top seal fixes (2009).

### Symptom: Bag length wrong / film tracking off / film stop/advance timing issues
- **Cause:** Film advancing but jaws rotate one extra time, cutting half-bag
  - **Fix:** Increase speed from 25 bpm to 30+ bpm. Install latest ITPS software (e.g., P0121). Settings and voltage must match reference. Do not run below threshold speed where issue recurs.
  - *Seen on:* Bagmaker (2009, recurring at lower speeds).

- **Cause:** Film end switch not disabled in bagger; weigher interlock missing
  - **Fix:** Turn off film end switch on bagger control. Verify scale receives interlock signal from film edge detection.
  - *Seen on:* Customer's weigher not dumping due to missing interlock (2009).

- **Cause:** Timing belt adjustment needed on Apex or similar bagging line
  - **Fix:** Adjust timing belt tension on 260E or equivalent. Verify film drive motor response.
  - *Seen on:* Apex 101R and 260E systems (2010–2011).

---

## Weigher / Load Cell Issues

### Symptom: Weight errors / unstable weights / 0 errors (no weight reading)
- **Cause:** Load cells over-stressed by improper washers installed on DU (Drive Unit)
  - **Fix:** Remove washers from DU's. Run half-weigher if needed pending new load cell order. Customers sometimes add washers unintentionally.
  - *Seen on:* Fresh Express CCW-NZ (2008).

- **Cause:** Weight settings too high (DF weight, amp, time all maxed out)
  - **Fix:** Lower DF weight setting. Reduce amp and time to factory defaults. Perform proper settings adjustment for product control.
  - *Seen on:* Kraft Foods CCW-S (2008), Masterfoods CCW-R/M (2008).

- **Cause:** Load cell stop gaps not adjusted; bottoming out
  - **Fix:** Adjust load cell stop gaps on all affected DU's. Typical DU's 3, 5, 10, 12, etc. (varies by line). Gaps must clear freely.
  - *Seen on:* Numerous CCW-R, Z, M, NZ sites (2008–present, recurring monthly across multiple customers).

- **Cause:** Load cell damaged or failed
  - **Fix:** Replace load cell on affected DU. New DU load cells available from Heat and Control / Ishida.
  - *Seen on:* Multiple DU positions on CCW-Z, CCW-M, CCW-R (2008–present).

- **Cause:** Water inside weigher; Calc disconnect
  - **Fix:** Dry out weigher interior. Do NOT use high-pressure wash near RCU. If water reached RF boards, replace FDRV #2 and ADC board. May need new pre-amp boards.
  - *Seen on:* Icelandic Newport News (2008 water intrusion), Dole/Bessemer (2011 contamination).

### Symptom: Overscales / weights too high
- **Cause:** DF weight set too high
  - **Fix:** Lower DF weight setting to proper range. Customer may have raised it to avoid "low product" errors (counterintuitive fix).
  - *Seen on:* Masterfoods (raised to 1300g for 277g product; customer had lowered to 350g causing low-product errors).

- **Cause:** Drive unit doors stuck on upper DC (door cylinder)
  - **Fix:** Unstick doors. Correct door alignment and DC position.
  - *Seen on:* Nestle CCW-Z (2010).

### Symptom: DU (Drive Unit) won't open / doors stuck / stepper motor errors
- **Cause:** Stepper motor malfunction or linkage issue
  - **Fix:** Replace stepper motor and/or DU board. If linkage bent, bend back to spec or replace if broken beyond repair.
  - *Seen on:* Multiple CCW lines (2010–2011). If swap with spare not permitted, send DU for repair.

- **Cause:** New clutch failure
  - **Fix:** Replace DU clutch; send failed clutch to CA for repair.
  - *Seen on:* Audit at Nestlé (2010) — DU's #3 & #10 needed new clutches.

- **Cause:** Air line restriction; doors slow to open
  - **Fix:** Install new air line from valve to DU #6 (or affected position). Verify air pressure ~80 psi.
  - *Seen on:* Installation audit (2011).

---

## RF (Radial Feeder) / Feed Drive Issues

### Symptom: RF's not working / no feed / RF coils not responding
- **Cause:** FDRV (Feed Drive) board failure
  - **Fix:** Replace FDRV board (e.g., FDRV #1, #2). Board carries RF coil commands.
  - *Seen on:* Multiple CCW-RZ, CCW-R lines; RZ with 4 RF's out (2011), Icelandic with half RF's dead post-water intrusion (2008).

- **Cause:** RF cables disconnected or damaged
  - **Fix:** Replace RF cables from FDRV board to RF coils. Check continuity end-to-end.
  - *Seen on:* Routine maintenance at Nestlé, Frito-Lay multiple sites (2010–2011).

- **Cause:** RF coils / plates not adjusted for gap
  - **Fix:** Remove top cover. Adjust RF plates and coils to proper gap. Verify spacing and alignment.
  - *Seen on:* Service call where 2 RF's went offline; solved by gap adjustment (2009).

- **Cause:** Fuses blown on RF / FDC board
  - **Fix:** Replace blown fuses on FDRV or FDC boards. Verify power supply voltage and current draw.
  - *Seen on:* Power troubleshooting at Frito-Lay (2010).

---

## RCU / Control Board / Electrical Issues

### Symptom: RCU won't power up / magnetic contactor won't pull in
- **Cause:** Defective WCU (Weigher Control Unit) board
  - **Fix:** Replace WCU board. Test voltages on contactor circuit before replacement to rule out external power supply failure.
  - *Seen on:* Kellogg site (2010).

- **Cause:** AC fuse board fault or main power issue
  - **Fix:** Replace AC fuse board. Verify 480v or 208v supply to site. Check TV1 transformer fuse.
  - *Seen on:* Multiple electrical audits (2010–2011).

- **Cause:** Power supply (feeder PS, FDRV PS) failed
  - **Fix:** Replace Feeder Power Supply or FDRV Power Supply. Verify input voltage correct (480v / 208v).
  - *Seen on:* Kellogg, Frito-Lay (2009–2010).

### Symptom: RCU / MCU communication errors / DUC network errors
- **Cause:** ADC (Analog/Digital Converter) board not getting power; loose seating
  - **Fix:** Reseat ADC board in J321 connector. Verify power to ADC. If communication errors persist, replace ADC board.
  - *Seen on:* Multiple sites (2008–2011). Recurs when dust/vibration loosens board.

- **Cause:** DUC network errors; intermittent or constant
  - **Fix:** Install isolation relays as precaution. Simulate production to recreate errors. If errors disappear after relay install, environment was causing RFI (electrical noise).
  - *Seen on:* Nestle Solon (2008) — errors reported but not reproducible; isolation relays prevented future issues.

- **Cause:** Broken or miswired harness between ADC and DUC boards
  - **Fix:** Replace harness # 070-7631-00 (or equivalent for your model). If wires loose or shorted, resolder and test.
  - *Seen on:* Installation incomplete until harness arrived (2008–2009).

- **Cause:** MCU (Motion Control Unit) board failure; won't communicate with RCU
  - **Fix:** Replace MCU board. Perform dynamic calibration after replacement. Verify RCU software compatible with new board.
  - *Seen on:* Multiple sites (2009–2010).

### Symptom: Touch screen won't power / display black
- **Cause:** Water damage inside RCU housing
  - **Fix:** Replace touch screen. Dry out RCU interior. Recommend customer avoid high-pressure wash near electrical cabinet.
  - *Seen on:* Found Fresh Vegetables, Dole (2010–2011); recurs at high-sanitation sites.

- **Cause:** Video card failure on X-ray RCU monitor
  - **Fix:** Replace video card in PC unit. If problem recurs, check Video-Out cable from PC to monitor.
  - *Seen on:* X-ray RCU display failure (2011).

### Symptom: Software / firmware version mismatch
- **Cause:** Old RCU software revision installed; missing features or functions disabled
  - **Fix:** Install latest software version (e.g., P1267 to remove ATA feature if not licensed; W0108U for newer boards). Verify version on RCU screen matches parts list.
  - *Seen on:* Multiple installations (2009–2011).

- **Cause:** Custom RCU software popup error blocking screen; RCU to ICO communication error
  - **Fix:** Update QX-1100 software so popup does not appear. Must press button BEFORE closing popup to avoid disconnect.
  - *Seen on:* Dole Tray Sealer (2011).

---

## Hopper / Chute / Infeed Control

### Symptom: Hopper bridges / product won't flow
- **Cause:** Bent hopper beyond repair; product jamming
  - **Fix:** Order new hopper/weigh head assembly. Customer must reduce product size or revert to lower speeds pending replacement.
  - *Seen on:* Multiple sites; noted as recurring failure point on certain product types (2010–2011).

- **Cause:** Ring shutter misaligned or not installed
  - **Fix:** Install ring shutter. Adjust timing on ring shutter solenoid and gate valve.
  - *Seen on:* Hopper adjustment audit (2008).

- **Cause:** Product bridging at Top Hopper (TH); no infeed control
  - **Fix:** Add crash tube or baffle bar in hopper. Ensure infeed conveyor running. Program infeed motor start/stop with weigher logic (not manually).
  - *Seen on:* Dole tray sealer (2011) — metering conveyor was dumping too much product because infeed logic was hardwired instead of interlock-driven. Reprogrammed PLC logic. Efficiency improved immediately.

### Symptom: Infeed conveyor off-center / product scattered on scale
- **Cause:** Infeed conveyor not centered on scale hopper opening
  - **Fix:** Physically relocate and level infeed conveyor. Verify alignment with scale mouth.
  - *Seen on:* Cheez-It production, M&M line (2010–2011).

### Symptom: Infeed conveyor won't run backward to clear errors
- **Cause:** WCU dipswitch 1-8 not enabled
  - **Fix:** Turn ON dipswitch 1-8 on WCU board. This enables reverse conveyor logic for error clearing.
  - *Seen on:* Installation at Nestlé (2011).

---

## FDRV2 / Drive Boards / Component Failures

### Symptom: FDRV2 board dead / RF's intermittently fail / drive system won't respond
- **Cause:** Water damage / corrosion on FDRV2 board
  - **Fix:** Replace FDRV2 board. Check for secondary water damage in adjacent boards (pre-amp, FDC). Dry out entire cabinet if moisture detected. Improve ventilation to prevent recurrence.
  - *Seen on:* Icelandic (2008 water intrusion), BH DU boards (2011 standing water), Dole (2011 contamination).

- **Cause:** FDRV2 blown fuse or internal short
  - **Fix:** Replace FDRV2 board (not repairable). Inspect power supply output for over-current condition.
  - *Seen on:* Nested (2010), Dole (2011).

### Symptom: DF (Dosing Feeder) coil or solenoid not responding
- **Cause:** DF coil winding failure / solenoid valve stuck
  - **Fix:** Replace DF coil. Replace solenoid valve if internal spool stuck. Check for jamming product in valve.
  - *Seen on:* Routine audits; typically needs replacement every 3–5 years (2008–2011).

- **Cause:** Solenoid valve voltage mismatch (24vdc installed instead of 110vac)
  - **Fix:** Replace solenoid valves with correct voltage (110vac if AC power, 24vdc if DC control). Verify parts list.
  - *Seen on:* Installation error caught before start-up (2010).

---

## Weighing Head / WH (Weigh Head) Assembly Issues

### Symptom: WH won't open / stuck linkage / WH errors
- **Cause:** WH linkage bent or misaligned
  - **Fix:** Bend linkage back to spec (if only slightly bent). If severely bent or broken, order new WH assembly.
  - *Seen on:* Multiple CCW-R/Z/M/NZ lines; typically caused by overload or product jamming (2010–2011).

- **Cause:** Old-style WH hanger incompatible with new weight sensor or DU architecture
  - **Fix:** Order new-style WH hanger from Ishida. Early CCW-R models use completely different hanger geometry than late models. Replace all old hangers if retrofit needed.
  - *Seen on:* One of earliest CCW-R units; incompatible with upgrade parts (2011).

- **Cause:** WH bolts breaking; load cycling fatigue
  - **Fix:** Replace broken bolts with new hardware. If bolts snapped flush, may need new load cell bracket. Recommend periodic bolt inspection.
  - *Seen on:* Recurring at sites with heavy products or old machines (2010–2011).

### Symptom: WH touching DC (door cylinder) / interference
- **Cause:** WH not properly seated or adjusted downward
  - **Fix:** Adjust WH and drive arm clearance. Verify WH gap to DC. Typically 0.25"–0.5" clearance needed.
  - *Seen on:* Audit found multiple WH's touching DC's (2010).

---

## Gaskets / Air Seals / Structural

### Symptom: Air leaks / loss of pressure in DU or WH
- **Cause:** Worn or missing gaskets on DU or WH assemblies
  - **Fix:** Replace all DU gaskets. Also replace BHDU (Booster Head DU) gaskets if equipped. Use part # specific to your model.
  - *Seen on:* Routine maintenance; critical after any drive unit rebuild (2010–2011).

### Symptom: Flexure plates cracked / bent
- **Cause:** Over-pressure or product jamming
  - **Fix:** Replace flexure plate assembly on DF (Dosing Feeder) or drive unit. Verify seating to prevent recurrence.
  - *Seen on:* Water damage + rebuild event; found broken flexure on FDRV2 and DF2 (2011).

---

## Cam Sensor / Proximity Sensor Issues

### Symptom: Cam sensor errors / DU opening/closing timing off
- **Cause:** Cam sensor board flag misaligned
  - **Fix:** Adjust flag position on cam sensor board. Sensor must see flag at top and bottom of cam rotation.
  - *Seen on:* Nestle CCW-NZ audit (2010).

- **Cause:** Cam sensor board failure
  - **Fix:** Replace cam sensor board on affected DU. Verify position after install.
  - *Seen on:* Multiple CCW lines (2010–2011).

### Symptom: Home position prox sensors not detecting / DU position errors
- **Cause:** Sensors set to wrong sensitivity or distance
  - **Fix:** Adjust home position prox sensor settings and distance from target. Re-learn home position in RCU software.
  - *Seen on:* Atlas bagmaker; also found on CCW-R during alignment work (2011).

### Symptom: Load cell sensor errors on DU
- **Cause:** Loose sensor wiring; connector corrosion
  - **Fix:** Reseat load cell sensor connectors. Clean corrosion with electronics contact cleaner. Verify continuity on harness.
  - *Seen on:* Multiple sites; especially post-water damage (2008–2011).

---

## Motor / Drive Arm / Mechanical Linkage

### Symptom: Motor won't start / no rotation
- **Cause:** Motor fuse blown; power supply disconnected
  - **Fix:** Replace fuse. Verify power supply voltage and current output. Check for short in motor winding.
  - *Seen on:* Troubleshooting at multiple sites (2008–2011).

- **Cause:** Motor bearing seized or heavily worn
  - **Fix:** Replace motor. Do not attempt to free seized bearing (risk of winding damage).
  - *Seen on:* Routine maintenance (2008–2011).

### Symptom: Drive arm misaligned / binding / slow response
- **Cause:** Drive arm bent or linkage pin loose
  - **Fix:** Straighten drive arm. Tighten linkage pin (typically 1/4" or 3/8" bolt). Verify smooth rotation through full range.
  - *Seen on:* Multiple DU's during audits (2010–2011); routine adjustment.

### Symptom: M3 motor (bagmaker advance/retract) not responding correctly
- **Cause:** M3 motor sensors set incorrectly
  - **Fix:** Correct M3 motor sensor settings. Verify sensor sees target cam at correct angle. Lubricate bagmaker if dry (sensors and cam followers).
  - *Seen on:* Bagmaker seal quality issues (2009).

---

## Vision System / Sensor / Inspection Equipment

### Symptom: Vision system won't calibrate / stuck in calibration
- **Cause:** Line sensor fluctuating; false readings when conveyor running empty
  - **Fix:** Replace line sensor board. Check that sensor sees clean, consistent target. May need to improve lighting or reflector angle.
  - *Seen on:* X-ray system at production site (2010).

- **Cause:** Photo eye / reflector dirty or misaligned
  - **Fix:** Clean photo eye and reflector. Adjust reflector angle to photo eye line of sight. Verify sensor output on RCU screen.
  - *Seen on:* Label vision system on QX-1100 tray sealer; also tray sensors pre-Distribution System (2011).

### Symptom: Vision system shows false positives / rejects good product
- **Cause:** Denester fins not adjusted; product touching vision sensor
  - **Fix:** Adjust denester fins for proper spacing. Move tray sensors higher so lettuce or product won't trigger false read.
  - *Seen on:* Dole QX-1100 tray sealer (2011).

- **Cause:** Seal vision system photo eye too close; reflector bouncing back too strong
  - **Fix:** Swap photo eye with spare that has longer distance tolerance. Reduce LED brightness if available. Verify reflector distance spec.
  - *Seen on:* Label vision system on QX-1100 (2011).

### Symptom: Seal vision system servo error / conveyor won't start
- **Cause:** 24vdc contactor not pulling in; low voltage to servo motor (~80vac)
  - **Fix:** Check 24vdc power to contactor coil. Force contactor closed with insulated tool to verify circuit. Repair loose connection or replace contactor.
  - *Seen on:* Dole QX-1100 (2011).

### Symptom: Seal vision system disconnect / offline
- **Cause:** Firmware out of date or communication timeout
  - **Fix:** Update seal vision system firmware to latest version. Reset connection between RCU and vision system.
  - *Seen on:* Dole multiple visits (2011).

---

## Fastback / Distribution System

### Symptom: Distribution system not dumping / reverse gate stuck
- **Cause:** Defective transducer sensor on reverse gate; won't detect end of dump cycle
  - **Fix:** Replace transducer sensor on Rev. gate. Verify sensor sees target and signal reaches RCU/control board.
  - *Seen on:* Fastback system at Baptista Bakery (2008).

### Symptom: Distribution system product flow uneven / incorrect bin fill
- **Cause:** Spring gate or nose guide misaligned; product bouncing
  - **Fix:** Align spring gate and nose guide. Install new fastback nose and counter weights if worn.
  - *Seen on:* Dole production (2011).

### Symptom: Distribution system not centered on weigher
- **Cause:** FB mounting bolts loose; nose drifting laterally
  - **Fix:** Tighten all FB mounting bolts. Center nose on DF spout. Verify product flowing straight down.
  - *Seen on:* Dole (2011).

### Symptom: Double dump errors / product dumping twice
- **Cause:** QX IOC (Ishida Europe) software version not supporting double-dump configuration
  - **Fix:** Install correct IOC software version (e.g., Q50118a-70 for double dumps). Coordinate with Ishida Europe on firmware compatibility.
  - *Seen on:* Dole QX-1100 integration (2011); multiple install attempts needed.

---

## Booster Head / BH (Booster Head DU)

### Symptom: BH won't open / BH errors / standing water in BHDU
- **Cause:** Standing water inside BHDU board; electrical short
  - **Fix:** Dry out BHDU's immediately. Replace affected BHDU boards. Replace all gaskets and blown fuses (typically multiple fuses fail post-water). Also replace FDRV2 due to corrosion risk.
  - *Seen on:* Multiple BH DU boards (positions 14, 15, 16 on large CCW-M/Z lines, 2011).

- **Cause:** BH linkage binding or stuck; product jamming
  - **Fix:** Clear product jam. Inspect linkage for bend or crack. Adjust BH gap to verify smooth opening/closing. Replace linkage if bent.
  - *Seen on:* Routine maintenance (2010–2011).

---

## Knife / Seal Plate / Bagmaker Mechanical

### Symptom: Knife blade sticking out / not seating
- **Cause:** Broken spring in knife assembly; blade won't retract
  - **Fix:** Replace broken springs in impression tool (part # 383-5199 or equivalent). Tighten knife blade set screws.
  - *Seen on:* QX-1100 tray sealer during impression tool rebuild (2011).

### Symptom: Knife blade dull / not cutting cleanly
- **Cause:** Wear from extended production run
  - **Fix:** Replace knife blade. Inspect jaw or impression plates for damage from dulled blade.
  - *Seen on:* Routine maintenance (2008–2011).

### Symptom: Jaw shaft broken / jaw assembly misaligned
- **Cause:** Mechanical overload; product jamming or seal pressure spike
  - **Fix:** Replace jaw shaft and sensor. Verify seal pressure setting and product consistency before restart.
  - *Seen on:* Kellogg Atlas-201R (2008) — lengthy replacement downtime.

---

## Electrical Cabinet / Wiring / Interconnect

### Symptom: Relay power supply broken / supply board failure
- **Cause:** Over-current or voltage spike; relay pulled in hard
  - **Fix:** Replace relay power supply. Check for shorts in downstream relay circuits. Install surge protection if spikes recur.
  - *Seen on:* Troubleshooting while replacing other boards (2008–2009).

### Symptom: Wires miswired / crossed in I/O board or tool
- **Cause:** Assembly or maintenance error; two wires swapped on I/O Board
  - **Fix:** Verify wiring diagram. Identify swapped wires (e.g., bone sensor leads on Tray Sealer I/O Board 2). Resolder correctly. Test sensor response.
  - *Seen on:* Dole Tray Sealer bone sensor not working; fixed by re-wiring I/O Board 2 (2011).

### Symptom: Dipswitch settings lost / not saved after power cycle
- **Cause:** RCU software cleared or reverted; dipswitch states not persisted in backup
  - **Fix:** Re-enter all dipswitch settings manually. Document settings in customer file for quick reset if power loss occurs.
  - *Seen on:* Dole after power failure; RCU software did not retain dimswitch 1-8 state (2011).

---

## Settings / Calibration / Adjustment (Non-Hardware)

### Symptom: Weight accuracy poor / range too wide
- **Cause:** Product control settings (DF weight, amp, time) not optimized for product
  - **Fix:** Lower DF weight if overshooting. Increase amp and time only if undershoot. Typically start with DF weight = product weight + 10–15%. Adjust amp and time in small increments. Test with 20–30 fills.
  - *Seen on:* Multiple new installations and changeovers (2008–2011).

- **Cause:** Product feed too fast; scale can't stabilize
  - **Fix:** Reduce infeed speed or DF dump speed. Slow down line speed if product still unstable. Target 99% efficiency at achievable speed rather than maximum speed.
  - *Seen on:* Cheez-It production (2008) — slowed to 50 bpm for accuracy.

### Symptom: Efficiency low / many rejects or overscales
- **Cause:** Hopper bridging; product not flowing consistently
  - **Fix:** Add crash tube or air pulse to hopper. Adjust ring shutter timing. May need to reduce product particle size.
  - *Seen on:* Multiple sites (2008–2011).

- **Cause:** Speed too high for product type
  - **Fix:** Reduce line speed by 5–10 bpm. Increase settle time on scale. Many customers run at 80–90% of maximum speed for reliability.
  - *Seen on:* M&M line (2010) — reduced from 120 bpm to 85–90 bpm so packers could keep up and accuracy improved.

### Symptom: Label or bag preset won't load / wrong product running
- **Cause:** Operator using wrong preset or custom settings not saved
  - **Fix:** Train operator on preset selection. Lock settings in RCU software so operator can only select from pre-programmed presets. Document each preset with product name, target weight, speed.
  - *Seen on:* Dole (2011) — operators kept trying to use old software before chain block setting was enabled; had to educate on new preset system.

---

## Customer-Specific Quirks / Site Conditions

### Recurring Issue: High-pressure wash damaging RCU and weigher electronics
- **Cause:** Customer using > 80 psi wash near electrical cabinet and weigher undercarriage
- **Fix:** Train customer NOT to use high-pressure wash (> 40 psi) near electrical cabinet. Use low-pressure rinse or air blow-down instead. Install splash guard or cabinet cover if available.
- **Seen on:** Dole Bessemer (recurring water damage 2010–2011), multiple sanitation-heavy sites.

### Recurring Issue: Operators changing settings without documentation
- **Cause:** Operators lower DF weight or adjust other parameters to avoid "low product" errors instead of addressing root cause (bridge, slow infeed)
- **Fix:** Lock RCU settings or require supervisor approval to change. Document all preset settings on posted chart. Educate operators on why parameters matter.
- **Seen on:** Masterfoods (DF lowered to 350g for 277g product), Dole (multiple preset errors).

### Recurring Issue: Loose or missing bolts on drive units and mounting hardware
- **Cause:** Vibration and thermal cycling; bolts back off over time
- **Fix:** Periodic bolt inspection (monthly recommended). Use thread-lock compound on critical bolts. Replace with proper fasteners (grade 8 recommended).
- **Seen on:** Many sites; accelerated on older equipment (2010–2011).

---

## Summary of Most Common Fixes (By Frequency)

1. **Load cell stop gap adjustment** — Appears 50+ times. Always check gaps first on weight errors.
2. **Software update / firmware upload** — 20+ times. Many issues resolve with latest version.
3. **Water intrusion / drying out / board replacement** — 15+ times. High-pressure wash is #1 culprit.
4. **FDRV / FDC / ADC board replacement** — 20+ times. Most common electrical failure.
5. **Seal pressure / cooling time adjustment** — 15+ times. Usually fixes seal quality without parts.
6. **Gasket replacement** — 10+ times. Always replace gaskets during any DU rebuild.
7. **Drive arm adjustment / straightening** — 15+ times. Simple mechanical fix, often overlooked.
8. **Motor sensor settings / prox sensor adjustment** — 10+ times.
9. **Bolt tightening / fastener replacement** — Recurring across all sites.
10. **Hopper / chute adjustment** — Appears frequently but often requires new part for complete fix.

---

**Last Updated:** 2026-04-17  
**Next Review:** When new major system changes deployed or recurring issues identified.

