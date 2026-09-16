# Server Build Worksheet — Project Handoff

## What this is

A single self-contained HTML file that traders fill in when they sell a
machine, so engineers get a correct, buildable spec instead of a vague
request. It replaced a static paper checklist. No build step, no
dependencies, no internet connection needed — one file, double-click to
open.

**Files:**
- `index.html` — the whole app (HTML + CSS + JS in one file). Deployed as-is
  to GitHub Pages: https://volvaga0.github.io/HPE-Proliant-Worksheet-Builder/
- `worksheet-qa.js` — headless regression test harness (Node + jsdom)

## Who it's for

Scott works engineering-side at a refurb company handling mostly HPE
ProLiant rack servers and Cisco switches. Traders sell machines to clients
with vague or shorthand specs; engineers need a precise, physically valid
build list. This tool sits between the two: trader fills it in (or pastes
what the client sent), tool fills gaps, flags anything physically
impossible or config-incompatible, engineer gets a clean spec slip.

## Running the QA harness

Needs Node.js (any recent LTS). One-time, from `C:\WORKSHEET CREATOR`:

```
winget install OpenJS.NodeJS.LTS
```

Close and reopen the terminal so `node` is on PATH, then:

```
npm install
npm test
```

`npm test` runs `node worksheet-qa.js`, which loads
`index.html` from its own folder (pass a path as the first
arg to test a different copy). Every line should read `ok`; any `FAIL`
sets a non-zero exit code.

All assertions must pass before any change ships. This is not optional —
a single syntax error earlier in this project silently killed every
dropdown, the paste box, and the checks panel at once, and it shipped
without being run first. Rebuild the same habit here: after any edit to
the `<script>` block, run `node --check` on the extracted script, then run
the harness, before calling it done.

**Chain rounds that share mutable state instead of independent fixed
delays** (2026-09-14 — cost real debugging time, worth flagging): rounds
1-8 each start via `setTimeout(fn, N)` at their own fixed `N`, all
registered up front. That's fine as long as every round finishes well
inside its own slot — but a round with its OWN nested `setTimeout` (a
genuine async wait, e.g. round 6's 320ms wait for the app's own blur
debounce) has its nested callback's due time computed *relative to when
that round's outer callback actually ran* — which drifts later as the
file accumulates more rounds/tests and the whole suite gets slower. Once
that drift pushes a nested callback's due time past a LATER round's fixed
absolute delay, the later round fires first and can mutate shared state
(the model, a field value) out from under the still-pending nested check.
This hit round 5's recent-builds assertions once already (surfaced as
"model=DL560 G10" — that was round 7's own model pick leaking in) and
round 6's custom-value mirror check a second time after round 8 was
added. Fix applied both times: (1) if the nested wait wasn't actually
needed — round 5's was, since nothing it read was genuinely async — just
run synchronously; (2) if it IS a real async wait — round 6's 320ms is
the app's own debounce — convert the rounds from independent fixed delays
to an explicit chain (`function runRound7(){...}`, called from inside
round 6's nested callback instead of its own `setTimeout(fn7, N)`), so a
later round can never start before an earlier one's async tail resolves,
regardless of how slow the suite gets. Any NEW round added after round 8
that touches shared DOM state should chain off round 8's end the same
way, not add another independent fixed delay.

## Visual theme

Styled to match the Procurri "HPE ProLiant Inventory Report" export
(`../HPE ProLiant Inventory Report/_deploy_to_server/50154878.html`) so the
two tools read as one family: dark glass surfaces on `#19191a`, cyan
`--signal: #00d4d4` accent, a faint static corner wash on `body`, and
section headers in accent with a lucide-style `.sec-icon` and a soft glow.
The whole palette is CSS custom properties in the single `:root` block at
the top of the `<style>` — retint there, not inline. The header is centred
(logo, title, Server-type control stacked) and carries the Procurri mark at
100px (remote SVG, `brightness(0) invert(1)` to render white on dark, with
a `#logo-fallback` wordmark if it 404s). `@media print` overrides every
token back to black-on-white and drops the glow / back-to-top — check the
print view after any theme change. Semantic colours kept their meaning:
`--success` HPE green (`#00b188`, matches the inventory report's OK text) =
the QUICKSPECS VERIFIED badge, `--check` amber = verify/guess, `--stop` red
= blocked, `--auto` blue = applied, `--tower` periwinkle = the Tower-only
section, `--paste` purple = the paste box. The bottom action `.bar` is
`position:fixed` with `z-index:900`; its content is wrapped in `.bar-inner`
(max-width 1180px, centred) so on a wide monitor the counter and buttons
line up with the form instead of the screen edges. `body` reserves
`calc(84px + env(safe-area-inset-bottom))` of bottom padding.

**Responsive — one page, not two.** A single responsive layout, tuned for
touch; there is deliberately no separate mobile build (double maintenance,
guaranteed drift). Breakpoints: `@media (max-width:980px)` collapses the
form/slip grid to one column (slip drops below, `order:2`); `@media
(max-width:640px)` is the phone pass — every form control goes to
**16px** (below that iOS Safari zooms the page on focus), pills/buttons/kill
get 42–44px min height, the drive/card/riser line lists switch from a
squeezed 6-column grid to `flex-wrap` (qty+capacity on one row, the selects
wrapping), `.pair` stacks, the planner goes full-width, and the bottom bar
puts the status line on its own centred row with 50/50 Copy/Clear buttons.
`viewport-fit=cover` + `env(safe-area-inset-*)` keep clear of the notch and
home indicator; `body{overflow-x:hidden}` is a backstop against sideways
scroll. Tapping the bar's status line smooth-scrolls to the spec slip.

## Architecture

Everything lives in one `<script>` tag at the bottom of the HTML — plus a
small second `<script>` after it that wires the back-to-top button (guarded,
a no-op under jsdom).

### Data (top of the script)

- **`MODELS`** — array of `{m, g, p, s, d, bays, tower, rules}`
  - `m`/`g` = model + generation (e.g. `DL380`/`G10`)
  - `p` = processor platform codes this board accepts (array)
  - `s` = physical CPU sockets
  - `d` = total DIMM slots
  - `bays` = selectable front bay configs (falls back to a generic list)
  - `rules` = cooling/config rules for this exact model, merged over
    `GEN_DEFAULTS[g]`

- **`GEN_DEFAULTS`** — fallback rules by generation (G9/G10/G10+/G11/G12),
  used when a model has no rules of its own or doesn't override a key

- **`CPUS`** — `[code, description, platform, TDP watts, cores]`, the clock
  lives in the description. ~357 seeded processors. Gen9 v3 and v4 are
  **separate platforms** so the picker groups them (like sp1/sp2):
  `e5v3`/`e5v4` (E5-2600, 2-socket), `e5v3x4`/`e5v4x4` (E5-4600, DL560 Gen9),
  `e7v3`/`e7v4` (E7, DL580 Gen9). `code` is the matcher key (no space before
  the v-suffix: `E5-2673v3`); the description carries the readable form.
  Verified Sept 2026 against the DL380 Gen10 / Gen10 Plus / Gen11 and DL325 /
  DL345 / DL385 / DL365 QuickSpecs processor tables — SKUs not in any of
  them were dropped. **Exception:** a handful of E5-2600 v3/v4 OEM parts
  (E5-2673 v3/v4 Azure, E5-2666/2676 v3 and E5-2686/2696 v4 AWS/Azure) are
  kept but tagged "— OEM (…)" in the description: they're not in HPE
  QuickSpecs by nature, but refurb stock ships with them. Everything else
  should trace to a QuickSpecs. Known gap: the picker filters by platform,
  not model, so a 350W part still shows for a chassis that can't cool it.
  **5th Gen AMD EPYC 9005 ("Turin", 21 parts) added 2026-09-11**, sourced
  from the DL385 Gen11 QuickSpecs — tagged its own `turin` platform rather
  than folded into `genoa`, because it runs DIMMs at 6000 MT/s vs Genoa's
  4800 (see `MEMSPEED`). Only `DL385 G11`'s `p:[]` includes `turin` so far —
  DL325/DL345/DL365 Gen11 haven't been individually confirmed to offer it.
  **"U"-suffix Xeon Scalable SKUs are single-socket-only** (Intel disables
  the cross-socket UPI link on these — `G6209U`/`G6210U`/`G6312U`/`G6414U`
  here) on every generation HPE has shipped them; `evaluate()` hard-stops
  picking 2+ processors with one (2026-09-14, matched by a plain `/U$/`
  test on `cpu[0]` — not a per-CPU data field, since it's true for all of
  them and every future one Intel ships under this convention).

- **`PLATFORM_LABELS`** — display names for the CPU dropdown's group
  headers (e.g. `sp2` → "2nd Gen Xeon Scalable — Cascade Lake"). Each entry
  of a model's `p` array becomes its own group.

- **`MEM_PER_SOCKET`** — max GB per socket by platform, used for the
  memory-ceiling check. The check keys off the **selected CPU's** platform
  (`cpu[2]`), falling back to `m.p[0]` — so a v4 part gets 1536GB/socket even
  on a board whose first listed platform is v3 (768).

### Rule keys (documented in a comment block right above `GEN_DEFAULTS`)

```
hsW / hsWtext     TDP at/above this → performance heatsink
hsSku             codes that always ship performance heatsink
hsStdException    codes that ship STANDARD despite exceeding hsW
hsGPU             true → a double-wide PCIe/GPU card needs the performance
                  heatsink whatever the CPU TDP (DL360/DL380 Gen9; a
                  standard-heatsink CPU uses the Graphics Enablement Kit 719082)
hsNoChoice        true → the heatsink ships in the processor kit, no
                  standard/performance selection to make. The sheet skips the
                  recommendation, auto-checks Std, and posts one info line.
                  Set on the 4-socket Gen9 (DL560/DL580) and ML350 Gen9.
fanW              TDP at/above this → high performance fan kit
fanNVMe/fanRear/fanGPU   condition requires performance fans
fanBays           bay configs shipping performance fans as standard
rear              array of the rear / mid-tray drive options this chassis offers
                  (e.g. `['1SFF rear','2x M.2 (dual uFF) rear']` for DL360). Feeds
                  the Rear/midtray datalist AND a hard check — anything else typed
                  there is a `stop`, via `rearSigs()` signature matching. Set on
                  the DL360 and DL380 lines (all gens) + DL365. Models without it
                  keep the generic list; only "midtray" on an unlisted model gets
                  a soft `verify`.
                  **`rear:[]` (empty array)** = the chassis has NO rear / mid-tray
                  bays at all — the field is disabled + cleared and any value is a
                  `stop`. Set on the 4-socket DL560 / DL580 (all gens): dense front
                  drive boxes only. Also: a rear string with both "LFF" and NVMe is
                  always a `stop` (no 3.5-inch NVMe backplane exists).
rearMaxW          rear drives unsupported above this CPU wattage
rear2SFF          bay configs a 2SFF rear cage is allowed on
coolTierW         dual-socket TDP at/above which air cooling is unsupported
singleMaxAirW     air-cooled TDP that is single-socket only
liquidReqW        TDP at/above which liquid cooling is mandatory, any socket count
validCounts       the only CPU counts a board actually supports (e.g. [1,2,4] — DL560 Gen10 skips 3)
riserMax          physical riser positions (hard cap on the input, not just a warning)
psuMax            power supply bays (hard cap on PSU qty).
psu               array of the PSU kits this model offers (name + option part
                  number). Feeds the wattage datalist per-model; generic `PSUS`
                  is the fallback. Set on the ML towers (ATX / Common Slot vs
                  Flex Slot differ by model).
riserMax          physical riser positions. **0 = no riser cages** — PCIe slots
                  are on the system board; the riser section hides and any riser
                  line is a `stop`. Set on the ML30 / ML110 / ML350 towers.
fans              {one,two,perf} standard fan count for 1 CPU / 2 CPUs and the
                  high-performance kit count. Auto-fills the fan qty and drives the
                  "standard is fine because…" note.
pcie              {one,two} add-in-card slots — the CHASSIS ceiling with 1 / 2 CPUs.
                  When the build has riser lines whose kits are in RISERS, the
                  actual PCIe slot count is summed from those kits' `s` values and
                  capped at this ceiling; `pcie` is only the fallback when no
                  scoreable risers are entered. FlexibleLOM is NOT counted.
memPerSocket      override for max GB per socket
hsPart/fanPart    HPE option part numbers, shown in check text
notes             model caveats. Shown filtered: `noteRelevant()` hides a note
                  until at least one thing it names (a bay config, NVMe, rear/
                  midtray drives, a GPU, 24G SAS, a 3-/4-processor build) is
                  actually selected. Notes that name none of those always show.
verified          true = checked against THIS model's own QuickSpecs
```

**Risers are a repeatable line list** (`#risers`, like `#cards`) — a build can
mix riser types. The **`RISERS`** map (keyed `"MODEL GEN"`) holds kit objects
`{n:name, d:detail, s:card-slots (0 = NVMe/SlimSAS, -1 = consumes a slot),
fh/lp:full-height vs low-profile split of s (optional), pos:'primary'|'secondary'
|'tertiary'|'any', cpu2:true, def:true}` from each
model's QuickSpecs "Riser Information" table — currently DL380 Gen10 (full,
16 kits), DL360 Gen10, DL560 Gen10 (7 kits), DL580 Gen10 (5 kits), DL560 Gen9
(4 kits incl. Slot 7 LP) and DL580 Gen9 (the single 9-slot I/O riser); the
rest fall back to `GENERIC_RISERS`. The
collapsible reference list under the field renders every kit as a wrapping
row; clicking one appends a riser line. `evaluate()` then: counts lines vs
`riserMax`, blocks a `cpu2` kit when exactly 1 CPU is set (`stop`) or soft-flags
it when the CPU count is blank, blocks two risers in the same `pos`, sums `s`
for the PCIe slot count, and — when every fitted riser carries an `fh`/`lp`
split — reports the full-height vs low-profile slot mix in `riser-slot-note`
and raises a `BRACKETS` check (LP slots need low-profile brackets; GPU / FH
cards that outnumber the FH slots get flagged). Filling out `RISERS` (incl.
`fh`/`lp`) / `fans` / `pcie` / `psuMax` for the rest of the fleet is ongoing.

**`PSUS`** is just a list of wattages (`'290W'`…`'2200W'`). The worksheet
only needs the slip to read "2x 800W" — efficiency tier and part number were
dropped as noise. The wattage parses straight out for the power-budget
check. (Model `psu` rule arrays are kept as reference data but no longer
feed the picker.)

### Engine (`evaluate()`)

Runs on every input change. Computes the current model's rules, checks
processor/platform match, socket count, DIMM count vs slots vs per-socket
memory ceiling, riser count, drive count vs bay count, and the
fan/heatsink recommendation. Pushes findings into a `checks` array as
`[type, tag, message]` where type is `stop` (blocks the build),
`verify` (needs a human to check something), `flag` (a manual choice
conflicts with the recommendation), `auto` (a recommendation was applied),
or `info` (a model caveat — the `R.notes` ones are filtered by
`noteRelevant()` to what's currently selected). The Config checks panel
grows to fit — no inner scrollbar — and the right column is not sticky, so
a long list stays fully reachable by scrolling the page.

**Power budget:** `estPower()` sums a rough peak draw (board + CPU TDP×qty +
~5W/DIMM + per-drive by interface + ~22W/card or ~250W/GPU + FlexLOM + fans).
`evaluate()` compares it to the entered PSU wattage × qty: a `stop` if the
total can't cover the load at all, a `verify` if a single supply can't carry
the whole load (i.e. not safe for 1+1 redundancy). It's an estimate — the
check text says to confirm with HPE Power Advisor.

**Riser kits:** the `#riser` field is plain text; below it a collapsible
`#riser-kits` list renders each `RISERS` entry as a wrapping row
(name + detail, split on the ` — ` separator). Clicking a row drops the
short name into the field. Replaced the old `<datalist>` (native options
truncate long text).

**Heatsink is never hard-locked.** `applyRec('hs', …)` auto-selects the
recommended pill only if the trader hasn't manually touched that field
(tracked via `manualOverride`). If they pick something else, it stays —
but a `flag` check explains what's recommended and why. If no rule
currently applies, the stale selection is cleared.

**Fans: the recommendation is soft, but "Standard when performance is
*required*" is a hard `stop`.** `applyRec('fan', …, hard=true)` — when a
real thermal/config requirement fires (NVMe, rear/midtray drives, GPU, 24G
SAS, a CPU past `fanW`, or a `fanBays` config that ships perf as standard)
and the trader has forced Standard, it blocks the build instead of just
flagging. This is a deliberate change from the old "never hard-lock fans"
convention — the client asked for it, and every `fanReasons` entry is a
physical requirement, not guidance. The pill itself is still not locked;
only the build is blocked. Fan **quantity** auto-fills from `R.fans` +
socket count unless the trader edits it (`fanTouched`), then a soft
`verify` notes the expected count. `why-fan` always explains the current
state, including "Standard fans are adequate — N fans for 2 processors…"
when nothing forces the upgrade.

**DIMM, riser AND PSU counts are hard-capped** via `updateHardCaps()` —
physical facts, so the input's `max` is set dynamically and the field
turns red (`.field-over`) over the cap. PCI-card count is checked against
`R.pcie` (socket-count aware) in `evaluate()` and blocks over the slot
limit. NVMe/Premium backplane on an LFF front config is a `stop`
(no 3.5-inch NVMe).

### UI pieces

- **Combobox** (`setupCombo()`) — grouped searchable dropdown for System
  model and Processor. Type-to-filter, grouped headers, keyboard nav.
  Selection runs on **`click`** (with a `mousedown` fast-path); picking
  closes the panel so the trailing same-gesture click is a no-op — no timer
  guard. `mousedown`-only was dead on touch devices.
- **Re-focusing a picker shows the full list again.** Both `setupCombo` and
  `attachList` filter only while you *type* — `focus` (and ArrowDown from a
  closed panel) renders everything, so clicking back into a field that got
  filled from a pick doesn't strand you on the one matching row.
- **Dropdown scroll containment** — both `.combo-panel` (model/CPU) and
  `#ac-panel` (memory/controller/PSU/etc.) have `overscroll-behavior:
  contain`, so scrolling a long list to its end doesn't chain into
  scrolling the page behind it once the mouse/touch keeps moving.
- **`attachList(input, listFn)`** — upgrades the former datalist text
  inputs (memory, controller, battery, PSU, FlexibleLOM, expander, bays,
  and the drive `cap` / card `name` / riser `name` / rear-line `v` inputs)
  to a real tap-to-pick dropdown via one shared floating `#ac-panel`.
  `<datalist>` on iOS only shows ~3 hints on the keyboard bar and no
  dropdown, which read as "broken" to users. Free typing still works — the
  list is suggestions. `listFn` returns a `string[]` (or a function for the
  model-dependent ones); entries starting with `—` render as non-selectable
  dividers (both here and in `attachNativeMirror`'s `<optgroup>`s — see
  below) — used for `CTRLS` (grouped Type-a / PCI / OCP / no-suffix).
  Selection is `pointerup` (movement < 12px = a tap, not a scroll) + a
  `click` fallback.
- **`attachNativeMirror(input, listFn)`** (called from inside `attachList`)
  — wraps the field in a `span.ac-wrap` (`display:contents`) holding the
  original input plus a sibling `<select>` built from the same list. A
  `@media(max-width:640px)` rule swaps to the `<select>` so tapping it opens
  the phone's own picker wheel (matching the drive speed/class/interface
  `<select>`s' look) instead of `#ac-panel`; desktop keeps the searchable
  panel. A trailing "Other — type your own…" option flips the wrap into
  `.ac-editing` (shows the input, focused) so free typing still works;
  blurring rebuilds the select with the typed value as a synthetic selected
  option. `run()` calls `syncNativeMirrors()` every cycle to rebuild every
  mirror (skipping one that currently has focus). Desktop also flattens the
  plain `<select>`s' (speed/class/interface, RAID planner) native OS chrome
  via `appearance:none` + a CSS-drawn chevron, scoped to `min-width:641px`,
  so they read the same as the text-input combo fields next to them —
  phones keep the OS glass-picker chrome on those too.
  **Superseded for drive speed/class/interface, and RAID level**
  (2026-09-14, same day): `appearance:none` only themes a `<select>`'s
  CLOSED box — the open listbox popup is browser/OS-native with no
  cross-browser CSS override, so it still didn't match the dark
  `#ac-panel` combo panel every other dropdown uses. Converted all four
  to plain `attachList()` text inputs (`SPDS`/`CLASSES`/`INTERFACES`/
  `RAID_LEVELS`, near `CAPS`) instead — desktop now shows the literal
  same panel as Capacity; phones are unaffected (their native-picker
  mirror was always a real `<select>`, this whole time). **No static
  `<select>` remains anywhere in the page** — the `select{appearance:
  none...}` rule now only matters for the dynamically-created phone
  mirrors (which don't need it — they want native chrome). RAID level's
  list reads `'RAID 5'` for a decent panel; `raidPlan()`'s click handler
  strips it back to the bare digit via `.match(/\d+/)` since that's what
  `raidPlan()`/the slip/paste-parser all still key off internally.
- **Themed combo text fields get a chevron** (`.ac-input`, added inside
  `attachList()`; `.combo-input`, model/CPU's existing static class) —
  otherwise a tap-for-a-list field was visually indistinguishable from
  genuinely free text like `#batdate` (no `attachList()` call → no
  chevron, correctly). Suppressed during `.ac-editing` (the phone
  "Other" free-type fallback) since that's real typing, not a list tap.
- **`setupCombo()` native mirror: added for model+CPU, reverted for both,
  re-added for model only** (all 2026-09-14) — first attempt gave both
  fields the same `.ac-wrap` native-`<select>` swap as `attachNativeMirror`.
  On a real phone that broke search entirely (the mobile CSS breakpoint
  hides `.ac-wrap>input` unconditionally, and neither combo has an "Other"
  typing fallback to fall back to), so it was reverted for both. User's
  call on reconsideration: model's list is short once a generation is
  picked via the G9/G10/… buttons above it — nothing you'd type isn't
  already excluded by that filter — so a native wheel is fine there and
  was put back (`nativeMirror:true` in `modelCombo`'s config, a new
  opt-in flag on `setupCombo()`). CPU stays without one: even with a
  model picked its list can run into the hundreds, where a flat wheel is
  still worse than typing. `attachNativeMirror`'s own fields (memory,
  controller, PSU, etc.) were never affected either way — short lists,
  kept their "Other" free-type fallback throughout.
- **`<select>` placeholder dimming** (`syncSelectPlaceholders()`, called
  every `run()`) — `<select>` has no `::placeholder` pseudo-element in any
  browser, so its "nothing chosen" option rendered at full `--ink`
  brightness, reading as already-filled-in. Toggles a `.ph` class
  (`color:var(--ink-soft)`, not `opacity` — that would dim the whole
  control, border included) on every `<select>` on the page whose value
  is empty; covers drive spd/cls/int, the RAID planner, and every mirror
  uniformly with one rule, present and future.
- **Bay-config quick-pick buttons** (`#bays-btns`, `renderBaysBtns()`,
  rendered from `refreshDependents()`) — tap one of the model's own
  `m.bays` (or `GENERIC_BAYS`) options instead of typing; `#bays` stays a
  free-type field underneath for a config not on the list, same pattern
  as the riser-kit quick-pick buttons above the riser lines.
  `syncBaysBtns()` (every `run()`) keeps the `.on` highlight following
  whichever way the field last changed, button tap or typed text.
- **Rear/mid-tray bays are repeatable lines** (`#rear-lines`, `rearRow()`),
  not one field — a chassis can have a rear cage AND a separate mid-tray
  cage at once (e.g. DL385 G11 8LFF: 4LFF mid-tray + 4LFF rear
  simultaneously). `rearJoined()` joins every line's value with `" + "`
  into the one string every existing rule/slip/paste-parser call already
  expected, so `rearSigs()` (now tagging each `"+"`-split clause
  independently, not one global mid/rear flag for the whole string — that
  was quietly wrong for the pre-existing `'2SFF rear + 4LFF midtray'` combo
  entry too) is the only piece of the rules engine that needed to change.
  A new check blocks two lines that conflict for the *same* bay location
  (two rear-cage picks, or two mid-tray picks) while allowing one of each
  together. `refreshDependents()` disables "Add rear line" and clears any
  existing lines when `R.rear` is `[]` (no rear bays on this model at all).
- **Processor count** is a `#cpuq-btns` segmented button group, rebuilt in
  `refreshDependents()` from `R.validCounts` or `1..m.s` — so DL580 shows
  1/2/3/4, DL560 shows 1/2/4, a single-socket box shows just 1 and
  auto-selects it. `#cpuq` is now a hidden input the buttons drive
  (`setCpuq()`); paste and the CPU-combo `onSelect` call `setCpuq()` too.
  The native `<select>`s in the drive lines are fine on mobile as-is.
- **`stepper(input, {min,max,step})`** wraps a number input in `− [value] +`
  buttons (drive/card/riser line qty, memory qty, PSU qty, fan qty). Reads
  `input.max` at click time so it respects the live caps: `updateHardCaps`
  sets `dimmq.max` / `psuq.max`; `evaluate()` sets `fanq.max` (the fan-cage
  count = max of `R.fans.one/two/perf`) and each drive line's `[data-k=q]`
  `.max` (the chassis bay count), plus `field-over` when a typed value is
  over. Typing still works; the cross-line drive total is still a `stop`.
  `#modelq` and `plan-cap` are deliberately not steppered (can be large /
  are decimals).
- **The fixed action bar hides while the on-screen keyboard is up.** A
  `visualViewport` resize handler (second `<script>`) sets `.bar`
  `transform`/`opacity`/`pointer-events` **inline** when
  `innerHeight − visualViewport.height > 140`, and clears them when it
  closes — inline because a stylesheet rule with `transition:transform`
  didn't reliably win the cascade in every engine. `#back-to-top` hides too.
- **Standard heatsinks now auto-select** when a CPU is chosen that doesn't
  need the performance heatsink (mirrors the fan "std is fine" path — a
  `why-hs` note, no checks-panel line), so it's not left as a gap.
- **Paste-to-fill** (`parseClientText()`) — regex-driven best-effort
  parser for pasted client text. Reports FILLED / CHECK (guessed) /
  SKIPPED so the trader knows what to verify. Never silently guesses a
  consequential field (e.g. ambiguous controller suffix gets a CHECK
  flag, not a silent fill).
  Shorthand grabbers (`grabPSU` / `grabMem` / `grabCpuQty` / `grabTier`)
  tolerate `2x800`, `800w x2`, `dual 800w`, `800w psu`, bare `550w atx`,
  `4x32gb`, `64gb x2`, `dual 6248`, `2P`, `dl380g10` (no spaces), and
  `Gen10 v2` (→ G10+ v2). A tier word near the wattage (`800w titanium`)
  snaps the PSU field to the full kit string incl. part number. Bare AMD
  codes (`7443`) resolve without the "EPYC" prefix; Intel codes tolerate a
  trailing letter (`6248R`). Obvious GPUs / FC HBAs / boot cards get added
  as CHECK lines. `no tpm` no longer trips the TPM control.
  **`grabMem` is drive-context-aware** (2026-09-11): "2x 600GB" reads
  exactly like "2x 16GB" of RAM, so it only counts as memory when it
  ISN'T sitting next to drive words (`SAS`/`SATA`/`SSD`/`HDD`/`NVMe`/an
  RPM speed like `15K`) within ~24 chars — otherwise `textNoMem` only
  blanks the exact substring it matched (`mem.raw`), not every `NxNNgb`
  shape in the text, so a real drive line right next to it survives.
  **Drive-line parsing** (`driveRe`) now accepts any order of
  speed/RAID-class/interface/RPM around the capacity, with a lazy tail
  that stops at the next comma/newline/drive so "2x 600GB 15K SAS, 4x
  1.2TB 10K SAS" splits into two lines instead of being silently skipped
  (the old pattern required speed/class/interface immediately adjacent
  to the capacity with nothing — like an RPM figure — in between).
  **Card-line parsing** also scans every `CARDLIST` entry's leading code
  (`562SFP+`, `530T`, `631SFP28`…) against the text, not just the small
  hand-picked GPU/FC/HBA list, so plain NIC/FLR shorthand like "2x
  562SFP+ 2P 10Gb" gets picked up too (codes under 3 chars or shaped like
  a qty/capacity are excluded to avoid false hits).
  **The SAS-expander guess now reads the identified model's generation**
  instead of always assuming Gen10 — Gen9 gets the 727250-B21 part,
  everything else gets 870549-B21 (only those two are seeded).
  A **"+ bat" / "battery" mention** next to a controller assumes the
  96W Smart Storage Battery and flags it as a CHECK line to confirm
  against the controller generation.
- **Battery and SAS-expander live suggestions** (amber `.cap-note.suggest`,
  `--check` color) — hints under the Battery and SAS-expander fields,
  computed in `evaluate()`. Neither auto-fills or blocks anything;
  `[[worksheet-tool-conventions]]`'s battery-is-manual rule stays in force.
  `CACHED_CTRLS`/`NOCACHE_CTRLS` classify a controller by its HPE/Broadcom
  prefix ("P"/"MR" = write-back cache, needs a battery; "E"/"H"/"B140i"/
  "S100i" = no cache) — suggests 96W when a cached controller has no
  battery entered, and gently flags the reverse (a battery entered on a
  no-cache controller). `CTRL_PORTS` gives the fixed port count for the
  Gen10+ SKUs whose SKU number IS the port count (`P408i-a`→8,
  `P816i-a`→16, `MR216i-p`→16…) — when the bay count exceeds it, suggests
  the same Gen9-vs-Gen10+ expander part the paste parser already assumes.
  Deliberately has NO entry for the Gen8/9 cards (`P440`/`P440ar`/`P840`/
  `P840ar`/`H240`/`H241`) or the two embedded software-RAID controllers —
  their port count isn't fixed by the SKU, so no guess rather than a wrong
  one. Both notes clear the moment the field they're about actually has a
  value, so they never nag once acted on.
- **Storage controllers are filtered by generation** (`CTRL_GENS`,
  `ctrlsFor()`, 2026-09-14) — a real bug report: `CTRLS` used to be one
  flat list offered for every model regardless of generation, so a DL380
  G10 could "pick" an OCP-mezzanine MR-card its chassis has no slot for,
  or an MR-p card that didn't exist until Gen10 Plus. Sourced from HPE
  QuickSpecs (fetched/read directly except where noted):
  - `P408i-a`/`P816i-a`/`E208i-a`/`P408i-p`/`P408e-p`/`P816i-p`/`E208i-p`:
    **G10, G10+ only** — absent from the DL380 Gen11 and ML350 Gen11
    QuickSpecs (both read directly: [DL380 G11](https://www.hpe.com/psnow/doc/a50004307enw),
    [ML350 G11](https://www.hpe.com/psnow/doc/a50004308enw)). `P824i-p`'s
    exact scope wasn't found in a primary doc — assumed G10/G10+ by family
    pattern with its P408i-p/P816i-p siblings; flag if that's wrong.
  - `E208e-p`: **G10, G10+, AND G11** — the one Smart Array part that
    survives into Gen11, confirmed directly in both QuickSpecs above
    ("Essential RAID Controller: HPE Smart Array E208e-p SR Gen10
    Controller"), consistently across a rack and a tower model.
  - `SR932i-p`/`MR216i-p`/`MR416i-p`: **G10+, G11** — confirmed G11 direct
    from the same two docs; G10+ existence via [HPE SR Gen10 Plus Controllers QuickSpecs](https://www.hpe.com/us/en/collaterals/collateral.a50002562enw.html)
    and reseller-quoted part lists.
  - `MR216i-o`/`MR416i-o`/`MR408i-o`: **G11 only** — confirmed directly in
    both docs above; does not exist as a Gen10 Plus product at all (the
    OCP-mezzanine mounting is a Gen11 addition, not just a new SKU of an
    existing Gen10 Plus part).
  - `P204i-b`/`P204i-c`: **G10 only** — moved out of the old (wrong)
    "Gen8-9" bucket. These are real "SR Gen10" parts
    ([P204i-b](https://www.hpe.com/psnow/doc/a00008195enw),
    [P204i-c](https://www.hpe.com/psnow/doc/a00008196enw)) but for
    entry-tier boxes (DL20/ML30-class), not the mainstream DL380/DL360
    Gen10 lineup — gated to G10 generation-wide rather than the wrong
    generation, but not narrowed to specific models since nothing else in
    this tool tracks a tier distinction within one generation.
  - `P440`/`P440ar`/`P840`/`P840ar`/`H240`/`H241`/`B140i`/`S100i`:
    confirmed **G9 only** (shared Gen8/Gen9 lineup, no Gen10 overlap) via
    HPE's own [Gen8→Gen9→Gen10 transition chart](https://www.also.com/ec/cms5/media/documents/6110/microsites_5/hpe_4/produkte_uebersicht/smartarraycontroller.pdf).
  - **G12 (Xeon 6) is mostly still an open gap — except 6 MR-series
    names, confirmed while sourcing the SAS-expander fix below.** The
    original controller-verification pass couldn't load a Gen12
    QuickSpecs PDF at all (repeated timeouts). A later pass, sourcing the
    SAS-expander field, successfully fetched and grepped the actual
    DL380 Gen12 QuickSpecs and found its storage-controller lineup IS the
    Gen11 MR family carried forward (`MR216i-o`/`MR216i-p`/`MR416i-o`/
    `MR416i-p`/`MR408i-o`, still Gen11-branded even on Gen12 chassis — an
    HPE naming quirk, not a typo) plus one new part, `MR408i-p` (added to
    `CTRLS`/`CACHED_CTRLS`/`CTRL_PORTS`, port count 8 by the same
    SKU-number-is-port-count convention as `MR408i-o`). `CTRL_GENS` now
    has `'G12'` on just those six. Everything else (P-series, E-series,
    `SR932i-p`, the legacy/entry groups) still has no G12 confirmation
    either way — `ctrlsFor()` still shows the full unfiltered list for
    G12 rather than pruning based on one incidental mention, and
    `evaluate()`'s `verify` note now only fires when the picked
    controller ISN'T one of those six confirmed names.
  A mismatched value that lands in `#ctrl` some other way (typed directly,
  paste-fill, a restored draft, a model switch after the field was already
  set) is still caught — `evaluate()` raises a `stop` if the current value
  is a name `CTRL_GENS` recognizes and the current model's generation
  isn't in its list, same severity as `BACKPLANE MISMATCH`. A genuinely
  unlisted/custom typed value is left alone, same as every other
  free-type field.
- **SAS expanders are filtered by chassis family AND generation**
  (`EXPANDER_PARTS`, `expandersFor()`, 2026-09-14) — the same class of
  bug as the controller picker, plus an extra dimension: `EXPANDERS` was
  one flat list of 3 part numbers shown for every model, but a real SAS
  Expander Card SKU is scoped to a specific chassis family, not just a
  generation. Sourced from the official HPE QuickSpecs **"HPE 12G SAS
  Expander Card," doc c04346272 V6** (its "Models"/"Server Support"
  tables settle this directly), plus a direct primary-doc search for
  Gen10 Plus/Gen11/Gen12:
  - `727250-B21` (Gen9) is **DL380 Gen9 only** — ML350 Gen9 has its own
    part (`769635-B21`), DL560 Gen9 has its own (`804228-B21`), and no
    SKU exists for any other Gen9 chassis this tool models (DL360, DL160,
    DL180, DL60, DL80, DL120, DL20, every ML except ML350).
  - `870549-B21` ("DL38X Gen10" — the SKU's own name says DL380/DL385
    only) is **DL380/DL385 Gen10 only** — ML350 Gen10 has its own part
    (`874576-B21`, **SFF only** — the QuickSpecs explicitly says NOT
    supported on ML350 Gen10 LFF), DL560/DL580 Gen10 share `873444-B21`.
    No SKU for DL360/DL160/DL180/DL325 Gen10.
  - **`876907-B21` ("Gen10 2SFF rear" in the old list) was fabricated —
    removed.** Every real source (official QuickSpecs, HPE support docs,
    multiple resellers) lists `876907-001` as the internal spare/board
    number for the SAME physical card as `870549-B21` kit — not a real,
    separately-orderable "2SFF rear" variant. There was nothing to gate,
    the SKU didn't check out.
  - Gen10 Plus got a **new** DL380/DL385-only part, `P23388-B21`
    ("DL38X Gen10 Plus"), rather than reusing the Gen10 part.
  - **Gen11 and Gen12 dropped the standalone SAS Expander Card product
    line entirely** — confirmed by a direct full-text search of the
    actual DL380 Gen11, ML350 Gen11, and DL380 Gen12 QuickSpecs PDFs:
    zero hits for "expander" in any of them. Their higher-port Tri-Mode
    MR/SR controllers (`SR932i-p` alone reaches 32 direct-connected
    drives) absorbed the job the expander card used to do. No chassis in
    G11 or G12 gets an expander-card option any more — the fallback is a
    second (or higher-port) controller, exactly what HPE itself offers
    instead.
  - The three "external HBA" fallback entries (`P408e-p`/`E208e-p`/
    `H241`, each a controller reused as a way to add ports without an
    expander card) are gated by the same `CTRL_GENS` scope already
    sourced for the controller picker — `H241 external HBA` only shows
    for G9, `E208e-p external HBA` for G10/G10+/G11 (the one survivor),
    `P408e-p external HBA` for G10/G10+ only.
  Every chassis not named above (DL360, DL160, DL180, DL325, DL20,
  DL120, DL110, DL320, DL340, DL345, DL365, and every ML except ML350)
  never had an expander-card SKU in any generation this tool models —
  `expandersFor()` correctly offers none for them, just the generic
  fallbacks. The bay-count-vs-port-count suggestion (`expander-note`)
  and the paste-parser's expander guess both now name the actual
  chassis-correct part via `EXPANDER_PARTS` instead of a blanket
  "Gen9-or-else-Gen10-part" guess, and say plainly when no part exists
  for the current chassis+generation rather than defaulting to one that
  doesn't fit. A mismatched part typed/pasted/restored is caught the
  same way as `CONTROLLER GENERATION`, tagged `EXPANDER GENERATION`.
- **Memory is DDR-generation + platform aware, with real speed/capacity
  grids and quick-pick buttons** (`MEM_DDR`/`MEM_SPEEDS`/`MEM_CAPS`,
  `memPlatforms()`/`dimmsFor()`, 2026-09-14) — the DIMM field used to be
  one flat, DDR4-only list (8-128GB × 2133-3200 MT/s) offered for every
  model, so a DDR5 Gen11/Gen12 build could "select" a DDR4 speed that
  isn't just wrong, the module has a different pin/notch layout and
  physically won't go in the slot. Sourced from HPE's DDR4/DDR5 memory
  QuickSpecs and per-model QuickSpecs memory tables (see PROJECT.md's
  citations below and the storage-controller-verification memory —
  despite the name, it now covers memory too):
  - Every platform this tool models (`e3`/`xeone`/`xeone3`/`e5v3`/`e5v4`/
    `e5v3x4`/`e5v4x4`/`e7v3`/`e7v4`/`sp1`/`sp2`/`sp3`/`naples`/`rome`/
    `milan` = DDR4; `sp4`/`genoa`/`turin`/`xeon6` = DDR5) has its own
    confirmed discrete speed grade(s) and capacity list, not a shared
    generic range.
  - Speed lists are the DIMM's own distinct rated speed(s) — two are
    listed only where the platform genuinely has different natively-
    rated parts tied to a CPU tier (`sp4`: 4800 for 4th Gen Xeon, 5600
    for 5th Gen; **`sp3` corrected 2026-09-15 to 3: 2667/2933/3200,
    same reason** — see the dated entry below, this bullet originally
    lumped `sp3` in with `rome`/`milan` as "just a DPC derate," which a
    fresh QuickSpecs check disproved); where it's genuinely the same
    rated part running slower at 2 DIMMs/channel (confirmed for `rome`/
    `milan`/`sp4`/`xeon6`), only the rated speed is listed and the note
    carries a generic derate reminder instead of a precise-but-
    unconfirmed number. `turin`
    is the deliberate exception: HPE's QuickSpecs states the DIMM is
    rated DDR5-6400 but 5th Gen EPYC only drives it at 6000 — the
    *installed* speed, not a derate — so 6000 is listed since that's
    what the box actually runs and what a build worksheet should say.
  - `memPlatforms(m)` narrows to the SELECTED cpu's own platform once
    one's picked (e.g. e5v3 vs e5v4 have different real grids, and only
    one CPU is ever actually installed); before a CPU is chosen it
    falls back to the union of every platform the model's CPUs could
    use (e.g. DL385 G11 shows both Genoa's 4800 and Turin's 6000 until
    a specific part is picked, then narrows to just one).
  - Two new quick-pick button rows (`#dimm-size-btns`/`#dimm-speed-btns`)
    tap a real capacity and a real speed independently into one
    `"<size>GB <speed>"` field value — same tap-a-button-onto-a-shared-
    field idea as the bay-config buttons, just two rows instead of one.
    The "Suggest even configs" total-memory suggester and its size list
    are now platform-aware too (`suggestMemoryConfigs()`), and its "Use"
    button preserves whatever speed was already picked instead of
    clearing it.
  - A hard `stop` (`MEMORY SPEED`) catches a speed that lands in the
    field some other way (typed, paste-fill, a restored draft) and
    isn't in the current platform's real list — same severity as
    `CONTROLLER GENERATION`/`EXPANDER GENERATION`. Capacity gets only a
    soft `verify` (`MEMORY CAPACITY`), not a hard stop — several
    platforms' exact capacity ceilings weren't sourced as precisely as
    their speeds (see the data-gaps note below), so a stop there risked
    being wrong itself.
  - **Known gaps, left as gaps:** `naples`'s 2DPC derate is unresolved
    (the one source found contradicted itself); `e3`'s capacity ceiling
    above 16GB and `xeone`/`xeone3`'s exact rank/organization weren't
    found in a primary source; `xeon6`'s capacity list is inferred from
    `sp4`'s confirmed DDR5 RDIMM list (same DDR5 RDIMM generation, high
    cross-platform consistency) rather than directly confirmed for
    Gen12. Gen12 also supports **MRDIMM up to 8800 MT/s** (P-core SKUs,
    1 DIMM/channel only) but HPE hadn't released MRDIMM kits into the
    standard orderable ProLiant Compute portfolio as of sourcing —
    deliberately not added as a selectable speed, since it's not
    something a trader can normally order yet.
  - **DIMM rank/organization** (1Rx8, 2Rx4, 4Rx4, etc.) was sourced
    per-capacity (8GB≈1Rx8, 16GB≈1Rx4/2Rx8, 32GB≈2Rx4, 64GB+≈4Rx4/8Rx4
    LRDIMM 3DS, roughly consistent across generations) but was
    deliberately **not** built into a UI field or a validation check —
    the tool has no repeatable-DIMM-lines input the way drives/cards/
    risers do (one qty × one size × one speed for the whole system), so
    there's no reachable UI state that could produce an invalid rank
    combo without a rank field existing in the first place. Documented
    in the storage-controller-verification memory for reference if a
    future need for it comes up, rather than built speculatively now.
- **FlexibleLOM and OCP 3.0 are different, non-interchangeable
  connectors — `flrKind()`/`flrCardsFor()`/`OCP_CARDS`, 2026-09-14.**
  User reported the "FlexibleLOM / OCP" field only ever offered
  FlexibleLOM cards, with zero real OCP options anywhere, even though
  FlexibleLOM was fully retired starting at Gen10 Plus. Checked every
  Gen10 Plus/Gen11 model this tool offers (Gen12 as a bonus) directly
  against its own QuickSpecs:
  - **Every Gen10 Plus/11/12 model checked is OCP-3.0-only** — no
    FlexibleLOM slot exists any more. A few QuickSpecs PDFs (DL365/
    DL380 G10+, DL380 G11) have one leftover "FlexibleLOM" sentence
    that every physical slot diagram and SKU table in the SAME
    document contradicts — treated as an un-scrubbed copy-paste
    artifact, not a real second slot.
  - **Three confirmed exceptions have NEITHER slot at all** (just an
    embedded LOM chip + plain PCIe): `DL20 G10+`, `ML30 G10+`,
    `ML30 G11`. Notably `DL20 G11` is **not** an exception — it gained
    a real OCP slot despite `DL20 G10+` having none, so this can't be
    shortcut by model name alone; `flrKind(m)` keys off `m.m+' '+m.g`
    for the exception list, generation alone otherwise.
  - `OCP_CARDS` is one shared ~18-card catalog (I350-T4, BCM5719/57412/
    57416/57414/57504, X710-DA2, Marvell QL41132/QL41232, Mellanox
    MCX562A/MCX631432AS, Intel E810-XXVDA2/XXVDA4/CQDA2, the Gen12-new
    BCM57608 100Gb, and two InfiniBand 200Gb options) — the same
    catalog turned up on nearly every model checked, unlike controllers/
    expanders/memory where exact part numbers genuinely differed by
    generation. `FLRS` (the original FlexibleLOM list) is untouched and
    still feeds G9/G10 models, which predate OCP entirely.
  - A stray `'366M 4x1GbE (OCP)'` entry in the unrelated PCI **add-in
    card** suggestion list (`CARDLIST`) was removed — a real OCP NIC
    doesn't occupy a PCI slot at all (it has its own mezzanine
    connector, same as FlexibleLOM did), so listing one there
    perpetuated the exact FLR/OCP conflation this fix corrects.
  - A new `#flr-note` explains which connector the current chassis
    actually has; a mismatched card typed/pasted/restored is a hard
    `stop` (`FLEXLOM/OCP MISMATCH`), same severity as
    `CONTROLLER GENERATION`/`MEMORY SPEED`.
  - **Unresolved:** `DL110 G12`'s slot type — every mirror tried
    blocked or 404'd. Defaulted to `'ocp'` (matching every other G12
    model checked) rather than left unhandled, flagged as unverified
    in its own model notes rather than silently assumed solid.
  - **Noticed but not built:** several Gen11/Gen12 models have **2**
    OCP slots (DL360/365/560 G11, most G12 rack models) vs 1 elsewhere
    — this tool's single free-type field doesn't track "how many," the
    same simplification already applied to PCIe/riser slot counts.
- **Media bay / TPM / Motherboard NC / rear-bay 5-subsystem audit —
  `hasMediaBay()`, `tpmKind()`, `motherboardKind()`, quickspecs-cache/,
  2026-09-15.** User asked for media bay, rear/mid-tray, TPM,
  motherboard Standard-vs-NC, and backplane type to be checked per
  model, G10 through G12, directly against each model's own QuickSpecs
  — "the end goal" being every option on the page verified per model
  per generation so a worksheet can never be wrong. This is explicitly
  a multi-session effort; this entry covers what shipped in the first
  session (TPM, Motherboard NC, Media bay — all 3 fully implemented
  and tested for all 45 models). Rear/mid-tray transcription and
  Backplane-type gating are sourced but **not yet built** — see
  "Still open" below.
  - **`quickspecs-cache/` — a new text cache for QuickSpecs PDFs**
    (`README.md`, `MANIFEST.md`, one `.txt` per model+gen via
    `pdftotext -raw`). Directly answers the user's own question ("would
    it be beneficial to cache...") — hpe.com blocks/throttles direct
    fetches and mirrors go stale, so every prior audit had to
    re-discover a working mirror from scratch. **45 of 46 model+gen
    entries now cached** (all G10/G10+/G11/G12 — every rack/tower model
    this tool offers at those 4 generations). Only `DL120 G10` has no
    cache file — no working mirror found across two research passes
    (hpe.com blocked; itcreations.com is a JS SPA serving its homepage
    for any PDF path, confirmed with a real browser fetch, not just
    curl; every other mirror tried has no Gen10 entry for it at all).
    Flagged UNVERIFIED in its own model notes rather than guessed from
    its DL160/DL180 G10 siblings.
  - **TPM (`tpmKind()`) — revised from a blanket "Gen9 vs everything
    else" rule.** Real finding: Gen9/10/10-Plus mostly ship ONE physical
    TPM 2.0 module with an official FIO SKU (872108-B21) that runs it in
    "TPM 1.2 mode" — a firmware switch, not separate 1.2 hardware, but
    every mainstream Gen10/10-Plus doc checked (DL20/160/180/325/360/
    380/385/560/580 G10, ML30/110/350 G10, DL325/325v2/345/360/365/380/
    385/385v2 G10+) explicitly lists both modes as usable. `TPM_EMBEDDED_ONLY`
    is the real exception: `DL20 G10+`/`DL110 G10+`/`ML30 G10+` ship TPM
    2.0 embedded and enabled by default, no discrete module, no 1.2 mode
    at all — the same embedded-only pattern Gen11/Gen12 use chassis-wide
    ("no longer requires TPM module option kit," in nearly every Gen11/12
    doc checked). `TPM12_ALSO=['DL560 G11']` is the one confirmed Gen11+
    exception that still lists both 1.2 and 2.0 as standing options
    (DA-17093) — a real, sourced deviation, not a guess. `#tpm-note`
    reflects all 4 states live; `evaluate()` flags TPM 1.2 only where
    `tpmKind()` returns `'embedded'`.
  - **Motherboard Standard-vs-NC (`motherboardKind()`) — reconceived as
    a 3-state fact, not a universal binary choice.** Most Gen11+ boards
    have ZERO embedded LOM at all, so "Standard" vs "NC" becomes a
    distinction without a difference (`'always-nc'`, `MOBO_ALWAYS_NC`,
    16 G11/G12 models) — `#mobo-note` says so, no hard check (picking
    either radio is valid, just misleading). The mirror-image case,
    `'always-lom'`: a chassis with a real embedded NIC standard and NO
    NC variant to pick at all — a hard `stop` if "NC" is selected
    anyway. Confirmed at G11 (`DL20`/`ML30`/`ML110`) AND, new this pass,
    at plain **G10**: `DL20`/`DL160`/`DL180` G10 each explicitly state in
    their own QuickSpecs that every listed config ships with an embedded
    NIC and no bare/no-NIC board exists. Genuine NC-as-a-real-choice
    models were also found at G10/G10+ (`DL360 G10`, `DL380 G10`,
    `DL360 G10+`, `DL365 G10+`, `DL380 G10+`) — these need no list entry,
    since unclassified models default to `'choice'` already. Every other
    G10/G10+ model's own doc simply didn't mention NC either way (no
    explicit "always ships embedded" statement to confirm it) — left
    unclassified per the "don't guess" rule rather than assumed from a
    sibling's doc.
  - **Media bay (`hasMediaBay()`, `MEDIA_BAY_NONE`).** Only 3 models are
    confirmed/strongly-inferred to have no media bay slot at all on any
    bay config: `DL110 G11` (fixed front-cabled chassis), `DL380a G12`
    (fixed GPU-dense 4SFF chassis, zero mentions in its own QuickSpecs),
    and `DL110 G12` (M.2-only storage — inferred, not directly confirmed,
    since its QuickSpecs wouldn't load from any mirror tried). Every
    other model checked (G10 through G12) has SOME media-bay option,
    often bay-config-dependent (e.g. not available on a model's EDSFF/
    24SFF/12LFF variant) — recorded as a narrative model note where
    found, not a hard per-bay-config block, matching how other bay-
    dependent nuances are handled elsewhere in this tool. `#media-note`
    + an `evaluate()` hard `stop` (picking a real option on a
    `MEDIA_BAY_NONE` model) cover the 3 confirmed-absent models.
  - **Rear/mid-tray — every G10/G10+/G11/G12 model's `rules.rear`
    transcribed from the sourced findings, 2026-09-15 (second pass,
    same day as TPM/Motherboard/Media bay above).** Went through all 45
    models: added `rear:[]` (explicit, hard-blocking) to every model
    confirmed to have no rear/mid-tray cage at all — previously these
    had NO `rear` key, meaning `evaluate()` silently accepted ANY typed
    rear value with zero validation, a bigger gap than the 3 data bugs
    below. Real cage/combo data was added where sourced: `DL180 G10`
    (`2SFF rear`), `DL345 G10+` (`2SFF rear`/`2SFF NVMe rear`), `DL385
    G10` (both rear+midtray combine, same structure as `DL380 G10` —
    source caveat: a reformatted Data Sheet, not the literal HPE PDF),
    `DL380 G10+` (enriched with `8SFF midtray`), `DL385 G10+`/`v2` (both
    rear+midtray combine, different max drive counts between v1/v2),
    `DL345 G11` (a genuinely broader rear+midtray combo than the
    already-known `DL385 G11` case — 2 real combos, not 1), and `DL380
    G12` (rear+midtray combine, matching the Gen11 pattern — replaces
    an earlier "not modeled as a rear option list yet" placeholder
    note). `DL360 G12`/`DL580 G12`/`ML350 G12` got `rear:['2x M.2 (dual
    uFF) rear']` — each chassis's own doc distinguishes a real NS204i-u
    rear boot device from an actual rear DATA cage (none of the three
    have the latter), the same distinction already established for
    `DL360 G11`.
    **Four confirmed data bugs fixed, same root cause each time — a
    rear array copied from a same-numbered sibling model, never
    independently re-checked:**
    - `DL360 G11` (fixed in the first pass this session) — was
      `['1SFF rear','2SFF rear','2x M.2 (dual uFF) rear']`, copied from
      DL380/DL385 G11. Corrected to `['2x M.2 (dual uFF) rear']`.
    - `DL365 G11` — same fabricated array as DL360 G11 above. Its own
      QuickSpecs CTO table states outright "Rear Drive Cages: Not
      Available." Corrected to `[]`.
    - `DL360 G10+` — had DL360 G10's real `['1SFF rear','2x M.2 (dual
      uFF) rear']` carried forward without being re-checked at Gen10
      Plus. Its own QuickSpecs (a50002559enw) documents no rear/mid-tray
      cage at all for this chassis. Corrected to `[]`.
    - `DL365 G10+` — same carried-forward array. Its own QuickSpecs
      states "Rear Drive Cages: Not Available," same as DL365 G11.
      Corrected to `[]`.
    9 new regression tests cover the 3 fixes, 2 of the new combo
    chassis, and 2 of the NS204i-u G12 exceptions (354 total passing).
  - **Backplane type (`backplaneKind()`) — partially built, 2026-09-15
    (third pass this session).** The tool already had a generic,
    model-agnostic rule ("an LFF bay config never gets NVMe/Premium —
    only SFF does") which the sourced research confirms holds for the
    large majority of models checked (`DL360`/`DL380`/`DL385` across
    G10/G10+/G11, `DL320`/`DL325`/`DL345 G11`, `ML350 G10`/`G11`,
    `DL340`/`DL380 G12`, etc.) — left on that existing generic path
    rather than duplicated. Two clean, sourced, bay-INDEPENDENT
    absolutes are real overrides layered on top:
    `BACKPLANE_SAS_ONLY` (`DL20`/`DL160`/`DL180 G10`, `ML30`/`ML110 G10`,
    `DL20`/`ML30 G10+`, `ML30 G11` — no real hot-plug NVMe backplane
    exists at all, on any bay config; any "NVMe" mention in these docs
    is an M.2 boot device or UEFI feature) and `BACKPLANE_NVME_ONLY`
    (`DL380a G12` — zero occurrences of "SAS" or "SATA" anywhere in its
    own QuickSpecs). One narrow bay-specific hard case too:
    `BACKPLANE_EDSFF_NVME_ONLY=['DL360 G11']` — its 20EDSFF front config
    is explicitly "fixed NVMe-only." A new `#bp-note` surfaces the
    SAS-only/NVMe-only fact live; `evaluate()` hard-`stop`s the mismatch,
    same severity as the existing generic LFF check. 8 new regression
    tests (361 total passing).
    **Deliberately NOT built:** a full bay-by-bay Premium/Tri-Mode
    matrix for every model — several docs describe TWO distinct
    backplane families coexisting on the SAME bay count (e.g. `DL385
    G11`'s 8SFF: a plain SAS/SATA-only cage vs. a separate Tri-mode/
    mixed cage, a real trader choice) that the tool's single 3-way
    radio can't represent without a UI change; documented as a gap
    rather than guessed at. `DL20 G11` is confirmed to have gained a
    real NVMe option (2SFF Enablement Kit) despite `DL20 G10`/`G10+`
    being SAS-only — kept out of `BACKPLANE_SAS_ONLY` for that reason,
    same "key off the full model+gen string, not the model name alone"
    pattern already used for `flrKind()`.
  - **`DL120 G10`** stays fully UNVERIFIED for all 5 subsystems — no
    QuickSpecs source found (see the quickspecs-cache note above).
- **Capacity planner** — enter usable TB + RAID level, get up to 5
  drive-population suggestions ranked by least wasted capacity, with a
  one-click "Use" that drops the line into the drive list.
- **Repeatable lines** — drives, PCI cards and PCI risers are add/remove
  line lists. Each line's qty is a `stepper()`. On model pick the chassis'
  **default riser** (the `def:true` kit, or the generic primary) is
  pre-filled at 1x — switching models swaps it as long as the user hasn't
  put their own risers in (`curRiserDefaults` tracks the auto-added set).
- **"No drives" checkbox** (`#nodrives`) — hides the drive lines + planner
  wrapper (`#drives-wrap`), puts "No drives (ships diskless)" on the slip,
  and drops the `drives` / `drive bay config` gaps. `evaluate()` reads it as
  `noDrives` and treats the drive list as empty. Saved under `d.c` (the
  first checkbox in the sheet — save/load/clear now handle `input[type=checkbox]`).
- **Spec slip** — plain-text output on the right, copy-to-clipboard
  button, matches the shorthand format the traders already use
  (`2x S4110`, `8LFF + 2SFF`, etc.).
- **Shareable link + recent builds (2026-09-11).** `collectState()` /
  `applyState(d)` are the one state shape shared by three consumers:
  the localStorage draft (`save()`/`load()`), a `#s=<base64 JSON>` URL
  hash anyone can open to reopen this exact sheet (**Copy link** button
  next to Copy spec/Print), and a **Recent builds** list (`sbw-recent-v1`
  in localStorage, up to 10). `resetForm()` was pulled out of the old
  Clear-sheet handler so `applyState()` can reuse it — every restore
  starts from a clean baseline, not whatever was on screen before.
  Recent builds auto-snapshot on **Copy spec / Copy link / Print** (the
  natural "this is done, handing it off" moments) rather than a separate
  Save button; re-triggering the same build within 10 minutes updates
  the existing entry instead of piling up duplicates. On load, a `#s=`
  hash wins over the local draft, gets applied, snapshotted, and then
  `history.replaceState` strips it from the address bar (the *original*
  link, e.g. from an email, still works — this only tidies the tab going
  forward). **Gotcha for the QA harness:** jsdom disables `localStorage`
  for the default `about:blank` origin — the harness's `JSDOM(...)` call
  needs a real `url:` (`https://worksheet.test/` is fine) or every
  localStorage-backed feature silently no-ops and looks "fine" while
  testing nothing.
- **Picking a value implies a count** — selecting a CPU sets the processor
  count to 1 (min valid); selecting a PSU wattage sets the PSU qty to 1;
  selecting a system model sets "Builds" (`#modelq`) to 1 (both the UI pick
  and the paste parser's model match do this). All only fire when the
  count is still blank.
- **Generation quick-filter above the model picker** (`#model-gen-btns`,
  `renderModelGenBtns()`) — tapping "G10" etc. scopes `modelCombo`'s
  dropdown to just that generation (`modelGenFilter` closure var, read by
  `getGroups()`); tapping the active one again clears it. The button list
  itself is generation-aware of the Rack/Tower toggle (e.g. no tower ever
  shipped "G10+ v2", so that pill doesn't show under Tower) and re-renders
  from `sync()` whenever the chassis changes.
- **"Standard" defaults are shown, not omitted** — Backplane defaults to
  "SAS/SATA backplane", Motherboard to "Standard motherboard", Media bay
  to "No media bay", Bezel to "No bezel" — pre-checked radios with real
  (non-empty) values, so the slip always states these explicitly instead
  of going silent and needing a follow-up question to the trader.
  **TPM** is the exception: it is a 3-way choice (None / TPM 1.2 / TPM 2.0)
  and "None" carries an empty value, so it stays off the slip. A `flag`
  fires if TPM 1.2 is picked on Gen10+ (that generation is TPM 2.0 only).
  **iLO license** defaults to "iLO Standard (included)" for the same
  reason — every board ships it, so the slip states it rather than going
  quiet; Advanced / Advanced Premium are the paid pills next to it.
  Rails and FlexibleLOM/OCP are deliberately NOT defaulted to a positive
  value — those are consequential enough that silence should stay a
  visible gap. FlexibleLOM/OCP does get an explicit **"No" pill**
  (`#fl0`/`#fl1` on `name=flrfit`) so a trader can say "none fitted" and
  have that reach the slip instead of leaving the field blank and
  ambiguous between "forgot" and "genuinely none". The "HP authenticated
  memory" yes/no was removed outright (2026-09-11, not used by this team).
- **Build version badge under the `<h1>`** (`#build-ver`, filled from
  `BUILD_VERSION` near the top of the script) — a separate flex child of
  `.brand` (not inline text inside the `<h1>`, which threw off its
  centering) so it sits centered on its own line beneath the title.
  Went header → footer → back to under-the-title over three requests in
  one session; under-the-title is where it landed. Calendar-versioned
  (`vYYYY.MM.DD`); **plain `vYYYY.MM.DD` alone can't tell two same-day
  changes apart, so append `.n` (`.1`, `.2`…) whenever `BUILD_VERSION`
  already matches today's date** — this session shipped `2026.09.11` then
  `2026.09.11.1` for exactly that reason. **Bump it on every meaningful
  change** — it's manual, there's no build step to do it for you.
- **Rack/Tower gates the system model list.** `modelCombo.getGroups()`
  filters `MODELS` by `!!m.tower===isTower()`; `sync()` clears the picked
  model on a chassis switch if it no longer matches. Paste sets the
  chassis radio from the identified model, not the other way round.
- **Memory "reach a total" suggester** (`suggestMemoryConfigs()`) — type a
  target like `384GB`, get every DIMM qty×size combination from the
  standard HPE capacities (`DIMM_SIZES = [8,16,32,64,128,256]` GB) that
  divides evenly across the sockets in use (`cpuq`) and fits the DIMM
  slots actually available (`dimmq.max`). Click a suggestion to fill
  `dimmq`/`dimm` directly.
- **The battery field is manual, on purpose** — an earlier pass
  auto-filled it from the controller pick, but some traders build
  without a battery even on a RAID controller, so that was removed
  (2026-09-11). The paste parser's own "+ bat"/"battery" mention
  detection (below) is unrelated and still assumes 96W as a CHECK line.
- **Dropdown-driven qty defaults to 1** (`autoQty(row, keyAttr)`) —
  drive/card/riser line rows call this on their capacity/name field, so
  picking (or typing) a value with the qty still blank sets it to 1. Same
  idea as "picking a CPU/PSU implies a count", generalised to every
  repeatable line and to cards added by the paste parser.
- **Sticky right column on desktop** (2026-09-15, user request) —
  `.slip-wrap` (Spec slip + Config checks + the 3 action buttons) is
  `position:sticky;top:24px` so it stays visible while the longer left
  column scrolls past it. Reverts to `position:static` at the existing
  980px breakpoint that already collapses `.sheet` to 1 column —
  mobile/tablet is untouched. **Two non-obvious CSS traps had to be
  fixed together, not just adding `position:sticky` itself:**
  1. `body{overflow-x:hidden}` was silently breaking it. The CSS
     Overflow spec pairs `overflow-x`/`overflow-y`: if one is `visible`
     and the other isn't, the `visible` one computes to `auto` — so
     `overflow-x:hidden` was forcing `overflow-y:auto`, turning
     `<body>` into its own scroll container and breaking every
     `position:sticky` descendant on the page (they'd just scroll
     normally, as if `static`). Fixed by switching to `overflow-x:clip`,
     which is exempt from that pairing rule — same horizontal-overflow
     guard, `overflow-y` stays `visible`, sticky works. **Check this
     first if a future sticky element mysteriously doesn't stick.**
  2. `.sheet`'s grid had `align-items:start`, which shrinks a grid
     ITEM's own box to its content height instead of stretching it to
     the row height — a sticky child's containing block is that grid
     item, so if the item is only as tall as its content, the sticky
     child has no room to float in as the page scrolls. Removed
     `align-items:start` (default `stretch`) so `.col-slip` spans the
     full row height (matching the taller left column); `.slip-wrap`
     itself keeps its own natural short height and floats correctly
     within that taller box. `.col-form` (already the tallest column)
     looks identical either way.
  4 new QA regression tests check the CSS text directly, since jsdom
  can't do real layout/scroll testing.

## Verification status (as of this handoff)

**Fully verified against real QuickSpecs — the core ask ("all DL360 and
DL380 models verified") is met:**
- DL360: Gen9, Gen10, Gen10 Plus, Gen11
- DL380: Gen9, Gen10, Gen10 Plus, Gen11
- Gen12 for both now HAS real QuickSpecs (see the 2026-09-14 entry below) —
  structural rules are sourced, but neither carries `verified:true` yet;
  each has open caveats (bay-dependent fan counts, config-dependent
  heatsink tiers) noted rather than force-fit into the simple model.

**DL380 Gen11 CPU list audit (2026-09-14) — the "QuickSpecs verified"
badge was covering structural rules, not full CPU coverage.** User
manually checked the tool against the actual DL380 Gen11 QuickSpecs
(a50004307enw, SHI mirror) and found it was missing 36 real, orderable
Xeon Scalable SKUs — 7 4th Gen (Sapphire Rapids: G5411N, G5418N, G6418H,
G6458Q, B3408U, P8470N, P9462) and the ENTIRE 5th Gen (Emerald Rapids)
tier, 29 SKUs, which the tool didn't model at all. Also split the
combined `sp4` platform code into `sp4` (4th Gen only) and a new `sp5`
(5th Gen) — same treatment AMD's `genoa`/`turin` already got — since
the two generations have genuinely different memory grids (DDR5-4800
vs DDR5-5600) and it's what the user explicitly asked for ("split the
two generations of cpu in the drop down"). Fixed:
- `MEM_SPEEDS`/`MEM_CAPS`/`MEM_DDR`/`MEM_PER_SOCKET` gained an `sp5`
  entry: DDR5-5600, capacities 16/32/64/96/128GB (**no 256GB kit exists
  at 5600 MT/s** — the doc's 8TB/256GB headline max is 4th-Gen-only; a
  5th-Gen build tops out at 4TB on 2 sockets). `sp4`'s own speed list
  was corrected from `[4800,5600]` (a leftover from before the split
  existed, when one platform code had to carry both) down to just
  `[4800]`, since 5600 is now correctly sp5-only.
- 5th Gen's real memory-speed rule is tier-dependent (Platinum mostly
  5600, but V/U-suffix parts capped at 4800, Gold-6 at 5200, Gold-5 at
  4800, Silver/Bronze at 4400, two SKUs at 4000) — every real value is
  offered so nothing selectable is fabricated, but this is NOT enforced
  per-exact-SKU (documented as a known gap, same reasoning as other
  gaps below — the rule is finer-grained than anything else this tool
  models).
- `P8581V` (5th Gen) is single-socket-only despite a "V" suffix, not
  the usual "U" — Intel's "U" convention isn't the ONLY single-socket
  marker (`P8592V` is dual-socket, just memory-speed-capped, proving
  "V" alone isn't a rule). Added a small `SINGLE_SOCKET_EXTRA` array
  next to the existing regex-based "U"-suffix check for exceptions like
  this rather than hardcoding one more special case inline.
- `P8593Q` (5th Gen) is 385W — above every other Gen11 CPU's TDP and
  above the DL380 G11 rule's own 350W heatsink-bracket ceiling; needs
  the Max Performance heatsink or a DLC (liquid cooling) module, neither
  of which this tool's two-tier (Standard/Performance) heatsink model
  can select. Flagged as a model note rather than building a third
  heatsink tier for one SKU.
  Two more Speed-Select "Q" SKUs were also added (`G6458Q` 4th Gen,
  `G6558Q` 5th Gen) — already covered by the existing generic "Q suffix
  needs Max Performance heatsink" note, no new logic needed there.
- **Rolled out to the other Gen11 models the same day, once checked
  individually** (user reported "5th gen cpu's are missing from the
  G11 servers" after the DL380-only fix) — turned out genuinely
  per-model, not a blanket Gen11 rule:
  - **Confirmed YES, `sp5` added:** DL360 (same 29-SKU pool as DL380,
    verified SKU-for-SKU against its own QuickSpecs), ML350 (same pool
    minus 4 DLC-only parts — 8593Q/8562Y+/6544Y/6558Q — its tower can't
    cool, noted but not excluded from the picker), DL320 and ML110
    (1-socket boards, a smaller Silver/Gold-5/Bronze subset). DL320 and
    ML110 also each turned up one brand-new single-socket "U"-suffix
    SKU not previously seeded at all: `G5412U` (4th Gen, `sp4`) and
    `G5512U` (5th Gen, `sp5`) — both caught by the existing generic
    `/U$/` single-socket check automatically, no new logic needed.
  - **Confirmed NO:** DL110 (QuickSpecs still 4th-Gen-only) and DL560
    (doc frozen since Jan 2024, still 4th-Gen-only — and DL560's real
    CPU pool looks like it's mostly a distinct 4-socket-rated
    "H"-suffix subset rather than the general `sp4` list shared with
    2-socket boards; **open TODO, not fixed here** — this tool has no
    per-model CPU allow-list to restrict `sp4` down to just the
    confirmed 4-socket-valid SKUs for DL560 specifically).
  - **DL340 Gen11 doesn't exist as a real HPE product at all** —
    removed from `MODELS` entirely. HPE's DL340 line starts at Gen12
    (a new 2U single-socket Xeon 6 SKU); there was never a Gen11
    DL340 in any QuickSpecs or catalog. The old entry was a bare,
    never-verified `{m,g,p,s,d}` skeleton with zero rules — a genuine
    data-entry error, not a spec gap.
  - Found but NOT added: DL110 Gen11's own QuickSpecs lists 5 telco/
    vRAN "N"-suffix SKUs (Gold 5423N/6403N/6423N/6433N/6443N) this tool
    doesn't seed — web sourcing gave conflicting base-clock figures for
    6443N (1.90 vs 2.00GHz across sources), so left out rather than
    guessed. Someone with Intel ARK access or the raw QuickSpecs PDF in
    front of them could resolve this in five minutes.
- Noticed but NOT fixed (flagged rather than built, out of proportion
  to fix alongside this): 96GB DIMMs on 5th Gen need XCC/MCC-die CPUs
  and can't mix with other capacities (mixing isn't reachable in this
  tool's one-qty×size×speed-for-the-whole-system UI anyway); the
  tertiary riser (Slot 8) on 5th-Gen builds is PCIe 4.0 by default, not
  5.0 (this tool tracks slot COUNT only, not per-slot PCIe generation,
  a pre-existing whole-tool simplification, not new); the doc's
  Technical Specifications section mentions an "800W Universal
  (200-277VAC)" PSU option not repeated in its own ordering-section PSU
  list — worth a follow-up look at the tool's generic PSU list.

**Also verified this session:**
- DL120, DL160, DL180 Gen10 (share a heatsink SKU/threshold with
  DL360/DL380 Gen10 — confirmed)
- DL325 Gen10 (170W threshold; EPYC 7532 is a flagged exception —
  ships standard despite 200W, conflicting source data, worth a
  second look)
- DL385: Gen9(?)/Gen10/Gen10 Plus v1/Gen10 Plus v2 (**v1 and v2 have
  DIFFERENT thresholds** — 180W vs 155W — don't assume "Gen10 Plus" is
  one number)
- DL560, DL580 Gen10 (standard Gen10 rule; DL560 is limited to
  1/2/4 sockets, NOT 3 — `validCounts`)
- ML350 Gen10 (85W threshold), ML350 Gen11 (195W/300W)
- DL325 Gen11 / DL385 Gen11 (Genoa) — very different numbers from Intel
  Gen11 (320W liquid-cooling floor on DL325; 240W/300W tiers on DL385)

**DL325 Gen10 Plus threshold resolved (Sept 2026):** its own QuickSpecs
says **above 150W** ships the High Performance heatsink (155W parts take
it) — the old 180W figure borrowed from the DL385 was wrong. v1 and v2
both now `verified:true` at 150W; v2's QuickSpecs actually lists the HP
heatsink for *every* seeded SKU, so standard is the exception there.

**Gen9 heatsinks (Sept 2026, from the DL380 / DL560 / DL580 Gen9 QuickSpecs):**
- **DL360 / DL380 Gen9** — TDP **above 120W** takes the High Performance
  heatsink (135W and 145W parts), **except the E5-2690v4** (135W, keeps
  standard). A perf heatsink can also be fitted on a ≤120W CPU to cut fan
  power (795235-B21). A **double-wide GPU** needs the perf heatsink whatever
  the TDP — a standard-heatsink CPU uses the Graphics Enablement Kit
  (719082-B21). Added `hsStdException` + `hsGPU` to DL380 G9 (DL360 already
  had the exception).
- **DL560 / DL580 Gen9 and ML350 Gen9** — no standard-vs-performance choice;
  the heatsink is in the processor kit. `hsNoChoice:true` → the sheet stops
  recommending, auto-checks Std, posts one info line.

**Corrected data errors found along the way:**
- AMD per-socket memory ceilings were wrong (Rome was 4096GB, should be
  2048GB; Genoa was 6144GB, should be 3072GB) — fixed, and the memory
  check is meaningfully stricter now as a result.
- DL380 Gen9 was missing the `E5-2690v4` heatsink exception (it flagged that
  part as needing the perf heatsink — wrong per QuickSpecs).

**Verified in the Sept 2026 hardware-data pass (PSU bays / fan counts /
PCIe slot counts / riser positions, from each model's own QuickSpecs —
cooling thresholds separately noted per model):**
- DL560 Gen9 (**2 PSU bays** — 1200/1500W Common Slot, **6 hot-plug fans N+1**,
  3→7 PCIe, riserMax 3, **1/2/4 processors — not 3**) and DL580 Gen9 (**4 PSU
  bays** min 2, **4 hot-plug fans / eight rotors N+1**, 9 PCIe, 96 DIMM via 8
  cartridges, 2/3/4 processors, riserMax 1) — Sept 2026 fan + PSU pass against
  QuickSpecs DA-15187, both now `verified:true`. DL560 G9 `validCounts` was
  wrongly `[2,3,4]`, corrected to `[1,2,4]`.
- **DL560/DL580 Gen9 risers (QuickSpecs DA-15187):** DL560 G9 — standard
  3-slot primary (Proc 1), optional Secondary 3-Slot Riser Kit 793474-B21
  (slots 4-6, Proc 2), Slot 7 low-profile on the board (Proc 2); a 2-slot
  primary variant 793475-B21. DL580 G9 — one standard I/O riser carries all
  9 full-length/full-height slots (4x x8 + 5x x16); no secondary kits, slot
  availability gated by processor count (2P→5, 3P→7, 4P→9). Double-wide GPU
  slot map in the notes.
- **Gen9 v3/v4 CPU split:** `e5v34`→`e5v3`/`e5v4`, added `e5v3x4`/`e5v4x4`
  (E5-4600, DL560 G9) and `e7v3`/`e7v4` (E7, DL580 G9). ~90 Gen9 CPU rows.
  DL560 G9 no longer shows 2-socket E5-2600 parts.
- DL560 Gen10 (4 PSU, 6 fans, 3→8 PCIe, riserMax 3),
  DL580 Gen10 (4 PSU, 12 fans, 6→16 PCIe, riserMax 3)
- DL560 Gen11 (4 PSU, 6/5 HP fans air/liquid, 6 PCIe + 2 OCP, 150W
  heatsink step, 4P = liquid-cooling only) — now `verified:true`
- **Sept 2026 rear/bay pass on the 4-socket line:** DL560 Gen10 and
  DL580 Gen10 confirmed against QuickSpecs as SFF/NVMe front boxes only —
  no LFF, no rear or mid-tray cage. Given `bays` (SFF list) + `rear:[]`.
  Same `rear:[]` + SFF `bays` applied to DL560/DL580 Gen9 and DL560 Gen11
  from product data (dense 4-socket boxes never had LFF or rear cages).
- DL345 Gen11 (2 PSU, 6 fans, 6 PCIe, **12 DIMM** — was 24),
  DL365 Gen11 (2 PSU, 7 fans, ~3 PCIe, 240W cTDP fan/HS step),
  DL325 Gen11 (**12 DIMM** — was 24, 2 PCIe, riserMax 2) — all
  `verified:true`, replacing the old "likely follows DL325/385" guess
- DL160 / DL180 Gen10 (2 PSU, fan counts from their existing notes)

**G10 / G10+ hardware + cooling pass (Sept 2026) — now fully `verified:true`
with PSU / fan / PCIe / riser data from each model's own QuickSpecs:**
- **G10:** DL325 (5 fans, 170W HS step, riserMax 2), DL160, DL180,
  DL360, DL380, DL385, DL560, DL580 — plus DL20 (2 PSU bays, 2 PCIe,
  fixed non-hot-plug fans)
- **G10 Plus:** DL325 v1 (150W HS, 6/8 fans, riserMax 2),
  DL325 v2 (150W HS — HP heatsink for every seeded SKU, 8 fans),
  DL360, DL365 (155W HS+fan step, 5/7 fans), DL380,
  DL385 v1 (180W HS, 4/6 fans, riserMax 3, MaxPerf fan kit P14608-B21),
  DL385 v2 (155W HS, same chassis data)
- **G10+ tail finished:** DL345 G10+ (≥180W HS step P38655-B21, 6-fan cage,
  8SFF/8LFF ship with no fans, 2→4 PCIe), DL110 G10+ (Telco 1U — **DIMM
  count corrected 16 → 8**, 7 fixed fans, 3 PCIe + OCP, riserMax 2),
  DL20 G10+ (**now verified** — 4 UDIMM, 3 fixed non-hot-plug fans, 290W
  single or 500/800W RPS pair, 2 PCIe, riserMax 1)
- **Still partial:** DL120 G10 (cooling verified, hardware counts TBD) —
  its QuickSpecs PDF wouldn't download

**ML tower line (Sept 2026 pass, G10 first then G10+):**
- **ML30 Gen10, ML110 Gen10, ML30 Gen10 Plus** — `verified:true`. Single-socket
  entry towers: 2 fixed non-hot-plug fans (no kit choice), psuMax 2 (single ATX
  standard, Flex Slot pair needs an RPS kit). ML30 = 4 UDIMM / 4 PCIe; ML110 =
  6 DIMM / 5 PCIe.
- **ML350 Gen9 / Gen10 / Gen11** — Gen10 fully verified; Gen9 hardware verified
  (4 PSU bays, 3→5 fans + redundant fan kit 725878-B21, 9 PCIe, 24 DIMM), no
  heatsink step in the QuickSpecs so kept `unverified`; Gen11's slot map wasn't
  re-checked (assumed the same split-by-processor layout).
- **Risers + PSU part numbers pass (Sept 2026):** every ML G10/G10+ tower has
  its PCIe slots **on the system board — no riser cages** (`riserMax:0`); the
  ML350 slots split by processor (`pcie:{one:4,two:8}`, was wrongly `{8,8}`).
  Model-specific `psu` lists added: ML30 (350W Gold FIO P21652-B21 / Flex Slot
  865408 · 865438 + RPS P45209/P06305), ML110 (350·550W ATX + Flex Slot), ML350
  Gen10 (837074 · 865408 · 865414 · 865438 · 865428 · 830272-B21 + RPS cage
  874571-B21), ML350 Gen9 (Common Slot 720478 · 720479 · 720620-B21).
- **Still to do:** ML10 / ML30 / ML110 / ML150 Gen9, ML30 / ML110 Gen11;
  re-check the ML350 Gen11 slot map against its own QuickSpecs.
  (ML350 Gen12 done 2026-09-14 — see the Gen12 entry below.)

**Removed — HPE never made these:**
- DL580 Gen11 (the 4-socket line went DL580 Gen10 → DL580 Gen12)
- DL560 Gen10 Plus, DL580 Gen10 Plus (no Ice Lake 4-socket server)

**Still generation-default / cooling-unverified** (amber badge in the UI):
- DL20/60/80/120, DL110, DL320, DL340 across generations (Gen9/Gen10/
  Gen10+/Gen11 — the Gen12 models of the same names are a separate,
  now-sourced entry below, not to be confused with these)
- DL345/DL365 Gen10 Plus (Milan)
- ML110, ML30, ML150, ML10, ML350 Gen9
- All 8 Gen12 models — structural data is now sourced from real
  QuickSpecs (below), but none carry `verified:true` yet: several have
  bay- or config-dependent fan/heatsink rules that don't fit the simple
  threshold model cleanly and are left as notes instead of forced numbers.

**Gen12 (Intel Xeon 6) — sourced 2026-09-14.** HPE's Xeon 6 QuickSpecs
turned out to already exist (May 2025-dated docs) — this doc previously
said there was nothing to verify against yet; that was wrong, corrected
here. `CPUS` gained 31 `xeon6` entries (7 E-core + 24 P-core, including
the Socket-Scalable 4S/8S tier DL580 needs) sourced from the DL380/DL360/
DL580 QuickSpecs' processor **Core Options** tables specifically — the
"publicly supported" overview table above it in the same PDFs didn't
always agree with the orderable-SKU-with-part-number list, so the latter
was treated as authoritative. `MEM_PER_SOCKET.xeon6` was corrected from
8192 to 4096 — "up to 8TB" in the marketing copy is the 2-socket DL380's
TOTAL, i.e. 4096/socket at 16×256GB, not a per-socket figure.
- **DL360 G12** (`verified` pending): bays 4LFF/10SFF (+20×E3.S EDSFF, not
  modeled), `hsW:185`, `fans:{one:5,two:7,perf:7}`, `psuMax:2`,
  `riserMax:2`, `pcie:{one:2,two:3}`.
- **DL380 G12**: bays 8LFF/12LFF/8SFF/16SFF/24SFF (+36 EDSFF and a 12
  EDSFF+16SFF variant, not modeled), `hsW:185`, `psuMax:2`, `riserMax:3`,
  `pcie:{one:3,two:8}`. Fan count is actually tied to the BAY pick, not
  CPU count (4 for SFF/8LFF, 6 for 12LFF/EDSFF, 6 HP for 24SFF) — the
  `fans:{one:4,two:4,perf:6}` rule is a simplification, noted as such.
  Heatsink is a 4-tier system (185W standard / mid-tier / 225W
  High-Performance on Mid-Tray configs / Max-Performance 2P-only) —
  185W is recorded as the floor only, the rest is a note.
- **DL380a G12** (4U GPU server): fixed single 4SFF cage, not a bay menu
  — `bays:['4SFF']`. Fan count (4 dedicated assemblies) and heat sink
  data weren't sourced; flagged rather than guessed.
- **DL580 G12** (4-socket): bays 8/16/24/32SFF, `validCounts:[2,4]`
  (field-upgrade 2→4 sockets only — 1P and 3P aren't real configs),
  P-core only. Fan count and heat-sink threshold weren't sourced (no
  single clear number the way DL360/DL320/ML350 gave one) — flagged.
  `psuMax:2` reflects only the confirmed Flex Slot "1 min / 2 max" note;
  4-socket builds also list M-CRPS kits up to 3200W, unconfirmed count.
- **DL320 G12** (1-socket 1U): bays 8SFF/10SFF/4LFF/12LFF (+10SFF/20EDSFF
  and a GPU-server variant, not modeled), `hsW:185`, `fans:{one:7,
  perf:7}` (fixed 7-fan cage), **`psuMax:1`** — genuinely single-PSU,
  no redundant bay on this chassis. `riserMax:2`, `pcie:{one:2}`.
- **DL340 G12** (2-socket): bays 8SFF/12LFF (+36 EDSFF and a front-GPU
  variant, not modeled), `fans:{one:6,two:6,perf:6}` (fixed, reuses
  DL3X5 Gen11 fan kit part numbers), `psuMax:2`, `riserMax:2`,
  `pcie:{one:1,two:2}`. Heatsink threshold is config-dependent, not just
  wattage — 250W on plain SFF, but LFF/GPU/NEBS need the Performance
  heat sink at ANY wattage; `hsW:250` records the SFF-baseline case only.
- **ML350 G12** (2-socket tower): `hsW:225`, `fans:{one:3,two:3,perf:3}`
  (a 3-fan baseline that a 2nd CPU or a GPU can additionally require the
  Redundant Fan Kit + Second CPU Fan Kit for — not captured by the
  simple split), `psuMax:2`, `riserMax:2`, `pcie:{one:4,two:8}`. P-core
  only per its own QuickSpecs (unlike DL360/DL380, which also list
  E-core) — the shared `xeon6` platform still shows both on it, same
  "known gap" as every other platform here.
- **DL110 G12** — genuinely different from the rest: an edge/telecom box
  built around one **fixed SoC** (`6716P-B`, 40C/2.5GHz/235W) soldered to
  the board, not a socketed choice. Its own QuickSpecs would not
  download from any mirror tried, so ONLY the fixed-SoC fact is sourced
  (from Intel ARK / a SPEC.org result / an HPE newsroom post, cross-
  checked across those three) — no bay/PSU/fan/riser data. Flagged in
  its own notes rather than guessed; still an open TODO.
- **Storage controller generation compatibility is unsourced for all 8
  Gen12 models** (see the `CTRL_GENS`/`ctrlsFor()` entry in Architecture,
  above) — `CTRL_GENS` has no G12 entry at all, so `ctrlsFor()` falls back
  to the full unfiltered controller list for every Gen12 build rather than
  guessing which of the Gen11 MR/SR names (or a new Gen12-specific one)
  actually apply. `evaluate()` raises a `verify` note whenever a G12 build
  has a controller picked, so this doesn't silently look solved. Still an
  open TODO — Gen12's own QuickSpecs controller section wouldn't load
  during sourcing (repeated timeouts); secondary sourcing hints Gen12
  reuses the Gen11 MR/SR names plus a new MR932i-p, but that needs a
  primary-doc re-check before it goes into `CTRL_GENS`.
- **Removed a stale check**: a hardcoded `'No processors are seeded for
  Gen12 yet'` message fired unconditionally for every `xeon6` model —
  left over from before any SKUs existed. Now dead code was removed;
  the general-purpose `NO PROCESSORS SEEDED` check (added the same day,
  for ANY model on a platform with zero matching CPUs) covers this
  correctly and would still catch a future platform in the same state.

## Known limitations, stated plainly

### Data debt found by the 2026-09-14 audit (not guessed at — needs QuickSpecs)

A full cross-check of all 61 models — every model selected in turn, its
rendered UI compared against its own data, plus consistency checks across
the tables — came back clean on **rendering**: every model shows its own
sockets/DIMMs, CPU groups and count, bay list and buttons, rear list,
riser kits, PSU and DIMM caps, verified badge and notes. Nothing leaks
between models. What it did surface is data that is missing or inert:

- **8 Gen12 models were skeletons** (`DL110/DL320/DL340/DL360/DL380/
  DL380a/DL580/ML350 G12`): `{m,g,p,s,d}` and nothing else — no rules, and
  the `xeon6` platform had **zero seeded processors**, so the CPU picker
  was empty and (being pick-only) impossible to satisfy. **Fixed
  2026-09-14** — see the dedicated verification entry further down.
- **`fanBays` names bay configs some models don't offer** — DL160 G10
  (`12LFF`/`24SFF` vs its 4LFF/8SFF/10SFF), DL180 G10 (`24SFF`), DL360
  G10 (`12LFF`/`24SFF`), DL560/DL580 G10 (`12LFF`). Inherited from
  `GEN_DEFAULTS.G10`. The rule is dead on those models — which may mean a
  *missing* performance-fan rule for their own dense configs, so it needs
  checking per model rather than deleting.
- **`hsSku`'s Intel list is inherited by non-Intel G10 boards** (DL325/
  DL385 G10 on EPYC, DL20/ML30 G10 on Xeon E). Matching is by exact CPU
  code, so it's inert — never fires, never misfires.
- **`fans.two` on three 1-socket boards** (DL325 G10+, DL345 G10+/G11) —
  same value as `fans.one`, and unreachable since those models only offer
  one processor. Cosmetic.
- **52 of 61 models are missing at least one rule key.** The thinnest are
  the 8 Gen12 skeletons, then the Gen9 entry-level (DL20/60/80/120/160,
  ML10/30/110/150) and Gen11 entry-level (DL20/320/340, ML30/110) — which
  is exactly where the verification queue already points.

Round 10 of the QA harness now keeps the *consistency* half of that audit
permanent (duplicate models, unreadable bay strings, dead rear options,
`rear2SFF` naming bays a model lacks, riser kits needing a second CPU on a
one-socket board, riser positions exceeding `riserMax`, CPU table dupes /
odd TDPs / unknown platforms). The four classes above are deliberately
NOT asserted, because making them pass would mean inventing data.

### Longer-standing limitations

- Socket count (`s`) and DIMM slot count (`d`) for models I HAVEN'T
  explicitly verified come from general HPE product specs, not
  QuickSpecs read alongside the cooling data. They're very likely right
  for mainstream models but haven't been individually confirmed.
- The paste parser is best-effort text matching, not NLP. It won't
  resolve ambiguous controller suffixes (P408 could be i-a or i-p) — it
  guesses the common one and flags it as a CHECK item rather than
  silently picking.
- `riserMax` is set on the DL360/DL380 line plus DL560/DL580 Gen10,
  DL560 Gen11, DL325/DL345/DL365/**DL385** Gen11. Others still have no
  riser cap — not because it's unlimited, the number just isn't sourced yet.
- `psuMax` / `fans` / `pcie` cover the DL360/DL380/DL560/DL580 lines,
  DL325/DL345/DL365/**DL385** Gen11, DL160/DL180 Gen10 and ML350 Gen10/11.
  Everything else: PSU qty is uncapped (soft "not verified" prompt over 2),
  no fan auto-count, no card-slot check.
- All the Gen11 AMD/Intel 4-socket-and-under lines now have real
  `RISERS[...]` kit lists (DL385, DL560, DL325, DL345, DL365 — all done
  2026-09-11; DL580 has no Gen11). Remaining riser gap is the ML tower
  line and the entry-level DL family.
- DL365 Gen11's `riserMax` was corrected 2→3 in the same pass (its own
  QuickSpecs "GPU Riser 2" slot is a confirmed 3rd achievable position —
  `riserMax` had been under-counting it even though `pcie.two:3` already
  assumed it existed).
- The "fans not tied to CPU wattage" finding is specific to plain Gen9
  and Gen10 DL360/DL380 — don't assume it generalizes to every
  unverified model; it was confirmed by direct QuickSpecs text, not
  inferred.

## Priority order for continuing verification

Given refurb volume is likely rack-server-heavy: all the Gen11 rack lines
(DL385, DL560, DL325, DL345, DL365) are now fully covered — riser/fan/
bay/rear/PSU all filled, 2026-09-11.

**Gen12 turned out to already be real** (2026-09-14) — HPE published Xeon 6
QuickSpecs back in May 2025, contrary to what this doc said before. All 8
Gen12 models now have sourced structural rules and the `xeon6` CPU list is
seeded (31 SKUs) — see "Verification status" below for exactly what's
confirmed vs. still flagged per model (DL110 in particular: its QuickSpecs
wouldn't download from any mirror tried, so only its fixed-SoC note is
sourced, nothing structural).

**Done 2026-09-15** (three parallel background research agents,
riser/fan/PSU/bay-count axis — a separate axis from the media-bay/
TPM/motherboard/rear/backplane compatibility work covered earlier in
this doc): the ML tower Gen9 stragglers (ML10/30/110/150) and the
entry-level DL family — both Gen9 (DL20/60/80/120/160/180) and Gen11
(DL20/110/320) — all now `verified:true`. Notable findings: DL160 G9
has no 10SFF bay (unlike DL160 G10, which added one — a real
generational difference, guarded by a new regression test); DL80 G9
is the family outlier with 5 PCIe slots directly on the motherboard
and an optional (not mandatory) riser; DL120 G9 disables fan
redundancy above 105W CPUs; DL20 G11 has only 1 real PCIe slot despite
its own QuickSpecs' Risers section naming a 2nd kit (a copy-paste
artifact from the sibling DL320 G11 doc, not a real option). Full
citations in the `g10plus-verification-todo` memory.

**DL120 Gen10 remains the one open item on this axis** — confirmed a
real product (not fabricated, unlike the removed `DL340 G11`) via a
genuine support.hpe.com listing and a CE-declaration doc, but three
separate research passes (including a fresh, deliberately thorough
one 2026-09-15 trying guessed doc-ID neighbors, support.hpe.com, and
several mirror hosts) have still not found its actual QuickSpecs PDF —
see its own model note in `index.html` for the full list of dead ends,
so a future pass doesn't repeat them.

**Done 2026-09-15 (same day, extracted directly from already-cached
QuickSpecs, no fresh fetches needed):** ML30/ML110 Gen11 and ML350
Gen12 riser/fan/PSU/bay-counts. `ML350 G12` corrected two real
undercounts found while doing this: `riserMax` 2→3 (a Tertiary riser
position, CPU2-only, 2 slots @ x8, was missing entirely) and `pcie`
`{one:4,two:8}`→`{one:4,two:10}` (max slot count with all three risers
populated). `ML30 G11` has 4 PCIe slots directly on the system board/
PCH, no riser cage — plus a PCI Fan and Baffle Kit (P65106-B21) that's
REQUIRED (not optional) on its Hot Plug CTO configs. `ML110 G11` ships
2 PCIe 5.0 x16 slots standard, with 2 more unlockable via a pair of
sequential optional GPU riser kits (Slot 3's kit requires Slot 2's kit
first). All 3 now `verified:true`, all with a real `bays` list added
too (none had one before). This closes out the riser/fan/PSU/bay-count
verification axis for every model on the current priority queue —
only `DL120 Gen10`'s QuickSpecs remains genuinely unsourced.

**Bug found and fixed 2026-09-15 (user report): `DL360 G11` offered
"12LFF" as a front-bay-config option, which isn't real for that
chassis.** Root cause: `DL360 G11` had NO `bays` array at all despite
being `verified:true` — the front-bay-config picker falls back to
`GENERIC_BAYS` (`4LFF/8LFF/12LFF/2SFF/4SFF/8SFF/10SFF/16SFF/24SFF`)
whenever a model has no `bays` of its own, and the `BAY CONFIG` verify
check in `evaluate()` explicitly skips validation when `m.bays` is
empty — so an impossible bay pick raised zero warning. `verified:true`
was set for this model's cooling/riser/fan data in an earlier pass;
`bays` was simply never populated, so the badge was telling traders
"this is checked" while one whole field silently wasn't.
Fixed using facts already sourced this session (karenserver.com,
a50004306enw V38): real front-bay configs are `4LFF`/`8SFF` (a
20EDSFF variant exists too but isn't modeled, same "note it manually"
treatment as other EDSFF/GPU variants in this file).
**Auditing every other Gen11/Gen12 model for the same bug class**
(`verified:true` + no `bays` array) surfaced 3 more real instances,
all fixed the same way using already-sourced facts from this session's
research: `DL325 G11` (→ `4LFF`/`8SFF`), `DL345 G11` (→ `4LFF`/`8LFF`/
`8SFF`/`24SFF`), `ML350 G11` (→ `4LFF`/`8SFF`). 4 new regression tests
guard all 4 specifically (assert the generic-only `12LFF` option is
gone from each model's bay buttons).
**Full sweep completed 2026-09-15 (user follow-up: "check the other
ones so I don't keep asking to change single machine models").** Wrote
a one-off script to enumerate every `MODELS` entry and flag
`verified:true` + no `bays` array — found **14 more** beyond the 4
above, checked each against its own cached QuickSpecs, and fixed all
of them:
- `DL20 G10+` (→ `2LFF`/`4SFF`/`6SFF`), `DL325 G10+` (→ `4LFF`/`8LFF`/
  `12LFF`/`8SFF`/`16SFF`/`24SFF`), `DL325 G10+ v2` (→ `4LFF`/`8SFF`/
  `10SFF` — a smaller ceiling than v1, confirmed NOT the same list),
  `DL345 G10+` (→ `8LFF`/`12LFF`/`8SFF`/`24SFF` — no 4LFF option on
  this one, unlike its siblings), `DL385 G10+` and `v2` (→ `8LFF`/
  `12LFF`/`8SFF`/`16SFF`/`24SFF`, same list both versions).
- `DL20 G10` (not `verified:true`, but the data was already sourced
  from the G10+ pass — added anyway, → `2LFF`/`4SFF`/`6SFF`).
- `ML30 G10` (→ `4LFF`/`6LFF`/`8SFF`), `ML110 G10` (→ `4LFF`/`8LFF`/
  `8SFF`/`16SFF`), `ML350 G10` (→ `4LFF`/`8LFF`/`12LFF`/`8SFF`/
  `16SFF`/`24SFF`), `ML30 G10+` (→ `4LFF`/`8SFF` only — no LFF-expansion
  option found, unlike the G9/G10 ML30).
- `ML350 G12` — the one genuinely too complex for an exact list (3
  independently-configurable boxes, each 4LFF/8SFF/NVMe-x4/12EDSFF —
  real combos aren't representable as single strings). Added the 6
  same-type-only totals (`4LFF`/`8LFF`/`12LFF`/`8SFF`/`16SFF`/`24SFF`)
  so the common cases get real validation; a genuinely mixed build
  still correctly falls through to the existing soft `verify`, not a
  wrong hard block — this check has always been `verify` severity for
  exactly this "list might be incomplete" reason.
- **`DL110 G10+`/`G11`/`G12` needed a DIFFERENT fix**, not just a real
  list: all three are genuinely M.2-only chassis with NO front drive
  bay of any kind (VROC or a software-RAID SoC feature, confirmed
  directly for G10+/G11, inferred from a Data Sheet for G12 same as
  before). Setting `bays:[]` alone didn't block anything — the
  existing `BAY CONFIG` check only fires `if(m.bays&&m.bays.length)`,
  so an *empty* array was silently equivalent to *no* array. Added a
  new hard `stop` case mirroring `rear`'s own `!R.rear.length` pattern:
  `bays:[]` now blocks ANY front-bay value with `NO FRONT BAYS`, and
  `renderBaysBtns([])` naturally shows zero preset buttons (just
  "Other"), which is exactly right for a chassis with nothing valid to
  pick.
- Only `DL120 Gen10` still has no `bays` (and no verified:true) —
  genuinely unsourced across three research passes, unchanged.
6 new regression tests guard the `NO FRONT BAYS` stop, the empty
button list, and 4 of the newly-real bay lists.

**Bug found and fixed 2026-09-15 (user report): `sp3` (3rd Gen Xeon
Scalable, G10+) offered ONLY 3200 MT/s, but real QuickSpecs list lower
tier-capped speeds too.** Checked directly against DL110/DL360/DL380
G10+'s own QuickSpecs processor tables: Platinum and most Gold SKUs
run the full 8-channel 3200 MT/s, but several Gold SKUs (5320, 5318Y,
5317, and the N-suffix telco/NFV parts 6338N/6330N) and every Silver
SKU are capped at 2933 or 2667 MT/s — explicitly stated as "lower DDR4
speed may be used in segment optimized processors," a real CPU-tier
split, not just a DIMMs-per-channel derate. `MEM_SPEEDS.sp3` corrected
from `[3200]` to `[2667,2933,3200]`, same "list every real value,
don't enforce per-exact-SKU" treatment already used for `sp5`.
**Checked and confirmed NOT the same bug** on the AMD G10+ platforms
(`rome`/`milan`) the user's report could have also implicated — every
individual EPYC 7002/7003 SKU listed in DL325/DL325+v2 G10+'s own
QuickSpecs runs a flat 3200 MT/s with no CPU-tier split; the only real
derate found there is a genuine 2-DIMMs-per-channel one ("Rome
processors can't support 2 DIMM per channel @3200MT/s... support 2DPC
@2933MT/s"), which is the mechanism the original design comment above
correctly described — it just wrongly assumed `sp3` worked the same
way. 2 new regression tests guard both (`sp3` now offers all 3 speeds;
`rome` is confirmed to still correctly offer only 1).

**Fixed 2026-09-16: `DL560 G11`'s real CPU pool is a confirmed 9-SKU
subset of `sp4`, not the general list shared with 2-socket boards.**
This was an open TODO flagged during the 2026-09-14 Gen11 CPU-list
audit — DL560 G11 is 4-socket, and its own QuickSpecs looked like it
might validate only a distinct 4-socket-rated "H"-suffix subset rather
than every `sp4` SKU, but nothing had checked this directly and the
tool had no mechanism to enforce a per-model CPU allow-list even if it
had. Checked directly against the already-cached DL560 G11 QuickSpecs
(DA-17093) — its own "Step 2a: Choose Processors" section is exhaustive
and lists exactly 9 orderable SKUs: Platinum `8490H`/`8468H`/`8460H`/
`8450H`/`8444H` and Gold `6448H`/`6434H`/`6418H`/`6416H`. 4 of these
(`8468H`/`8460H`/`8450H`, and the "H"-suffix `6434H` — a distinct part
number from the plain 2-socket `6434` despite identical clock/core/TDP)
weren't seeded in this tool's `CPUS` list at all — added, each citing
the same doc. Built the general mechanism: a new `cpuAllow:[...]` rules
key, checked in both the CPU-combo picker (`getGroups`) and
`refreshDependents()`'s "valid" filter (narrows what's selectable to
just the model's own list, same idea as `validCounts` for CPU count),
plus a new `evaluate()` hard `stop` (mirrors the existing platform
mismatch check right above it) for a value that lands in the field some
other way (typed, pasted, restored). `DL560 G11` is the only model with
`cpuAllow` set so far — every other model keeps offering its full
platform pool, unchanged. 3 new regression tests guard the narrowed
9-SKU list, the `cpu-scope` note text, and the typed-value hard stop
(plus its converse: a real allow-listed SKU raises nothing).

The fastest path to more certainty: get the actual QuickSpecs PDFs from
your HPE engineer rather than relying on search-engine text extraction.
Search results are sometimes internally inconsistent (per-CPU notes can
get misaligned from OCR/scraping) — several fixes this session came from
noticing a contradiction in scraped text and treating it as "needs a
second source" rather than trusting it outright. A real PDF removes that
whole failure mode.

## Working conventions established this session

1. **Never ship without running the QA harness.** Syntax errors are
   silent and total — one bad bracket kills every dropdown, not just the
   thing you were editing.
2. **Don't fabricate QuickSpecs data.** If a threshold isn't confirmed,
   the model stays flagged UNVERIFIED rather than inheriting a plausible
   number with false confidence. When two sources disagree, say so in
   the notes rather than picking one silently.
3. **Hard-cap physical impossibilities (DIMM slots, riser count, drive
   bays); never hard-lock recommendations (fan/heatsink choice).** The
   difference: one is a fact, the other is guidance the trader might
   have a real reason to override.
4. **When adding a new rule key, update the schema comment block first**
   — it's the only documentation of what each key does and it drifts
   fast otherwise.
