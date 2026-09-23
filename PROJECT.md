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

**Started 2026-09-16: the "full bay-by-bay Premium/Tri-Mode backplane
matrix" this doc previously flagged as a deliberately-deferred gap.**
Went model-by-model through the already-cached Gen11 rack QuickSpecs
(the most fully-detailed docs available) checking every real front-SFF
cage/backplane kit each model's own doc lists, rather than relying on
the generic "LFF never gets NVMe/Premium, SFF always can" heuristic.
Findings:
- **`DL385 G11` is the one Gen11 rack model confirmed to still offer a
  genuine budget non-Tri-Mode SAS/SATA-only 8SFF cage as a SEPARATE SKU
  alongside its Tri-Mode ones** (x1 BC P55082-B21 / x4 P55083-B21, each
  needing its own SFF Backplane Power Cable Kit P57845-B21 + an OROC/
  PCIe cable kit) — a real trader choice (which cage, x1 vs x4, and the
  matching cable kit) this tool's single Backplane-type pill genuinely
  can't fully represent. Documented as a detailed note rather than
  invented as a new hard rule — this is the concrete case that
  originally justified deferring this axis.
- **`DL325`/`DL360`/`DL365`/`DL380`/`DL560` `G11` and `ML350 G11` all
  turned out to have NO plain non-Tri-Mode SFF cage at all** — every
  SFF backplane kit found in each doc is Tri-Mode-capable by default
  (it still runs plain SAS/SATA drives fine; there's just no cheaper
  non-Tri-Mode alternative SKU). This didn't need a new hard rule — the
  existing generic SFF-allows-NVMe/Premium path already covers it
  correctly — but is now documented per-model so a trader isn't
  surprised there's no "budget" cage option to order on these.
- **`ML110 G11` confirmed genuinely SAS-only and added to
  `BACKPLANE_SAS_ONLY`** — the one real NEW hard-rule fix this pass
  found. Its own QuickSpecs (a00054055enw) has zero Tri-Mode/U.3
  backplane mentions anywhere; every NVMe reference is the NS204i-u M.2
  boot device or CPU-attached Intel VROC, same "not a drive-bay
  backplane" pattern as the rest of that list. Picking NVMe or Premium
  on this model now hard-stops with `BACKPLANE MISMATCH`, same as the
  pre-existing entries in that list.
- **`DL320 G11`'s own doc internally contradicts itself**: its
  front-view diagram labels the 12LFF chassis plain "SAS/SATA drive
  bays," but a separate line elsewhere lists a "12LFF Tri-Mode Cable
  Kit" (P60892-B21). Given this project's prior history of pdftotext
  column-mangling and OCR artifacts on scraped mirrors, this was
  flagged as an unresolved doc inconsistency in the model's own notes
  rather than acted on either way — the generic LFF hard-block stays.
2 new regression tests guard the new `ML110 G11` sas-only hard stop
(NVMe blocked, SAS/SATA clean).

**Continued 2026-09-16, same day: G10/G10+ rack lines + `ML350 G10`.**
Went through the cached docs for `DL360`/`DL380`/`DL385`/`DL560`/
`DL580 G10`, `ML350 G10`, and `DL325`(v1/v2)/`DL345`/`DL360`/`DL365`/
`DL380`/`DL385`(v1/v2) `G10+` with the same method. The headline
difference from Gen11: most G10/G10+ boards checked (`DL360`/`DL380`/
`DL325`/`DL345`/`DL365 G10+`) still have a genuine 3-way split — a
plain SAS/SATA-only cage, a Tri-Mode/U.3 mixed cage, AND a pure NVMe/
U.2 cage, all separate real SKUs — where Gen11 mostly consolidated
down to Tri-Mode-only for the equivalent chassis. Specifics:
- **`DL385 G10+` v1 vs v2 is a genuine hardware difference, not a
  copy-paste risk**: v1 uses a single flexible "Smart Carrier" cage
  that mixes SAS/SATA/NVMe on one backplane (no separate plain or
  pure-NVMe SKU found); v2's own doc explicitly says it switched to
  "Basic Carrier" cages and regained the full 3-way split. Noted on
  both models so a future session doesn't assume they're interchangeable.
- **`ML350 G10`** has real NVMe (Box 2 only, all-NVMe via a dedicated
  Express Bay kit) but no mixed/Premium cage was found at all — the
  Premium pill isn't really modeled for this one, only SAS/SATA and
  NVMe are real.
- **`DL360 G10`**'s own doc names "10SFF" as its OWN distinct "Premium
  10SFF NVMe" CTO chassis type — not a plain-SAS/SATA-selectable
  option — and separately self-contradicts on whether reaching it via
  the field-upgrade kit needs 1 or 2 processors (the kit's own note
  says 2-only; this model's existing tool note says either). Flagged,
  not resolved — the existing note was left as-is since it may
  describe the factory CTO base config rather than the upgrade kit.
- `DL380`/`DL385`/`DL560`/`DL580 G10` all matched already-documented
  or generic-covered behavior — nothing new needed there.
None of this needed a new hard rule — every finding either fits the
existing pills already or is flagged as an unresolved doc contradiction
rather than guessed at, so no new regression tests this half (QA still
400/400 — verified nothing broke).

**Not yet re-checked at this depth:** the remaining Gen11/Gen12
entry-level and tower models — this axis stays open for a continuing
pass, same multi-session pattern as every other verification axis in
this file.

**2026-09-16, same day: G12 gaps closed (DL380a/DL580 fan+heatsink,
DL110 PSU/fan/riser/bay/OCP) — per the user's stated priority.**
- **`DL380a G12`** (already-cached QuickSpecs, a00047453enw V6): its
  own "Standard Features" and "HPE Cooling Options" sections state
  outright "4 hot plug fan assemblies" and no separate heatsink kit
  SKU exists at all (every CPU kit ships its own fixed heatsink) —
  fixed `fans:{one:4,two:4}` and `hsNoChoice:true` (same treatment as
  DL560/DL580 Gen9). Also found and fixed while in the same doc:
  `validCounts:[2]` — the doc states outright "only supports dual
  processor configurations, not single," previously unenforced so a
  1-CPU build could be quoted with zero warning. Set `verified:true`;
  the one remaining known gap (PCIe/riser slot count is genuinely
  config-dependent, 4 or 5 active slots by GPU/NIC fitment) is left
  unmodeled and flagged in its own note rather than guessed at.
- **`DL580 G12`** (same cached doc, a50009226enw V1): its base-config
  table states "Heat Sinks: HPE High Performance Heatsinks" and "Fans:
  4 performance fan kits" — both fixed, no Standard tier of either
  exists. Modeled the heatsink fact via `hsSku` (all 7 of this model's
  own confirmed CPU codes), not `hsW`, since there's no wattage
  threshold to key off and a `hsW`-based approach would wrongly default
  a low-wattage CPU to a "Standard" heatsink this chassis doesn't
  actually offer. Also found and fixed: `psuMax` was 2, but the doc
  states "2 processor configs: select min 1, max 2 PSUs" while "4
  processor configs: select either 2 or 4" — corrected to 4 (the true
  physical bay count) so a legitimate 4-PSU/4-CPU build isn't wrongly
  blocked; the CPU-count-dependent min/max itself isn't enforced (this
  tool's `psuMax` is a flat cap), flagged in the note. **Also found, not
  resolved:** the doc names a 48-core/2.5GHz/300W P-core SKU "6548P,"
  but the closest match already seeded in this tool's `CPUS` list under
  identical specs is "6748P" — flagged as an unresolved doc/tool
  discrepancy (possible OCR artifact on either side) rather than
  silently renamed either way.
- **`DL110 G12`** — the full QuickSpecs (a50009248enw) still won't load
  from any mirror tried, but the shorter cached HPE Data Sheet
  (PSN1014921967DEEN) — already used once before for the "no front bay"
  finding — turned out to have MORE useful data than previously mined
  from it: **"Memory slots: 4 DIMM slots"** (the model's `d:16` was
  wrong — never independently checked against this doc before now,
  corrected to 4); **"System fan features: 8 Hot-plug"** (fixed
  `fans:{one:8}`); **"Expansion slots: 2"** (fixed `pcie:{one:2}` —
  `riserMax` deliberately left unset since the doc explicitly defers
  slot topology/type to the full QuickSpecs); and **"Network
  controller: ... PCIe and OCP3.0"**, which confirms the OCP-slot-type
  default `flrKind()` was already guessing was in fact correct for this
  model. Still genuinely unsourced from this Data Sheet: PSU bay count/
  redundancy (only the PSU type — 1300W AC or 1000W -48VDC M-CRPS — is
  named) and full riser/slot topology; `verified` stays unset pending
  those, and the full QuickSpecs is still the real target for a future
  pass if a mirror or an HPE contact turns it up.
5 new regression tests (405 total) guard the DL380a/DL580/DL110 G12
fixes. Verified DL110's DIMM-count fix, DL580's PSU cap, and DL380a's
dual-processor-only button set live in the browser.

**2026-09-16, same day: backplane matrix continued into the remaining
entry-level/tower models.** Checked every cached Gen9 entry-level and
tower doc (`DL20`/`DL120`/`DL160`/`DL180`, `ML30`/`ML110`/`ML150`) plus
the remaining Gen12 entry/tower models (`DL320`/`DL340`, `ML350`).
- **7 more genuinely SAS-only models found and added to
  `BACKPLANE_SAS_ONLY`**: `DL20`/`DL120`/`DL160`/`DL180` and `ML30`/
  `ML110`/`ML150 G9` all have zero occurrences of "NVMe," "Tri-Mode" or
  "Premium" anywhere in their own QuickSpecs — Gen9 entry-level/tower
  predates NVMe hot-plug backplanes across the board, not just the
  handful already known at G10. (`DL60`/`DL80`/`ML10 G9` are LFF-only
  chassis with no SFF bay ever offered, so the same finding would be
  moot there — deliberately not added, to avoid an unreachable list
  entry.) 2 new regression tests guard a rack (`DL120 G9`) and a tower
  (`ML110 G9`) example.
- `DL320`/`DL340 G12` both turned out Tri-Mode-only for their SFF cage
  (no plain non-Tri-Mode option) — same pattern as most Gen11 rack
  models, documented as a note, no new hard rule needed.
- `ML350 G12` has a genuine "two families on one bay label" case, same
  as `DL385 G11`: its "8SFF" box is either a Tri-Mode-mixed cage
  (default) or a separate pure-NVMe-x4 cage — a real trader choice the
  tool's single bay-config string can't distinguish. Documented as a
  note rather than invented as a rule.
- `DL20 G11` confirmed to have real NVMe (up to 2 U.3 drives, but only
  via the 2SFF add-on kit) — not a `BACKPLANE_SAS_ONLY` case, just
  documented for completeness alongside the sibling `DL20 G10+`, which
  IS sas-only.
408/408 tests passing.

**Closed out the same day: `DL360`/`DL380 G12` and the Gen9 mainstream
rack line.** `DL360 G12`'s own doc has the same LFF/"TriMode" naming
ambiguity already flagged elsewhere (a "4 LFF Low Profile" bay named
"12G x1 TriMode U.3," but no LFF NVMe drive is ever sold and a separate
fan table lists "4LFF" apart from the NVMe-named SFF columns) — read as
controller-wiring compatibility, not real NVMe-capable LFF, generic
LFF block left in place. `DL380 G12` genuinely regained a 3-way split
its G11 predecessor lost — its own doc states outright "8SFF U.3 x4/x2
Trimode, 8SFF U.3 (x1 Trimode), and 8SFF SAS/SATA," the plain option
being the "Multipurpose Drive Cage Kit" (P76449-B21).

The four Gen9 mainstream rack models (`DL360`/`DL380`/`DL560`/
`DL580 G9`) had never had their QuickSpecs cached at all in this
project — fetched fresh via WebSearch + curl (dve-x.com for DL360/
DL380, newserverlife.com for DL560, theserverstore.com for DL580; doc
IDs and URLs recorded in `quickspecs-cache/MANIFEST.md`). All four
confirmed to have real NVMe at SFF, matching the generic rule already
in place. `DL380`/`DL560 G9` turned out to have only pure-NVMe
enablement kits, no mixed Premium cage; `DL360`/`DL580 G9` genuinely
do have a mixed SAS/SATA+NVMe option.

**This closes the backplane Premium/Tri-Mode cross-reference axis —
every model in this tool has now been checked.** No new hard rules
came out of this final batch (every finding either matched the generic
rule already, or was flagged as a doc ambiguity) — documentation-only,
no new regression tests needed; QA re-run to confirm no syntax
regressions (still 408/408).

The fastest path to more certainty: get the actual QuickSpecs PDFs from
your HPE engineer rather than relying on search-engine text extraction.
Search results are sometimes internally inconsistent (per-CPU notes can
get misaligned from OCR/scraping) — several fixes this session came from
noticing a contradiction in scraped text and treating it as "needs a
second source" rather than trusting it outright. A real PDF removes that
whole failure mode.

## PCIe slot count/width + riser-kit axis — started 2026-09-16

New axis, requested by the user right after the backplane cross-reference
closed out: get the number of PCIe slots, their width (full-height vs
low-profile), and the real riser-kit part numbers solid per model, not
just the aggregate `pcie:{one,two}` count already in place.

**The mechanism already existed** (`RISERS` map, per-kit `s`/`fh`/`lp`/
`pos`/`cpu2`/`def` fields, documented in the schema comment above
`GENERIC_RISERS`) but was only populated for **11 of ~60 models**
(mostly Gen9/G10 rack + the AMD Gen11 rack line) before this pass —
every other model fell back to `GENERIC_RISERS`, a made-up placeholder
list, not real per-model data. This is a bigger axis than the backplane
one: it needs a full per-kit table (slot count + FH/LP + part number),
not just a yes/no classification.

**First batch done — Intel Gen11/Gen12 rack (7 models, from already-
cached QuickSpecs):**
- `DL360 G11`/`G12`: Primary riser ships standard with 2 slots (Slot 1
  full-height x16, Slot 2 low-profile x16). Secondary (needs Proc 2)
  comes in two mutually-exclusive kits: the LP variant adds Slot 3 as
  LP and leaves Slot 2 usable (3 slots total: 1 FH + 2 LP, matching the
  model's own `pcie:{two:3}`); the FH variant adds Slot 3 as FH but
  DISABLES Slot 2 (net still 2 slots, both FH) — a real slot-for-slot
  tradeoff this tool's additive slot-count math can't fully capture,
  so it's spelled out in the kit's own description text instead of
  invented as new structural logic. G11 and G12 share the literal same
  LP secondary part number (P48903-B21, confirmed in the G12 doc's own
  text); only the FH secondary kit got a new G12 SKU (P72598-B21).
- `DL380 G11`/`G12`: every slot on every riser position/variant is
  full-height — no low-profile slots exist on this chassis at all.
  Primary/Secondary each default to a 3-slot x8/x16/x8 kit with an
  all-x16 upgrade kit (needing an extra cable kit to activate Slot 1/4).
  G11 and G12 reuse the literal same Primary/Secondary part numbers
  (P48802/P48803/P51083-B21); only Tertiary (2 slots, Proc 2) got new
  G12-specific SKUs (P76451/P74737-B21), same slot count as G11's.
- `DL320 G11`: 2 real riser POSITIONS (not variants) — Primary (Slot 1,
  ships standard) and Secondary (Slot 2, optional kit P52753-B21), both
  FHHL x16, no CPU2 gate (single-socket board).
- `DL320 G12`/`DL340 G12`: both single-socket, and both genuinely have
  **no stated factory-default riser** — their own docs say "select one
  or more" / "optional" with no default called out, unlike their G11
  counterpart (`DL320 G11`) or the G10-era convention — `def:true`
  correctly omitted rather than assumed from a sibling. `DL320 G12` also
  has a narrow third kit (P77555-B21) for the NS204i-t rear boot
  controller specifically, tied to one particular PSU — modeled with 0
  general-purpose card slots since that's what it actually is.
Skipped (same precedent as compliance-SKU handling elsewhere in this
file): NEBS-compliant and single-CPU-SKU-gated riser variants — same
slot counts as their standard counterparts, not worth a separate entry.

8 new regression tests (415 total) — one per model confirming the real
riser-kit panel replaces the generic placeholder list, plus the G11/G12
FH-vs-LP-tradeoff assertions. Verified DL340/DL380 G12's panels live in
the browser too.

**2026-09-17, continued: closed out the rest of Gen11/Gen12, started
G10/G10+ rack.**
- `DL20`/`DL110 G11` added (1 and 2 slots, both FH, single-socket).
- `ML110 G11` added — its 2 default PCIe slots are on the system board
  per its own doc ("Default Slots" vs "Optional GPU Riser Kit"), so
  only the 2 real GPU riser cages needed a `RISERS` line.
- **`ML350 G11` was a genuine DATA BUG, not just a gap fill**: it had
  been modeled `riserMax:0` ("PCIe on the system board like every
  ML350"), a claim its own note had self-flagged as "not re-checked
  against the Gen11 QuickSpecs." Checking it directly shows this was
  WRONG — it has 3 real riser positions, structurally identical to
  `ML350 G12` (confirmed: the G12 doc's own SKUs are literally named
  "ML350 Gen11/Gen12," shared part numbers). Corrected `riserMax` 0→3
  and `pcie` `{one:4,two:8}`→`{one:4,two:10}`; `ML350 G12` also got the
  same `RISERS` list.
- `DL580 G12` added — genuinely only ONE riser kit type exists for the
  whole chassis ("there is only one riser option," per its own doc),
  reused across up to 6 cage positions — modeled as one repeatable kit
  rather than per-position variants, `riserMax:6`.
- `DL380a G12` deliberately left unmodeled — its already-documented
  GPU-config-dependent slot count (4 or 5 depending on fitment) is too
  variable for this tool's flat per-line riser model to enforce
  correctly; a forced guess would be worse than the existing honest
  note.
- **Started G10/G10+ rack**: `DL360 G10+` confirms the same "1 FH + 1
  LP primary, secondary-FH-kit-disables-the-LP-slot" tradeoff already
  existed one generation before G11/G12 on this chassis lineage.
  `DL380 G10+` added too, but only PARTIALLY — its own doc has 3
  Primary and 3 Secondary riser TYPES (vs G11's 2 each) plus several
  0-slot NVMe SlimSAS variants; only the confirmed default + tertiary
  upgrade are modeled, since the Primary/Secondary 3x16 upgrade kits'
  exact part numbers weren't matched with full confidence to the doc's
  numbered table rows — left as a documented gap rather than guessed.
9 new regression tests (424 total). Verified ML350 G11's riser section
went from hidden to real live in the browser.

**Still on `GENERIC_RISERS`, needing real per-model data:** every
G9/G10/G10+ entry-level and tower model except `DL360 G10+`, the
remaining G10+ rack models (`DL325`/`DL345`/`DL365`/`DL385`), `DL380
G10+`'s Primary/Secondary upgrade kits, and `DL110 G12` (genuinely
unsourced — its Data Sheet defers slot topology to the full QuickSpecs,
which still won't load from any mirror tried).

**2026-09-17, continued: finished the G10+ AMD rack line.**
- `DL325 G10+`/`v2` added — single-socket, and structurally different
  from the DL360 family: only ONE riser assembly exists at all (no
  separate Primary/Secondary physical cages) — a default Slot 1 FH +
  Slot 2 LP, plus one Secondary slot as a standalone kit choice (LP
  keeps Slot 2 usable, FHHL disables it — same tradeoff *pattern*,
  different chassis).
- `DL345 G10+` added — single-socket, Primary and Secondary both
  default to 2 full-height slots each (coincidentally the same count
  either way, since there's no 2nd socket to change it).
- `DL365 G10+` added — confirmed it shares the exact same "DL36X Gen10
  Plus" part numbers as `DL360 G10+` (its 2-socket sibling).
- `DL385 G10+`/`v2` added, and **this surfaced a real error in the
  `DL380 G10+` entry written the previous batch**: neither Tertiary
  riser variant is actually a free default — both `DL380` and `DL385
  G10+`/`v2` need an explicit kit (x16 single-slot `P14588-B21`, or
  x8/x8 2-slot `P14581-B21`) *and* Proc 2 regardless of which is
  picked. The earlier batch had modeled one as `def:true` and gotten
  the two part numbers swapped relative to their real slot counts —
  caught and fixed in all three affected entries (`DL380`/`DL385`/
  `DL385 v2 G10+`) before committing.
6 new regression tests (430 total). Verified `DL385 G10+`'s corrected
riser panel live in the browser.

**2026-09-17, continued: finished G10 rack.**
- `DL20`/`DL160`/`DL180 G10` added. **`DL180 G10` had NO `pcie` or
  `riserMax` at all before this** — a real gap, not just a missing
  `RISERS` entry — now fixed to `pcie:{one:3,two:6}`/`riserMax:2`,
  sourced from its own doc's 4 riser kit options.
- `DL325 G10` added — same basic shape as its G10+ successor (single
  riser assembly, standalone LP secondary slot), one generation earlier.
- `DL385 G10` added, and this surfaced a real chassis difference from
  `DL380 G10` (which shares its "DL38X Gen10" riser kit family): `DL385
  G10` genuinely has a 3rd Tertiary riser position (Slots 7-8) that
  `DL380 G10`'s own entry doesn't have — `riserMax` corrected from unset
  to 3 to match. The exact Tertiary kit part number wasn't found in the
  cached doc, so it's described generically rather than guessed.
5 new regression tests (435 total). Verified `DL180 G10`'s 4-option
riser panel live in the browser.

**This closes out the entire G10 and G10+ rack lines** (Intel and AMD
both) for the riser axis — the only remaining rack gaps are `DL380`/
`DL385 G10+`'s Primary/Secondary 3x16 upgrade kits (unmatched part
numbers) and `DL110 G12` (genuinely unsourced).

**Still on `GENERIC_RISERS`, needing real per-model data:** every
G9/G10/G10+ entry-level and tower model — this is the bulk of what's
left.

**2026-09-17, continued: `DL360`/`DL380 G9` added — this closes out
EVERY rack generation (G9 through G12) for the riser axis.** `DL360
G9` confirms the "1 FH + 1 LP primary, secondary-FH-kit-disables-the-
LP-slot" tradeoff already existed at G9 too — now confirmed across all
4 generations (G9/G10+/G11/G12) on this one chassis lineage, a genuinely
durable HPE design pattern, not a one-off. `DL380 G9` added with its own
3-slot default plus 2 secondary variants. 2 new regression tests (437
total). Verified `DL360 G9`'s riser panel live in the browser.

**Rack is now fully done for this axis, every generation.** Everything
still open is entry-level and tower: every `DL20`/`DL60`/`DL80`/`DL120`/
`DL160`/`DL180`/`DL320`/`DL340` and `ML10`/`ML30`/`ML110`/`ML150`/`ML350`
across G9 through G12 (except the ones already confirmed riserMax:0 —
system-board PCIe, no riser cage at all — which don't need a `RISERS`
entry). This is going to take several more passes to close out fully,
same multi-session pattern as every other verification axis in this
file.

**2026-09-17, continued: user set priority — G10/G10+ is the current
bread-and-butter tier, G9 is "not so fussed about ... these days" (still
wanted on the page, just not the focus).** Closed the one remaining gap
in the G10/G10+ tier: `DL20 G10+` and `DL110 G10+` added to `RISERS`.
`DL110 G10+` is the same 2-slot Primary / 1-slot Secondary pattern as its
own G11 successor, one generation earlier — the Secondary kit has 2 SKUs
for the identical physical part (`P41828-B21` factory-integrated-only,
`P41827-B21` field-upgrade-only). `DL20 G10+` has a mandatory pick-one-
of-two riser choice: the LP FIO riser (`P46114-B21`, modeled as the
`def` since the doc's own Standard Features section describes it as the
built config) or a GPU riser (`P45433-B21` — 1 slot, physical x8
connector but only x4 electrical per the doc's own note, not assumed
x16). Also re-checked `ML30`/`ML110`/`ML350` at G10 and G10+: all already
correctly `riserMax:0` with "PCIe on the system board, no riser cage"
notes from an earlier session's pass — confirmed correct, no new work
needed there. 2 new regression tests (439 total). Verified both models'
`RISERS` data live in the browser.

**This closes the ENTIRE G10/G10+ tier — rack, entry-level, and tower —
for the PCIe slot/riser axis.** Checking what was actually left turned
up a pleasant surprise: **G11/G12 entry-level/tower and G9 towers were
already done** from earlier passes in this same session (or an earlier
one) — only G9 entry-level rack remained genuinely unmodeled.

**2026-09-17, continued once more: closed G9 entry-level rack** —
`DL20`/`DL60`/`DL80`/`DL120`/`DL160`/`DL180 G9`, the user's explicit
lower priority ("not so fussed on G9 these days") but the only real
remaining gap once everything above was checked. `DL60`/`DL120 G9`
share the literal "DL60/120 Gen9" riser part numbers (`765508`/`509`/
`510-B21`). `DL80 G9` is the true family outlier: 5 PCIe slots live
directly on the motherboard with no riser needed at all, and its riser
is genuinely *optional* (bonus slots on top) rather than mandatory like
every sibling — deliberately left `pcie`/`riserMax` unchanged since this
tool's flat one/two ceiling has no way to represent a 3rd "bonus tier";
noted instead of guessed. `DL180 G9`'s doc has a rear-panel diagram that
hints at a mirrored CPU2 riser cage (slots 1-3 primary / 4-6 secondary)
but an earlier pass had already checked this exact doc and concluded
slot count doesn't change 1P vs 2P — kept `riserMax:1` as-is rather than
override a considered prior call on internally inconsistent doc
evidence. `DL160 G9` confirmed the identical "mandatory CPU1 riser +
optional CPU2 riser" pattern already coded for `DL160 G10`.

**This closes out G9/G10/G10+/G11/G12 — every generation, every chassis
class (rack, entry-level, tower) — for the PCIe slot/riser axis.** 6 new
regression tests (445 total). Two non-blocking gaps remain: `DL380`/
`DL385 G10+`'s Primary/Secondary 3x16 upgrade kits (part numbers still
unmatched) and `DL110 G12` (genuinely unsourced — QuickSpecs won't load
from any mirror tried).

**2026-09-17, user-reported: Gen11 CPU tier order wrong, and Gen12
(Xeon 6) CPU pool needs E-core/P-core separation.** Two real, confirmed
bugs, both fixed:

1. **CPU tier ordering (`sp4`/`sp5`, Gen11).** A Bronze SKU added after
   the original seeding pass (`B3408U` on `sp4`, `B3508U` on `sp5`) had
   been appended right before Platinum instead of at the front — every
   other platform tag in this tool (`sp1`/`sp2`/`sp3`) follows strict
   Bronze→Silver→Gold→Platinum order, confirmed by a one-off Node script
   that walked the whole `CPUS` array checking tier rank per platform.
   Moved both to the front of their block.

2. **Gen12 (Xeon 6) CPU pool — a much bigger finding than expected.**
   Every one of the 8 G12 models shared the exact same flat 31-SKU
   `xeon6` list with zero `cpuAllow` restriction, despite two models'
   own notes already admitting a far narrower real pool (`DL110`: one
   fixed SoC; `DL580`: P-core only, matching its existing `hsSku` list)
   — neither restriction was actually enforced in the picker. Pulled
   every G12 model's own cached QuickSpecs "Core Options" section (the
   real orderable-SKU-with-part-number list, not the generic family
   overview table earlier in each doc) and built the true per-model
   pool:
   - `DL110`: 1 SKU (fixed SoC).
   - `DL320`/`DL340` (single-socket-capable boards): 28/29 SKUs — all 7
     E-core, all "standard" P-core, PLUS 6 single-socket-only "1P"
     variants (`6511P`/`6521P`/`6731P`/`6741P`/`6761P`/`6781P`) not
     previously seeded at all. `DL340` additionally offers `6745P`,
     which `DL320`'s own doc doesn't list — a real difference between
     two chassis that otherwise look identical.
   - `DL360` (fixed 2-socket): 22 SKUs — all E-core, the "standard"
     P-core set, but NONE of the 1P variants, no `6745P`, no Socket
     Scalable.
   - `DL380`: 30 SKUs — genuinely the widest pool. Confirmed (not
     assumed) that this 2-socket chassis' own Core Options list really
     does include all 7 Socket Scalable (4S/8S) SKUs, same part numbers
     as `DL580`'s pool (e.g. `6748P`/P74579-B21 on both).
   - `DL380a` (fixed dual-GPU chassis): 20 SKUs — missing `6731E` and
     `6505P` specifically (zero mentions anywhere in its own doc), the
     most restricted rack pool.
   - `DL580` (4-socket): 7 SKUs, exactly matching the existing `hsSku`
     list — Socket Scalable only, confirmed correct.
   - `ML350` (tower): 15 SKUs — a genuinely surprising finding, ZERO
     E-core SKUs anywhere in its own doc, unlike every rack model.
   Added `cpuAllow` to all 8 models with the real sourced list, seeded
   the 6 missing single-socket "1P" SKUs into `CPUS`, and upgraded the
   long-standing "6548P vs 6748P" doc discrepancy note from "unresolved"
   to "likely OCR noise" — `DL380`'s independently-sourced doc lists the
   identical spec/part number under `6748P`.
   11 new regression tests, 456/456 passing. Verified several models'
   real CPU pools live in the browser.

   **Found but deliberately NOT fixed this pass**: `ML350 G11`'s notes
   say 4 sp5 CPUs need DLC cooling this tower doesn't support, and were
   "not excluded... this tool doesn't have a per-model CPU-exclusion
   mechanism" — that claim is now WRONG (`cpuAllow` exists and is used
   everywhere above), but `cpuAllow` is an ALLOW-list; blocking just 4
   SKUs out of ML350 G11's full ~68-SKU sp4+sp5 pool would need a new
   DENY-list mechanism, which is a bigger change than this pass's scope.
   Note corrected to describe the real gap accurately; the exclusion
   itself is still open.

**2026-09-17, new axis started: real HPE part-number verification, "no
guessing, 100% verified" — this feeds real purchasing decisions.** User's
plan: one generation at a time (G10 → G10+ → G11), starting with
`DL360`/`DL380 G10` (the models actually traded most). Since both
already have cached QuickSpecs, did this pass directly rather than
spawning a research agent — faster and more reliable than a fresh
web search when the primary source is already on disk. Agents are the
plan for later models without a cached doc.

**Found a real dead-code bug before adding anything new**: a
per-model `psu:[...]` override (real kit names + part numbers) already
existed on 5 models (`ML150 G9`, `DL20 G9`, `ML110`/`ML350 G10`, `ML30
G10+`) but was NEVER wired to the picker — a stale schema comment
explicitly documented this as a deliberate simplification ("PSU picker
now shows plain wattages, not per-model kit strings"). Re-wired it
(`attachList` now checks `R.psu` first, falls back to the generic
`PSUS` wattage list) since the user's current ask supersedes that
earlier decision. This alone made 5 models' real PSU data visible for
the first time.

**Built the same override mechanism for storage controllers**
(`ctrl:[...]`, brand new — `CTRLS` previously had zero real HPE part
numbers anywhere, just family names like `P408i-a`). Every existing
generation/cache-type lookup (`CTRL_GENS`/`CACHED_CTRLS`/
`NOCACHE_CTRLS`/`CTRL_PORTS`) keyed off the controller value as an
exact match, which would have broken the moment a rich "P408i-a
(804331-B21)" string replaced the bare name — added `ctrlCode()` to
extract just the leading token, so those lookups keep working
unchanged.

**DL360/DL380 G10 real data added:**
- PSU: 6 real SKUs for `DL360` (500W/800W×4/1600W Platinum), 8 for
  `DL380` (same 6 + 1600W -48VDC + 1800-2200W Titanium, confirmed
  `DL360` doesn't offer either of those two).
- Storage controllers: `P816i-a`/`P408i-a`/`E208i-a`/`P408i-p`/
  `P408e-p`/`E208i-p`/`E208e-p` for both. `DL360` additionally has
  "LH" (low-height, low-profile-heatsink) variants of the 3 embedded
  cards for GPU builds — confirmed absent on `DL380` (more chassis
  clearance). `P824i-p` confirmed to exist for `DL380` (its own Cable
  Kit line names "DL38X/560/580/ML350," not `DL360`) but the
  controller's own part number never appears anywhere in the doc —
  flagged as confirmed-but-unsourced rather than guessed.

**Found 3 confirmed WRONG part numbers already sitting in the riser
data** (from an earlier, less rigorous pass) — exactly the risk the
user is worried about:
- `DL360 G10`'s "2P Full Height Riser & GPU Enablement Kit" used
  `867980-B21`, which the doc says is OBSOLETE — superseded by
  `P23271-B21` ("v2... replaces 867980-B21").
- `DL380 G10`'s "Primary Riser Removal FIO" used `875293-B21`, which
  is actually "Smart Memory Fast Fault Tolerance FIO Setting" — a
  completely unrelated memory RAS option. Real PN is `873766-B21`.
- `DL380 G10`'s "x16/x16/x16 Secondary GPU FIO Riser" used
  `826694-B21` — that's actually the PN for a different, plainer
  2-slot "x16/x16 Riser Kit." Real PN is `P14373-B21`.
Also removed a wrong/borrowed riser line on `DL360 G10` ("8SFF NVMe
Primary Riser") that doesn't match anything in its own doc — the "8
NVMe SlimSAS" concept it described is `DL380`-only, confirmed absent
from `DL360`'s doc entirely. Filled in 4 genuinely missing `DL380 G10`
riser part numbers (`826704`/`873732`/`867808`/`867806-B21`), removed
a duplicate riser line, and noted a real mandatory-pairing constraint
(the Primary and Secondary 3x16 GPU FIO kits must be ordered together).

Also fixed: `DL320`/`DL340`/`DL360`/`DL380 G12` were showing
"unverified" despite having sourced DIMM/socket/bays/pcie/riserMax/
cpuAllow data all traced to their own cached QuickSpecs — `verified:
true` was simply never set, an oversight from the original pass, not
a real gap. `DL110 G12` correctly stays unverified.

13 new regression tests (round 14), 473/473 passing. Verified live in
the browser: PSU/controller pickers now show the real data, and the
`ctrlCode()` fix keeps the battery-suggestion and generation-mismatch
checks working with the new rich strings.

**2026-09-17, continued — 4 user-reported items, checked one by one:**

1. **"QUICKSPECS VERIFIED" badge now links to that model's real HPE
   doc page.** Built `QS_DOCS` (keyed "MODEL GEN", same pattern as
   every other lookup map), pointing at `https://www.hpe.com/psnow/
   doc/<id>` — confirmed live that this URL always redirects to HPE's
   own canonical, currently-latest revision of that doc, not a frozen
   snapshot. Sourced every ID from `MANIFEST.md`, but verified each one
   by actually fetching it and checking the resolved page's `<title>`
   against the expected model+gen before trusting it — this caught 2
   real wrong IDs already in `MANIFEST.md` (`DL560 G10` had been
   recorded with `DL560 G11`'s ID; `DL20 G10`'s recorded ID 404s) and
   2 with a suffix format PSNow doesn't accept (`DL360`/`DL380`/
   `DL560`/`DL580 G9` had a `-NNNNN` mirror-reference suffix tacked on
   that isn't part of the real HPE doc ID). All corrected. `DL80 G9`
   had only an old pre-2016 "DA-15089" doc number on file, which
   doesn't resolve via this URL scheme at all — found and confirmed
   its modern doc ID (`c04447832`) via search instead. `DL120 G10` and
   `ML350 G9` have no findable doc at all (re-confirmed via a fresh
   search, not assumed from earlier sessions) — their badge correctly
   shows no link.

2. **Found a related pre-existing bug while doing this**: `DL120 G10`
   had `verified:true` set despite its own very next note saying
   "UNVERIFIED... no working mirror found across THREE separate
   research passes" — a genuine contradiction, invisible until the
   badge became a link with nothing to point to. Removed the stray
   flag.

3. **DL380 G10 memory speed (2933 MT/s) — confirmed CORRECT, not a
   bug.** Checked HPE's own live QuickSpecs directly: 2933 MT/s is a
   real, CPU-GENERATION-dependent speed — 2nd-Gen "Cascade Lake" Xeon
   Scalable (`sp2`) support it, 1st-Gen "Skylake" (`sp1`) tops out at
   2666 MT/s (matches Intel's own official spec). Tested the tool live
   both ways: picking a Cascade Lake CPU (Gold 6248) correctly offers
   2666/2933; picking a Skylake CPU (Gold 6130) correctly offers only
   2400/2666. If 2933 wasn't showing, the most likely explanation is a
   Skylake CPU was selected — that's the model behaving correctly, not
   a regression.

4. **Storage-controller group headers regression — confirmed real,
   fixed.** Building the new per-model `ctrl:[...]` override for
   `DL360`/`DL380 G10` replaced the generic grouped `CTRLS` list with a
   flat one, losing the "Type-a"/"PCI" group headers. Added the same
   `'— Group —'` header strings the generic list uses back into both
   override arrays.

5. **Raw "-001" spare/board part numbers instead of "-B21" orderable
   kit numbers — investigated, NOT implemented yet.** Confirmed the
   user's example is real (`836260-001` is genuinely the HPE spare
   part number for `P408i-a`, distinct from the `804331-B21` orderable
   kit number). These numbers don't appear in QuickSpecs PDFs at all —
   they live in a completely different HPE document type ("spare
   parts"/"Product Information Reference" pages), which this project
   has never sourced from before. This needs its own dedicated
   research pass, not a quick add — raised with the user rather than
   guessed at or half-implemented.

3 new regression tests (round 14 extended), 476/476 passing. Verified
all of the above live in the browser.

**2026-09-17, continued — 2 more user-reported items:**

1. **DL380 G11: an 8SFF U.3 x4 Mid Tray on an 8SFF front-bay build now
   alerts if neither the SR932i-p controller nor the factory-only
   32NVMe Balanced Bundle Kit (P53639-B21) is selected** — the user
   spotted this exact constraint directly in the model's own doc. New
   rule key `midtray8SFFCtrl` (reusable if another model turns out to
   need the same pattern) + a new soft `verify` check (can't be a hard
   `stop` since we have no way to detect "the bundle path was chosen"
   directly). Noted, not modeled: the bundle itself pulls in a long
   chain of other factory-only requirements (specific risers, both OCP
   x16 kits, a cable kit, 2nd CPU, the high-performance fan kit) — the
   check flags the top-level requirement and tells the trader to
   confirm the rest against QuickSpecs rather than trying to model the
   whole bundle's dependency chain.

2. **ML350 G9's QuickSpecs doc ID added to `QS_DOCS`** — the user
   linked `https://www.hpe.com/psnow/doc/c04346270` directly (matches
   what an earlier verification pass had already independently found
   and confirmed but never actually added to the lookup map — a real
   oversight). Doc is RETIRED/obsolete per HPE's own version history
   but still the genuine QuickSpecs. Important scope note: this is
   ONLY the doc-link entry — the model's field values (`psuMax`/
   `fans`/`pcie`/`riserMax`) haven't been freshly cross-checked
   against it, so `verified:true` stays unset. A full re-verification
   pass would need a different approach: this environment can't
   reliably pull text out of an hpe.com-hosted PDF (`curl` to hpe.com
   is fully network-blocked from Bash, and even fetching the PDF bytes
   through the browser's own network log returns an unrecoverable
   binary blob rather than usable text — tried both, neither worked).

2 new regression tests, 478/478 passing. Verified both live in the
browser.

**2026-09-17, continued once more — user downloaded and dropped in the
ML350 G9 QuickSpecs PDF this environment couldn't fetch on its own.**
Extracted with `pdftotext` (needed `-raw`, not `-layout` — the PSU and
controller tables were badly column-mangled under `-layout`, same
lesson as this project's other multi-column table fights) and did a
full re-verification, not just adding the doc link.

**Found 2 genuine data bugs, not just gaps:**
- `fans` was `{one:3,two:5}` — the real doc's own "System Fans" table
  says 2-CPU non-redundant is **4** fans, not 5, and there's a real
  redundant tier (6 fans 1P / 8 fans 2P) that had never been modeled
  at all. Corrected to `{one:3,two:4,perf:8}` (matched to the 2P
  figure, same convention used elsewhere in this tool for the
  not-separately-trackable 1P-redundant number).
- `pcie` was `{two:9}` with no `one:` value at all. The doc's own
  Expansion Slots table explicitly marks 4 of the 9 slots "For
  processor 1" and the other 5 "For processor 2" — confirmed `one:4`.

**PSU data turned out already correct, just mislabeled**: the 3
existing part numbers (720478/720479/720620-B21) all checked out
against the real doc (confirmed twice — once via a disambiguating
note, once via a clean `-raw` re-extraction) — only the NAME was
wrong ("Common Slot" is Gen8-era HPE terminology; this doc calls
every one of them "Flex Slot"). Added 3 more real PSU options not
previously listed (`-48VDC`/Titanium/Universal) and the field-
orderable X4 RPS kit part number alongside the existing FIO one.
Noted, not yet a hard check: the 500W PSU is explicitly NOT supported
with the RPS Enablement Kit needed for a 3-4 PSU build.

**Added a full `ctrl:[...]` controller list** with real part numbers
(B140i embedded, P440ar/H240ar "no PCIe slot" variants, P440/P840
plug-in cards, P441/P841/H241 external, each with FIO/field SKU
noted) — this model now matches the same rigor as `DL360`/`DL380 G10`
from the earlier part-number batch.

**Now `verified:true`.** 6 new regression tests (round 15), 483/483
passing. Verified all of the above live in the browser. Source PDF
deleted after extraction per this project's "text only, no raw PDFs"
convention; `.txt` kept in `quickspecs-cache/`, `MANIFEST.md` updated.

**2026-09-17, continued — rest of G10 rack: DL325/DL385/DL560/DL580.**
Same rigor as DL360/DL380 G10 from the earlier batch — real PSU +
storage-controller part numbers, sourced directly from each model's
own cached QuickSpecs.

- **DL325 G10** (1U, single-socket AMD): 7 real PSU options — a real
  constraint found: every Flex Slot (redundant) supply needs the
  Redundant PSU Enablement Kit (P04983-B21), only the 500W FIO
  non-redundant kit doesn't. Controllers are LH-only for every
  embedded card — no plain (non-LH) variant exists on this chassis at
  all, confirmed by their total absence from the doc (not just an
  oversight).
- **DL385 G10** (2U, 2-socket AMD): 6 real PSU options, no enablement
  kit needed. Controller PART NUMBERS were carried over from DL380
  G10's own doc rather than read directly here — this model's own
  cached doc is a router-switch.com reformatted "Data Sheet" that
  names the same 8 controllers but never itemizes their part numbers;
  trusted the family-sharing because the SAME document independently
  confirms literal "DL38X Gen10" shared-SKU riser parts.
- **DL560 G10** (4-socket): 5 real PSU options (no 500W tier exists at
  all on this chassis), LH-only embedded controllers. **Found a real
  cross-doc discrepancy**: DL380 G10's own doc names DL560 G10 as also
  offering the P824i-p controller (via a shared cable-kit line), but
  P824i-p never appears anywhere in DL560 G10's own QuickSpecs —
  trusted this model's own doc over the other's claim, left P824i-p
  out entirely rather than guessing which source was right.
- **DL580 G10** (4-8 socket): only 2 real PSU tiers exist (800W/1600W
  Platinum) — confirmed, not assumed to match its siblings. No
  embedded/LH controllers at all, only external/plug-in cards. **This
  is the model that actually resolved the P824i-p gap**: its own doc
  itemizes the real part number (870658-B21) directly, which was then
  backfilled into DL380/DL385 G10's entries (the shared-cable-kit
  note groups all of DL38X/DL560/DL580/ML350 as using the identical
  controller SKU — DL560 being the one confirmed exception).

8 new regression tests (round 16), 491/491 passing. Verified all four
live in the browser.

**2026-09-17, continued — ML110/ML350 G10 towers.** Continuing the
part-number project per the user's request, now closing out G10's
tower line too.

- **ML110 G10**: real 5-option controller list (S100i embedded SW
  RAID + 4 PCIe plug-in cards) — no "-a"/modular embedded RAID
  controller exists on this tower at all, and no P816i-a/P824i-p
  either. **Found a genuine gap in the original 2026-09-14 SAS
  expander research pass**: this model has its own real expander SKU
  (12G SAS Expander Card Kit, P11359-B21, to reach 16SFF with
  P408i-p) that was never added to `EXPANDER_PARTS` — silently fell
  through to "no expander exists" before. Added.
- **ML350 G10**: real 8-option controller list, and — unlike DL325/
  DL560 G10's LH-only pattern — every "-a" modular variant here is
  the PLAIN (non-LH) part number. **P824i-p's part number (870658-B21)
  is directly confirmed in THIS model's own doc too**, exactly
  matching what was found on DL580 G10 last batch — strongly
  confirms the "shared DL38X/560/580/ML350 SKU" reasoning already
  used to backfill DL380/DL385 G10's entries wasn't a guess.

3 new regression tests (round 17), 494/494 passing. Verified all of
the above live in the browser, including the new expander suggestion.

**This closes out G10 rack + towers for the part-number axis.**
Remaining for G10: entry-level (`DL20`/`DL160`/`DL180`) only. Then
move to G10+.

**2026-09-18: DL20/DL160/DL180 G10 — closes out ALL of G10 for the
part-number project.** Same rigor as the rest of the generation.

- **DL20 G10**: 4 real PSU options — the base 290W tier has 2 SKUs,
  one confirmed OBSOLETE by the doc's own note ("unavailable in order
  system after 16 Feb 2020"); flagged as such rather than silently
  offered alongside the current replacement. LH-only embedded
  controllers (no P816i-a/P824i-p at all — smallest 1U chassis).
  **Also fixed a stale-verification gap**: this model had NO
  `verified:true` at all despite its DIMM count already being sourced
  against the same doc in an earlier note — added the flag.
- **DL160 G10**: 6 real PSU options, all needing the SAME "DL160/180
  Gen10" shared Redundant PSU Enablement Kit (866442-B21) — confirmed
  shared by name in the doc, not assumed. LH-only controllers, no
  P816i-a.
- **DL180 G10**: 7 real PSU options (shares the identical enablement
  kit + PSU list as DL160, plus a 1600W tier DL160 lacks). **Real
  chassis difference found**: controllers here are the PLAIN (non-LH)
  modular variants, including P816i-a (16-lane) which none of
  DL20/DL160/DL325/DL560 G10's LH-only siblings offer at all — this
  larger 2U chassis has room for the taller cards.

7 new regression tests (round 18), 501/501 passing. Verified all
three live in the browser, including the corrected verified badge.

**G10 is now fully done for the part-number axis — every rack,
tower, and entry-level model.** Moving to G10+ next, starting with
DL360/DL380 per the user's stated priority.

**2026-09-18, continued: DL360/DL380 G10+ — starts the part-number
project's move into G10+.** Two real findings that would have been
easy to get wrong by assuming G10 data carried forward:

- **A genuine PSU part-number REVISION at Gen10 Plus**: the 800W and
  1600W Platinum tiers got NEW HPE part numbers (P38995-B21,
  P38997-B21) — confirmed by direct search that the "old" G10 codes
  (865414-B21, 830272-B21) have ZERO mentions in either model's own
  doc. Everything else (Titanium/-48VDC/Universal) kept its G10 code.
- **3 controller codes were missing from the shared `CTRLS` list
  entirely**: `MR216i-a`/`MR416i-a` (embedded Tri-Mode MegaRAID) and
  `SR416i-a` (Microchip SmartRAID, same "-a" family) — both models'
  own docs list them right alongside the already-known `-p` PCIe
  siblings. Added to `CTRLS`/`CACHED_CTRLS`/`NOCACHE_CTRLS`/
  `CTRL_PORTS`/`CTRL_GENS` at the shared level (benefits every model
  that falls back to the generic list, not just these two), scoped to
  G10+ only since that's what's actually confirmed.

Per-model: `DL360 G10+` offers BOTH plain and "LH" (low-profile
heatsink) variants of every embedded controller — matches its
existing note about accelerators needing the LH variant. `DL380 G10+`
offers PLAIN-only (no LH at all) and has NO 500W PSU tier whatsoever
(confirmed absent) — both real chassis differences from DL360 G10+,
same "smaller chassis needs LH, bigger one doesn't" pattern already
seen at plain G10.

5 new regression tests (round 19), 506/506 passing. Verified all of
the above live in the browser, including that the new shared
controller codes stay properly scoped to G10+ and don't leak into
G11.

**2026-09-18, continued: `DL325`/`DL345`/`DL365`/`DL385 G10+` (and
`DL325`/`DL385`'s v2 variants) — 6 MODELS entries in one batch.** The
biggest finding here: the "Gen10 Plus PSU part-number revision" found
on DL360/DL380 is NOT universal across every G10+ chassis — it's a
timing thing, not a chassis thing.

- **`DL325 G10+` (v1, Rome) and `DL385 G10+` (v1, Rome)** are on the
  EARLY doc family (`a00073548enw`/`a00073549enw`, V16-18,
  2021/2022) — confirmed by direct search that their own docs
  genuinely predate the revision: still the OLD 865414-B21/
  830272-B21 codes for 800W/1600W Platinum, and NO Tri-Mode "-a"/"-p"
  family (`MR216i-a`/`MR416i-a`/`SR416i-a`/etc.) exists in either doc
  at all — not omitted, genuinely absent from that generation of
  board.
- **`DL325 G10+ v2`, `DL385 G10+ v2`, `DL345 G10+`, `DL365 G10+`** are
  all on the newer doc family (`a5000255x`) — all four carry the
  P38995-B21/P38997-B21 revision AND the full Tri-Mode "-a"/"-p"
  family. `DL345`/`DL365 G10+` also add a 7th PSU tier neither DL325
  variant has: 1600W Flex Slot -48VDC (P17023-B21, needs the Power
  Cable Lug Kit P36877-B21). `DL385 G10+ v2`'s own doc offers a choice
  of TWO alternative accessory kits for that same PSU (P36877-B21 OR
  P22173-B21) — read carefully since at first glance the doc looks
  self-contradictory (two different lug-kit PNs for the same PSU in
  two different sections), but it's actually just "pick either one."
- **LH-vs-plain embedded-controller split, confirmed independently
  per model rather than assumed from chassis size:** `DL325 G10+`
  (both v1 and v2) and `DL365 G10+` are LH-only. `DL345 G10+` and
  `DL385 G10+` (both v1 and v2) are PLAIN-only. Notably this means
  `DL325`/`DL385` do NOT follow the same LH-or-plain answer across
  their v1→v2 revisions (each stays consistent with itself), but
  `DL325` and `DL385` land on OPPOSITE answers from each other despite
  being adjacent chassis in the same family — worth remembering this
  axis needs a per-model check every time, size/socket-count alone
  doesn't predict it. One doc-internal gotcha caught along the way:
  `DL345 G10+`'s own summary bullet says "LH" for its embedded
  controllers, but its own detail table (the one with real part
  numbers) gives the plain codes — trusted the detail table, which is
  consistent with the pattern already established for other models.
- **One unsourced gap flagged, not guessed**: `DL325 G10+ v2`'s doc
  lists a "HPE 1600W 48VDC Power Supply Kit" as an available Standard
  Features bullet but never gives it a part number anywhere in the
  document — left OUT of `psu:[]` rather than invented; every other
  option in that list has a confirmed B21 code.

7 new regression tests (round 20), 518/518 passing. Fixed the
round-14 no-override fallback test, which had drifted onto `ML30
G10+` — turns out that model already had a real `psu:[]` (one of the
5 pre-existing overrides from before this axis started) — swapped to
`DL110 G10+`, confirmed still override-free. Verified all 6
models/variants live in the browser.

**G10+ so far: `DL360`/`DL380`/`DL325`(v1+v2)/`DL345`/`DL365`/
`DL385`(v1+v2) done.** Remaining for G10+: entry-level `DL20`/`DL110`,
tower `ML30`. Then G11.

**2026-09-18, continued: `DL20`/`DL110`/`ML30 G10+` — closes out ALL
of G10+.** Two genuinely extreme edge cases surfaced, both handled by
documenting the real hardware truth rather than forcing generic
picker data onto a chassis that doesn't support it:

- **`DL110 G10+` has exactly ONE real PSU option** (700W Flex Slot
  -48VDC, P43150-B21) — this Telco chassis is DC-only, no AC/Platinum
  tier exists at all, confirmed by the doc's own "Choose Power
  Supplies" step listing nothing else. It ALSO has **NO Smart Array
  controller of any kind** — no "-a", no "-p", no Tri-Mode — storage
  is Intel VROC software RAID direct to the CPU (a licensing feature,
  not a card), so `ctrl:[]` got a single informational entry with no
  part number instead of a fabricated one, same spirit as the
  existing `S100i` (embedded SW RAID) entries elsewhere in the tool.
- **`DL20 G10+`**: LH-only embedded controllers + the full Tri-Mode
  "-a"/"-p" family, but genuinely NO internal PCIe plug-in option
  (no `P408i-p`/`E208i-p`) and no `SR932i-p` (too large for this
  chassis) — only the external "-e-p" PCIe variants exist. Also found
  that the 290W FIO PSU variant and its RPS Enablement Kit are both
  FIO-only (factory-integrated, cannot be added or ordered standalone
  after the server ships) — flagged since that matters to a refurb
  trader who can't retrofit either one.
- **`ML30 G10+`**: its `psu:[]` was already correct (one of the 5
  pre-existing overrides from before this axis started, confirmed
  unchanged). Added `ctrl:[]` fresh — PCI plug-in only, no embedded
  "-a" or Tri-Mode-a controller exists on this tower at all, same
  "no modular option on a tower" pattern already found on ML110 G10.

7 new regression tests (round 21), 524/524 passing. Fixed the
round-14 no-override fallback test again — it had drifted onto
`DL110 G10+`, which now has a real override — swapped to `DL60 G9`
(low priority per the user's stated order, so unlikely to churn
again soon). Verified all 3 models live in the browser, including
that the single-PSU/no-controller edge cases render cleanly rather
than breaking the picker.

**G10+ is now 100% done for the part-number axis.** Moving to G11
next, starting with DL360/DL380 per the established priority order.

## FlexibleLOM/OCP label + real per-model card catalogs — 2026-09-18

Two related user reports: (1) the "FlexibleLOM / OCP" field label never
changed even though `flrKind()` already knew which one actually applied
per model, and (2) a request to double-check the FLR (G10) and OCP
(G10+) card catalogs are genuinely compatible per model, not just a
generic list shown everywhere.

**Label fix**: the field's `<span>`/`<legend>`/placeholder now read
"FlexibleLOM", "OCP 3.0", or the generic "FlexibleLOM / OCP" (only when
`flrKind()` is `'none'` — neither slot exists) via a new `flrLabel(m)`
helper. The spec slip's own "No ___ fitted" line and its gap-list text
use the same dynamic label (`buildSlip()`).

**Compatibility re-check — real finding: neither catalog is "mostly one
shared list" the way the 2026-09-14 OCP pass assumed.** Checked every
cached G10 rack model's own "FlexibleLOM Adapters" section and every
G10+ model's own "OCP Adapters" section directly, building real
per-model `flr:[...]` overrides (same override pattern as `psu`/`ctrl`)
for 18 models total:

- **G10 (9 models: `DL20`/`DL160`/`DL180`/`DL325`/`DL360`/`DL380`/
  `DL560`/`DL580`)**: real catalogs range from 6 cards (`DL20`) to 12
  (`DL360`, the richest — also the only one with a confirmed FlexibleLOM
  InfiniBand card, `547FLR-QSFP`). `DL380` is the narrowest mainstream
  rack (9 cards) and uniquely offers a Pensando DSP smart-NIC option no
  other G10 model has. `DL560`/`DL580` — same 4-socket generation — are
  NOT identical: `DL560` lacks every 25Gb tier `DL580` has. A first pass
  at `DL160`/`DL180` via simple string-grepping wrongly concluded they
  only had ONE card each — re-reading the actual contiguous doc section
  caught this before it shipped; both actually get 10-11 cards using
  chip-based naming (`FLR-T BCM5719` etc.) instead of the old shorthand
  (`331FLR` etc.) their sibling docs use for the identical PN. Building
  a canonical shorthand↔chip-name↔PN table resolved the long-standing
  "old vs new FlexibleLOM naming" tension flagged as blocking back on
  2026-09-14.
- **3 G10 towers have NO FlexibleLOM slot at all**: `ML30`/`ML110`/
  `ML350 G10` — confirmed zero "FlexibleLOM" mentions in any of their
  docs, just a fixed embedded LOM chip + optional plain PCIe standup
  card. `flrKind()`'s `FLR_NONE` exception list (previously G10+/G11
  only) now checks before the G9/G10 shortcut, so these three apply
  regardless of generation.
- **`DL385 G10`/`DL120 G10`** deliberately left on the generic
  fallback rather than guessed — `DL385`'s only mirror is a reformatted
  datasheet with no clean orderable-PN table, `DL120` has no cached doc
  at all (unchanged from the earlier part-number pass).
- **G10+ (9 models: `DL110`/`DL325`v1+v2/`DL345`/`DL360`/`DL365`/
  `DL380`/`DL385`v1+v2)**: `DL110` (Telco) offers only 2 of the shared
  list's ~18 SKUs. AMD (`DL325`/`DL345`/`DL365`/`DL385`) and Intel
  (`DL360`/`DL380`) boards each differ from each other in E810/BCM5719/
  InfiniBand availability — `DL325 G10+ v1` lacks BCM5719, E810, AND any
  OCP3-form InfiniBand entirely; v2 gains all three. `DL365` is the one
  Intel-adjacent-family board with NO real OCP3 InfiniBand card despite
  otherwise matching `DL345`'s pattern (PCIe-standup InfiniBand only,
  a different product for the "PCI cards" field).
- **2 real bugs found and fixed in the pre-existing shared `OCP_CARDS`
  list itself** (wrong on every G10+ model checked, not model-specific):
  `BCM57412`/`BCM57416`'s part numbers were SWAPPED. `QL41132HQCU`/
  `QL41132HQRJ` were mislabeled "10/25Gb" — they're 10Gb-only; the real
  10/25Gb Marvell part is the visually-similar `QL41232HQCU` (one digit
  different), already listed separately. Also fixed: `I350-T4` had no
  part number at all; the two InfiniBand entries were mislabeled
  "HDR100/Eth 200Gb" (HDR100 is HPE's name for a DIFFERENT, 100Gb-class
  product with its own PN) instead of plain "HDR/Eth 200Gb".
- **The shared `FLRS` fallback** (used by G9 + the 2 unconfirmed G10
  models) had 2 real data errors removed: `361i` is an embedded LOM
  chip name, not a removable FlexibleLOM card, confirmed via multiple
  G9 docs — never had a B21 kit number. `530FLR-SFP+` had zero hits in
  ~20 G9/G10 docs checked — likely a typo for the real `534FLR-SFP+`,
  dropped rather than guessed. `561FLR-T` confirmed G9-only (present in
  every G9 doc, absent from every G10 doc) — kept for G9's sake with an
  explicit note, since removing it would regress a real G9 option.

25 new regression tests (round 23), 544/544 passing. Caught 2 real
implementation bugs while adding this: a `rulesFor is not defined`
runtime error from calling it outside the IIFE scope where it's
actually defined (same mistake `psu`/`ctrl` avoid by checking the
override at their `attachList` call site, not inside the shared
fallback function) — this one broke 138 unrelated tests via cascading
stale DOM state before being caught and fixed; and a forgotten `flr:[]`
override on `DL20 G10` that was sourced but never actually written into
the model's rules object. Verified label switching and per-model card
filtering live in the browser for both a FlexibleLOM model and an
OCP-only model.

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

## "Finalize as many G10/G10+ options as possible" — started 2026-09-18

User asked, with weekly usage running low, to push every axis (CPU,
heatsinks, fans, memory, controllers, risers, FlexibleLOM/OCP, PSU +
count) as far as possible for G10/G10+, plus as many "-001" spare
part numbers as can be pulled from QuickSpecs specifically.

**"-001" spares: checked thoroughly, genuinely almost nothing there.**
Grepped every cached G10/G10+ doc for `-001`. Every hit was one of:
the same generic rack-installation-tool part (`695539-001`) repeated
across unrelated models; a handful of internal CABLE part numbers
(already captured in existing notes for `DL20`/`DL365`/`DL385 G10+`);
or whole-system pre-configured SKU numbers (`ML110`/`ML30` G10(+)),
not component spares. Confirms the earlier 2026-09-17 finding: board/
controller/PSU/heatsink/fan spare numbers are a different HPE
document type (Spare Parts List), not present in QuickSpecs at all —
nothing more to add from this source without fetching that other doc
type, which is out of today's scope.

**CPU list: found 25 real Xeon Scalable SKUs missing from the shared
`CPUS` array entirely**, by diffing `DL360 G10`'s own "Choose
Processor Options" list (106 confirmed SKUs) against the tool's
existing sp1/sp2 pool. Added at the shared-list level (benefits every
sp1/sp2 model, not just DL360): 7 to `sp1` (`5117`/`6134M`/`6143`/
`8160M`/`8165`/`8170`/`8180M`) and 18 to `sp2` (`4214Y`/`4215`/
`5215L`/`5218B`/`5218N`/`5220S`/`6208U`/`6212U`/`6222V`/`6226`/
`6230N`/`6238L`/`6240L`/`6240Y`/`6250L`/`6252N`/`8260L`/`8260Y`).

**Per-model `cpuAllow` — started checking, found a real trap and
backed off rather than guess.** `DL560 G10`'s only cached doc is
QuickSpecs V1, dated 7-11-2017 — genuinely predates the 2nd Gen
(Cascade Lake) CPU launch (April 2019). It exhaustively lists a
1st-Gen-only Platinum+Gold pool, but that's silence on 2nd Gen from a
stale doc, not evidence 2nd Gen is unsupported — building a
`cpuAllow` from it would risk HARD-BLOCKING real, valid 2nd-Gen CPUs
this chassis likely does support in reality. Since `cpuAllow` is an
active block (unlike a soft note), a wrong one is worse than no
restriction at all. Deliberately did NOT add `cpuAllow` for `DL560`/
`DL580 G10` without a newer doc revision to confirm both generations
— flagged here rather than guessed either way. `DL380 G10`'s cached
doc has the same problem in reverse: its "Choose Processors" section
only has "2nd Generation" headings, no "1st Generation" section at
all — also inconclusive on its own (a later-revision doc could have
simply dropped an EOL tier from the ordering list without dropping
real support). Building real per-model `cpuAllow` lists needs a
verified CURRENT-revision doc per model, not just whatever's cached —
this is real work still to do, not started for any G10/G10+ model.

26 new regression tests (rounds 23-24), 545/545 passing.

Also fixed while sourcing this: `worksheet-qa.js`'s `grab()` helper
(used to pull `MODELS`/`CPUS`/`RISERS`/etc. array literals out of the
page source for testing) didn't understand `//` line comments — only
`/* */` block comments — so a `//` comment containing an apostrophe
silently broke bracket-depth counting for the whole array. Hardened
`grab()` (all 3 duplicated copies) to skip `//` comments properly,
and kept new inline comments apostrophe-free as a matter of style.

## Stale-source audit for G10/G10+ — started 2026-09-18, continued 2026-09-21

User: "check the quickspec sheets for the ones that predate the 2nd gen
cpus... make sure they're the most recent ones — no point working from
old sources." Found that hpe.com/psnow/doc/<id> works from the browser
(unlike Bash) and shows each doc's full version history; the doc page
renders either an Adobe PDF viewer (download -> `pdftotext -layout`) or,
for the latest version of some models, plain HTML text readable via
`document.body.innerText`. `?ver=N` on the URL selects an older version.
User authorized downloading current PDFs for this pass.

**Key lesson: "most recent" is not always "best."** HPE prunes discontinued
SKUs from a doc's ordering lists as the product ages, so the FINAL version
of an old server (DL580 G10 V52: 11 CPUs; DL360 G10 V74: 31; DL380 G10
V77: 35) is a thin end-of-life catalog, while a mid-life version (2019-
2021) has the full lineup a refurb trader will actually encounter. Other
sections behave the opposite way (PSU options GREW over time). So: take
CPU pools from a mid-life version (union across several if needed), take
PSU/FlexibleLOM/controllers from the latest.

Findings:
- **DL560 G10** cached doc was V1 (2017), predating 2nd Gen. Replaced by
  V19 (2019). Three real errors from the stale source, all fixed:
  FlexibleLOM list wrongly narrowed (V19 has all 11 cards incl. 3 25Gb
  tiers), P824i-p wrongly excluded (the old "cross-doc discrepancy" was
  never real — V1 just predated the controller), and no cpuAllow. Built
  a 77-SKU Gold+/Platinum cpuAllow (no Silver/Bronze, no -R/-U). Also
  found the mandatory 4x PSU Enablement Kit (875675-B21).
- **DL580 G10** cached doc was V3 (2017). Used V20 (2019) for a 78-SKU
  cpuAllow; V52 (2024) for PSU: 3 tiers added since 2019 (-48VDC, 1000W
  Titanium, 1800-2200W Titanium) so the old "only 2 PSU tiers" note was
  stale. FlexibleLOM gained 640FLR-SFP28.
- **DL360 G10** current V74: all 31 SKUs already in the tool. No change.
- **DL380 G10** current V77 (35 SKUs, "2nd Generation" headings only —
  explained: 1st Gen pruned at EOL, NOT unsupported). Fetched V24 (81
  SKUs) and V45 (66); union across V24/V45/V77 = 111. Added Gold 6137
  (Financial Sector kit). PSU + FlexibleLOM re-verified against V77:
  unchanged. Deliberately no cpuAllow — three snapshots can't prove a
  SKU absent, and a wrong hard-block is worse than none.
- **Correction to my own earlier comments:** Intel's "M" suffix is the
  2TB medium-memory tier, NOT "4-socket certified" (DL580's own doc:
  "up to 2 TB on M processors and up to 4.5TB on L processors"). Fixed
  in CPU entry comments, model notes, tests. Memory caps for M/L parts
  are not modeled beyond the existing note on DL360 G10.
- Also added 7 M-suffix SKUs (5215M, 6238M, 6240M, 8260M, 8276M, 8280M,
  6140M) to the shared CPUS list.

Not yet re-checked against current/mid-life docs: DL20/DL160/DL180/
DL325/DL385 G10, ML30/ML110/ML350 G10, and all G10+ (cached mirrors have
mostly unknown or old versions).

### Stale-source audit, continued 2026-09-21 — rest of G10 and all of G10+

Checked every remaining cached G10/G10+ doc against hpe.com (version history, plus a downloaded latest or mid-life
version, diffed by part-number set). Workflow that worked: `document.getElementById('selectVersionHistory')` lists
versions; `[...document.querySelectorAll('a')].find(a=>/downloadDoc/.test(a.href)).click()` triggers the PDF
download; `pdftotext -layout` (or `-raw` when a part-number column is detached from its description) extracts it.

Fixed because the mirrors were stale or incomplete:
- **DL110 G10+ — three earlier claims were wrong** (mirror was an early version): it is NOT DC-only (latest V18 adds
  a 700W Platinum AC P44975 and 900-1000W Titanium AC P54290 to the 700W -48VDC P43150), it has 6 OCP3 cards not 2
  (I350-T4, BCM57414, MCX562A, E810-XXVDA2/XXVDA4/CQDA2, three flagged not NEBS), and a 12-SKU telco CPU pool
  (now `cpuAllow`; added Gold 5320T/6338T to the shared sp3 list). Still no Smart Array; optional NS204i-p boot device.
- **DL385 G10+ v2 is not Milan-only**: the latest doc says "7003 series plus additional selected 7002 series" and its
  kit list includes Rome 7252/7302/7402. Platform widened to milan+rome; cpuAllow 24 SKUs. Same widening for
  DL325 G10+ v2 (mirror already listed Rome P parts 7232P/7302P/7402P), cpuAllow 26.
- **Shared CPU pools were incomplete**: added 4 Ice Lake (Gold 5318N/5318S/6314U, Platinum 8352S) and 4 Milan
  single-socket parts (EPYC 7203P/7303P/7643P/7663P).
- **cpuAllow now on every AMD G10/G10+ board** (DL325/DL385 G10, DL325/DL345/DL365/DL385 G10+ incl. v2): built from
  the union of the cached mirror and the latest doc; for both v1 boards the two were identical (19 SKUs each).
- **DL380 G10+**: latest adds BCM57412/BCM5719/BCM57504 OCP3 cards (so "no BCM5719" was mirror age); discontinued
  QL41132HQRJ/QL41232HQCU kept but labelled. DL360 G10+ latest only removes items.
- **DL385 G10** FlexibleLOM gap closed from the official V29 doc (8 cards + InfiniBand, differs from DL380).
- **ML350 G10**: added the 800W -48VDC PSU (was in the old doc too — an omission, not staleness).

Checked, no change needed: DL160/DL180/DL20/ML30/ML110 G10, DL20 G10+, ML30 G10+, DL365/DL345 G10+ hardware PNs
(latest only adds PCIe-standup NICs). Still no doc found for DL120 G10 (hpe.com IDs a00021855-59/61/63/64enw
probed: unrelated products).

Method caveat that still applies: HPE prunes discontinued items from EOL docs, so a hard block (cpuAllow) is only
built where two or more independent snapshots agree; DL360/DL380/DL560/DL580/ML350 G10 pools stay unrestricted
or rely on the largest mid-life snapshot.

## 2026-09-21 — Model notes trimmed to build-guide text only

User directive: model notes are strictly for build guides — what to use and what does not work — not a sourcing
log. All 60 models' `rules.notes` were rewritten (109K → 55K characters, 442 notes; longest now ~450 chars).
Removed: "sourced/added/corrected <date>" statements, doc IDs and mirror names, "confirmed absent by direct search",
"verified:true added", research-pass history, "stale-source check" write-ups, internal keys (`cpuAllow`,
`BACKPLANE_SAS_ONLY`, `hsSku`), and the two-line "Backplane cross-reference" narratives (kept as one line of
usable part numbers per model). The full original wording is in git at `7826bba` and earlier; the audit findings
themselves are in the dated sections above and `quickspecs-cache/MANIFEST.md`.

Kept: mandatory kits and dependencies (RPS/enablement kits, riser kits, cable kits, fan/heatsink kits and their
thresholds), what a chassis cannot take (no rear cage, LH-only controllers, no NVMe, no 4LFF…), limits (max DIMMs,
fan counts, CPU counts), and the still-open caveats worded as actions ("confirm before quoting").

Fixed while trimming:
- **547FLR-QSFP InfiniBand FlexibleLOM (879482-B21)** was missing from the FlexibleLOM lists of DL325/DL360/DL380/
  DL560/DL580 G10 although each model's own doc lists it (only DL385 G10 had it). The old DL360 G10 note admitted
  this gap ("InfiniBand FlexibleLOM options weren't exhaustively checked"). Added to all five.
- **DL360 G10 "10 NVMe" contradiction resolved**: the doc's fan section lists only a 2-CPU configuration for the
  10 NVMe Premium chassis, and the upgrade kit (867974-B21) requires two processors and the HP fan kit. The old
  note said "one processor or two". Note now says 2-processor build.
- P824i-p list labels on DL380/DL385 G10 no longer carry "sourced from DL580 G10's own doc" text.
- Because notes are keyword-filtered (`noteRelevant`: bay counts, NVMe, rear/midtray, GPU, 24G/SAS4, 3-/4-processor),
  general facts that shared a note with a conditional word were split so they always show (DL320 G11 fans vs GPU
  heatsink, DL325 G10+ v1/v2, DL365 G11 fans/risers, DL345 G11 riser, DL560 G11 riser vs GPU slot, DL380a G12 fans,
  ML350 G12 fans, DL80 G9 / DL120 G10 / ML350 G9 / ML110 G11 / DL580 G10 / DL580 G12 wording).

## 2026-09-21 — DL120 G10 removed; spec slip carries no part numbers

**DL120 G10 removed from the tool entirely** (user request). It was the one model with no findable QuickSpecs
(media bay, rear/mid-tray, TPM, mobo NC, PSU, fans, PCIe and riser data all unverified), so it could never be quoted
with confidence. MODELS entry, its two notes and its QA test are gone; the tool now has 59 models. DL120 G9 is
unaffected. Earlier entries in this file that call DL120 G10 "the one open item" are historical.

**Spec slip no longer shows HPE part numbers.** The slip goes to the engineers who build the server; part numbers
were added for the sales side ("pointing the sales guys in the right direction"). Now:
- The pickers (controller, PSU, FlexibleLOM/OCP, riser, expander) and the config checks still show part numbers.
- `slipName()` (just above `buildSlip()`) strips, at display time only, a picked label's part-number parentheticals,
  "— …" explanations, ", needs …" kit notes and any bare part number: "800W Flex Slot Platinum (865414-B21)" →
  "800W Flex Slot Platinum", "P408i-a LH — low-profile heatsink variant … (869081-B21)" → "P408i-a LH". Field values
  are not changed, so the controller-code lookups (`ctrlCode`), riser slot lookups and drafts still work.
- Only labels that carry a part number are trimmed; a label without one (e.g. the DL110 G10+ "no Smart Array —
  Intel VROC software RAID" entry) stays whole. A hand-typed bare part number is kept as typed, never blanked.
- The part-number test needs a digit in the suffix so names like "534FLR-SFP+" are not mistaken for one.
- Checked against all 849 list labels: 716 carry a part number, none survive `slipName()`, none come out empty.
- Not changed: the flag/stop lines that "Copy spec" appends under the slip (they are for the person fixing the
  build, and a few quote a kit part number).

Also removed two mislabelled entries from the PCI `CARDLIST`: "804405-B21 12G SAS Expander" (804405-B21 is the
P408e-p controller, already listed) and "804331-B21 SmartArch" (804331-B21 is the P408i-a). On the slip they would
have read as a SAS expander / "SmartArch".

## 2026-09-21 — SAS expander note under the field; fan TDP step shown and audited per model

**SAS expander.** The amber note under the SAS expander field used to appear only when the picked controller had a
known port count smaller than the bay count, while the Config check "EXPANDER" fired for any build over 8 bays — so
with no controller picked yet the check said "needs an expander" and the field itself said nothing. One function,
`expanderNeed()` (above `buildSlip()`), now drives BOTH: the amber (`cap-note suggest`) note under the field and the
Config check. It returns nothing when the controller's known port count already covers the bays (P816i-a with 16 bays,
SR932i-p with 24 — the old check nagged there too), when NVMe is used, when an expander is picked, or with no drives.
With no controller yet, or a controller whose port count isn't fixed by its name (Gen8/9 cards), the note is generic
("Suggested: <chassis-correct expander> — N bays usually needs a SAS expander or a second controller") and never
invents a port count.

**Fans — TDP step shown like the heatsink one.** The fan rule was never removed: `fanW` is a hard requirement
(`applyRec('fan',…,hard=true)`, "Perf Fans is required" blocks the build) and has been since the first commit. What was
missing: (1) the threshold was worded as "181W or above" rather than as the model's own QuickSpecs words it, and (2)
with no CPU-wattage step the fan line said nothing, so it looked like the rule had gone. Now `fanWtext` (like
`hsWtext`) carries the doc wording ("above 205W", "205W or higher"), the fan line reads "X (165W) is below the high
performance fan step (above 205W)" once a CPU is picked, the reason reads "X is 350W — above 205W requires the high
performance fan kit (P48820-B21)", and verified models WITHOUT a step say "Fan choice on this model is not tied to
processor wattage" (G9 and most G10 racks — confirmed by direct QuickSpecs text, not inferred: DL360/DL380/DL160/
DL180/DL325/DL560/DL580/ML350 G10 and the G9 racks have fan requirements for NVMe, rear drives, GPU and bay counts only).

**Per-model audit of `fanW` against each model's cached QuickSpecs** (the G10+/G11 defaults 205/206 were being inherited
by models whose docs say otherwise):
- DL325 G10+ v2 and DL345 G10+: 205 → **280W** ("processors equal to 280W require the Max Performance fan kit").
- DL380 G10+: 205 → **206** (doc: ">205W"; DL360 G10+ stays 205, its doc says "equal to or greater than 205W").
- DL325 G10+ v1, DL110 G10+, DL20/ML30 G10+, DL20/DL110/ML30/ML110 G11: inherited step **removed** (`fanW:0`) —
  fixed-fan chassis or no CPU-wattage fan rule in the doc (e.g. DL110 G11's 7 fans no longer "require" performance
  fans for a 350W CPU).
- DL320 G11: 206 → **185** (doc ">185W", same reading as its heatsink rule). DL325 G11: 206 → **241** ("above 240W");
  its heatsink step had the same inherited-default bug (150 → **241**: doc says Standard heatsink up to 240W,
  Performance to 300W, liquid cooling from 320W).
- Added where the doc states a step and the model had none: DL320 G12 and DL360 G12 (**above 185W**), ML350 G12
  (**300W** → Redundant Fan Kit P47219-B21 + Second CPU Fan Kit P47902-B21, same as ML350 G11), ML110 G9 (**140W**
  E5-1600 v3/v4 → System Fan Upgrade Kit 789654-B21).
- DL380 G12 has NO fan step in its doc (the 185W statement is about the standard HEAT SINK) — left without one.
- Doc wording added as `fanWtext` for every model that has a step.
Not audited / left as found: DL560 G11 (still inherits 206; doc has no fan/TDP text and the air-cooled CTO ships
performance fans anyway) and every model's HEATSINK step other than DL325 G11 — worth a matching pass.

## 2026-09-21 — Heatsink-step audit; right column clamped to the window

**Heatsink audit (same method as the fan audit): every model's `hsW`/`hsWtext` against its cached QuickSpecs.**
Already right, no change: DL360/DL380 G10 ("130W or higher" + 8256/5222/8156/6128/5122), DL325 G10 (>170W), DL385 G10
(>180W), ML350 G10 (>85W), DL360/DL380 G9 (>120W), all G10+ boards (DL325 v1 >150W, DL345 >=180W, DL360/DL380
>=150W, DL365/DL385 v2 >155W, DL385 >180W), DL320 G11 (>185W), DL345 G11 (>=260W), DL365 G11 (>240W), DL380 G11 (150W),
DL385 G11 (240W), ML350 G11/G12 (>=195W / >=225W). Changed:
- **`hsNoChoice:true` (no standard-vs-performance choice)** for models whose QuickSpecs list NO orderable performance
  heatsink kit and no wattage step, so the inherited G9/G10/G11 default (121/130/150W) was recommending a part the doc
  never offers: DL60/DL80/DL120/DL160/DL180 G9 (nothing about a heatsink option at all), DL160/DL180 G10 and
  ML110 G10 (docs only ever say "standard heatsink"), ML110 G11, and DL110 G10+/G11 ("fans and heatsink are included in
  the CTO server"). The info line now reads "comes with the processor kit or the server".
- **Off-by-one at the step:** DL340 G12's doc says standard up to 250W and performance ABOVE 250W — `hsW` 250 → **251**
  (five 250W parts — 6731E/6740E/6746E/6766E/6730P — were wrongly pushed to the performance heatsink). DL320/DL360/DL380
  G12 (doc "<=185W standard") 185 → 186 (no Xeon 6 part sits at exactly 185W, so no behaviour change; kept in line with
  their fan step).
- DL325 G11's step (150 → 241) was fixed in the fan pass.
Not changed (needs a per-SKU list, not a wattage step): **DL560/DL580 G10** flag individual SKUs "ships with performance
heatsink" — a few sub-130W parts (DL560: 6230/6230N/8158; DL580: 8158) are flagged there but not in the shared `hsSku`
list. DL380 G11's own doc says both ">= 150W" and "<= 150W" needs the performance/standard heatsink; kept "above 150W".
DL110 G12 has no data-sheet statement, left as is.

**Right column (Spec slip / Config checks / buttons) is clamped to the window on desktop (>=981px).** Before, a long
notes list pushed the sticky column below the fold and the page had to be scrolled to the very end to read/scroll the
rest; the slip also had its own scrollbar (`max-height:34vh`). Now: the spec slip has NO scrollbar and grows to show all
of itself, and only the Config checks box scrolls, inside itself. `syncSlipWrap()` (called at the end of `run()` and on
resize) gives that box an EXACT `max-height` in px = window height - 24px top gap - bottom bar - 14px - the slip block - the
buttons - the panel heading - the 14px gaps (min 88px), so the buttons sit 14px above the bar. (A first attempt used CSS
flex + `max-height` on the column; Chrome left the column 8-22px short of its cap while the notes still scrolled, which
showed up as the buttons ending a few px above the bottom of the engineer-notes card.) At the end of the page the last
card on the left ends 12px above the column limit (26px body padding vs the 14px bar gap), so when the notes are within
60px of filling their room the box is also given `min-height` = room: the column then ends exactly flush with that card
(verified: 0px difference at 720px and 1270px tall; a clearly shorter column stays compact). If even the 88px minimum makes
the column taller than the window (very short windows) the sticky `top` goes negative so the column bottom pins to the bar
once the page scrolls. Tablet/phone (<=980px) and print are unchanged (normal flow; print uses !important to drop the
inline max/min-height). jsdom can not lay out, so QA checks the CSS/JS wiring as text like the earlier sticky tests; the
layout itself was checked in the browser pane at 1360x720, 1360x1270, 1360x520 and 432x800.

## 2026-09-21 — DL360 G11 / DL380 G11 audit against the CURRENT QuickSpecs

Bread-and-butter systems, so audited section by section. Sources: **DL360 Gen11 V48 and DL380 Gen11 V47 (both 08-Sep-2026)**,
downloaded from hpe.com with the user's OK for those two PDFs (the cached copies were V38 Nov-2025 and V23 Jul-2024 —
DL380 was 24 versions behind). Text in `quickspecs-cache/` (`DL360-G11.txt`, `DL380-G11.txt`; the old ones kept as `*-STALE.txt`
for SKUs later versions dropped). `pdftotext -raw` gives clean per-CPU tables and inline part numbers; `-layout` scrambles them.

**CPU.** `cpuAllow` on both = the 66 SKUs the docs list (current orderable list plus 8 SKUs only the older doc still had —
refurb stock — plus 6458Q which the DL360 thermal rules still name). Keeps out the 4-socket H parts (8450H/8460H/8468H/6434H)
and the DL320/ML-only 5412U/5512U. **Gold 6548N is 250W, not 300W** (both ordering lists and the DL360 feature table; the DL380
feature table prints 300W — typo). Single-socket parts now also include Gold 6421N and 5411N (0 UPI links in both tables).
**Memory speed is per-CPU** (`CPU_MEM_MAX`, 69 CPUs, docs agree on every one): Silver 4410Y/4416+ and Gold 5418N 4000, most
Gold 5 / Silver 4400, most Gold 6 / Platinum 4th Gen 4800, 5th Gen Gold 6 5200, 8558P/8570/8580/8592+/8593Q/8562Y+/8568Y+ 5600.
`sp4` used to be a flat 4800 (wrong for ~20 of its CPUs). The speed buttons narrow to what the picked CPU runs and a higher speed
is a hard stop ("MEMORY SPEED … runs memory at up to N MT/s"); applies to every sp4/sp5 model.

**Memory.** `sp5` now offers 256GB (P90554-B21) and the per-socket ceiling for both models is 4TB (was the shared sp5 2TB).
DDR5 SmartMemory kit part numbers are shown under the memory field (`DIMM_KITS`, sales side only — not on the slip):
4800: 16GB P43322, 32GB P43328, 64GB P43331, 96GB P66675, 128GB P69974, 256GB P90050; 5600: 16GB P64705, 32GB P64706,
64GB P64707, 96GB P64708, 128GB P69976, 256GB P90554 (all -B21; -F21 = factory). **Doc typos not copied:** DL380 prints the
256GB 4800 kit as P90550-B21 (DL360, with its matching -F21, says P90050); DL360 prints the 128GB 5600 -F21 as P66976.
Rules from the memory notes: even DIMM quantity (verify); 96GB quantities (4800: 8/16 per CPU; 5600: 1P 1/6/8/12/16, 2P
2/12/16/24/32); 96GB and non-3DS 128GB not with the EE-LCC parts 4509Y/4510/3508U or the HBM 9462; **DL380: 24SFF is limited to
16 DIMMs, 256GB DIMMs limit the server to 2 front cages (so not 24SFF/12LFF), 128GB+ needs the High-Performance fan kit** (the doc
also says "96GB or higher" once; 128GB used, noted); **DL360: 256GB needs the performance heatsink**, plus a verify note with the
1DPC/approval/DLC conditions.

**Chassis, cages, backplanes.** Added the missing chassis: **DL360 10SFF (8SFF + 2SFF cage), 20EDSFF; DL380 12EDSFF/36EDSFF**
(`bayCapacity()` now counts EDSFF). EDSFF is NVMe-only (DL380 added to `BACKPLANE_EDSFF_NVME_ONLY`), has no internal RAID
controller (new `edsffNoCtrl` check; external E208e-p allowed), and DL380 excludes 8581V/8558U on it. DL380 rear options gained
2LFF/4LFF rear (LFF riser cages). Cage/backplane/midtray/media-bay kit part numbers are in the notes (DL380: P48813 x1 Tri-Mode,
P48814 x4 Premium, P50728 UMB, P48811 stacking, P48812 side-by-side, P48809 4LFF mid, P48815/P48816 8SFF mid, P48810 2SFF rear,
P48823/P51095/P48826 2LFF rear; DL360: P48895 x1, P48896 x4, P48899 2SFF, P48926 UMB, P48928, P48914, cable kits P48909/P52416/P48910).
DL380 doc's chassis text mentions an "8SFF SAS/SATA" cage that has no part number in its ordering list — noted, not modelled.

**Power / storage / network part numbers** (picker labels; the slip strips them): PSU lists (DL380 5, DL360 7 — incl. the DL360 500W
limits), controller lists with PNs (SR932i-p P47184, MR416i-p/-o P47777/P47781, MR216i-p/-o P47785/P47789, MR408i-o P58335, E208e-p
804398), a per-model battery list (96W P01366/P68039, hybrid capacitor P02377, 16W P65038 on DL380), and the 11 OCP 3.0 cards each doc lists
(shared `OCP_CARDS` corrected: BCM57608 is not "Gen12"-only, E810-XXVDA4 is 10/25Gb). The slip now strips the battery label too.

**Cooling.** DL380 G11 standard fans are 4 for any CPU count (`two` was 6; the doc has no 2P standard kit — only the 6-fan HP kit);
DL360 G11: NVMe/24G SAS and EDSFF and 256GB DIMMs require the performance heatsink, a CPU over 300W needs liquid cooling (single
300W air exception kept). Riser fixes: DL380 slot lengths, tertiary riser part number P48804, DL360 field-upgrade primary riser P75407.

**Not done for these two (candidates for the next pass):** PCIe stand-up NIC/HBA/GPU card lists with part numbers (CARDLIST is
generic), rails/bezel/iLO/TPM option part numbers, the 100Gb-NIC/25°C and per-slot GPU limits, per-position rear-cage quantities
(the tool has one rear bay location), DLC module options, NS204i-u boot device kits, and the DL380 12EDSFF/36EDSFF bundle
requirements. Other Gen11 models (DL320, DL325, DL345, DL365, DL385, DL560, ML) still use the older data — the per-CPU memory
speeds and DIMM rules generalise, the per-model lists do not.

## DL360 G11 / DL380 G11 — second pass: rear-cage positions, rails/bezel/iLO/TPM, stand-up cards, NS204i-u (2026-09-21, build .9)

Same sources as the first pass (DL360 Gen11 V48, DL380 Gen11 V47 — `quickspecs-cache/DL360-G11.txt`, `DL380-G11.txt`;
raw-mode text for the tables). GPUs and liquid cooling were declared out of scope by the user and are not touched.

**Rear cages, per position (DL380).** The tool used to treat the whole rear as one bay location ("REAR CONFLICT: one rear-cage
location"). From the CTO drive-cage table + the kit notes the DL380 has three riser positions and one mid-tray bay:
2SFF U.3 cage P48810 in the primary or secondary position (8SFF/24SFF chassis only; the QuickSpecs require the x8/x16/x8 secondary
riser P48802 with it, which needs CPU 2, and one cage blocks Slots 4-5 of that riser), the 2SFF stacking cage P48811 in the
tertiary position (the rear-view diagram shows a 2SFF cage there, and 2xP48810 + 1xP48811 = the table's "3 optional" on the SFF
chassis), and on LFF chassis 2LFF cages: primary P48823, secondary low-profile P51095, or one secondary-and-tertiary cage P48826
(secondary/tertiary risers cannot be selected with it). Chassis totals from the table: SFF 3x2SFF; LFF 1x2SFF + 2x2LFF;
EDSFF 1x2SFF. New rule keys `rearCages` (kit, position, chassis class, riser exclusions) + `rearMax`; `rearCageChecks()` enforces
one cage per position, chassis eligibility, the totals, one mid-tray, the riser exclusions and the P48802 requirement. Rear
picker labels carry the position + PN; the slip keeps the position ("2SFF rear, primary riser") and drops the PN. The x1 Tri-Mode
8SFF mid-tray (P48815) no longer triggers the SR932i-p / bundle check — only the x4 (P48816) does (that is what the doc says).
**Doc quirk:** P51095 is named "LP Secondary Riser Cage" but its note says "rear Primary Riser position" — treated as secondary
(the secondary riser's own note says "2LFF Secondary Cage selected -> Secondary Riser cannot be selected"). The 2SFF cage on the
LFF/EDSFF tertiary position is P48811 by elimination — no separate note names it. DL360 G11 has no rear drive bays: its old
"2x M.2 (dual uFF) rear" entry (really the NS204i-u) is gone, `rear:[]`.

**Rails / CMA / bezel / iLO / TPM (sales hints under the fields, never on the slip).** Rails: both models P52341-B21 Easy Install
Rail 3 Kit; the DL360 4LFF and 20EDSFF chassis take the Rail 5 Kit P52343-B21 instead (8SFF/10SFF = Rail 3); CMA DL380 P22020-B21,
DL360 P70741-B21 (CMA 4) or P26489-B21; the rail kit does not include the CMA. Bezel: DL380 Gen11 2U Bezel Kit P50400-B21 + Bezel
Lock Kit 875519-B21 (needs the bezel kit; new check for a bezel key with no bezel); **the DL360 QuickSpecs list no bezel part number
at all** — the hint says so rather than guessing. iLO: Advanced 1-server licence 512485-B21 (1 yr) / BD505A (3 yr), electronic
E6U59ABE / E6U64ABE — sourced from the DL380 doc and applied to the DL360 too (its doc says the licences are for all ProLiant
servers but prints no table). Gen11 QuickSpecs list iLO Advanced only, so picking "Advanced Premium" gets a verify. **TPM: no
option part number exists on Gen11 — TPM 2.0 is embedded** (both docs; already handled by `tpmKind`, the info check says "no part
number to order").

**Stand-up cards.** New per-model `cards` list (picker labels with PNs): 17 NIC/InfiniBand + 8 Fibre Channel HBAs + 6 NS204i-u,
DL380 also the NVIDIA crypto card S2A69A. Ethernet (1Gb P21106/P51178; 10Gb P26253/P26259; 10/25Gb P08443/P08458/P26262/P26264/
P87940/P21109/P42044; 100Gb P73111/P25960/P21112), InfiniBand P45642-H23/P65333-H21/P45641-H24, FC R2E08A/R2E09A/R2J62A/R2J63A/
R7N86A/R7N87A/R7N77A/R7N78A. The slip PN pattern now also strips suffix-less SKUs (`[RS]\d[A-Z0-9]{3}A`). Rules from the notes:
100/200/400Gb adapters (PCIe or OCP) need performance fans; DL360 also the performance heatsink and no 256GB DIMMs with any of
them; DL380 100GbE: 25°C ambient + x16 slots note, 256GB excluded only by InfiniBand, InfiniBand not on 24SFF/12LFF and needs the
OCP2 x16 kit P48828; DL360 4-port cards not in Slot 2, 1 without / 2 with a secondary riser (verify). 500W-PSU/x16-NIC rule stays a
note only (card labels carry no lane width). **Left out:** the DL380 NVIDIA/Slingshot/storage-offload cards (Cray-only or DPU), the
per-config ambient tables for 100Gb (they are liquid-cooling driven).

**NS204i-u.** Three devices — Gen11 P48183, v2 960GB P81160, v2 960GB SED P81162 — each internal or hot-plug, as card-picker
entries (6 per model). DL380: Internal Cable Kit P52152; the externally accessible mounting also needs FIO bundle kit P54542; takes no
PCIe slot. DL360: Internal Cable Kit P48920 or Rear Cable Kit P54702 (never both); the rear kit replaces the Slot 2 cage (counted as
a used slot), cannot be used with the full-height secondary riser P48901 (the LP one P48903 keeps Slots 1 and 3); any NS204i-u needs
the performance heatsink (or liquid cooling). One per server (stop). I did not state the drives' size for P48183 — the DL360 doc's
"2x 480GB M.2 RAID 1" note is not tied to a device and v2 is 960GB.

**QA harness:** the data-table readers now eval the MODELS literal with `DATA_PRELUDE` (the shared `G11_*`/`ns204Cards`/
`DL380G11_CAGES` code declared above it). 725 ok / 0 FAIL.

**Still not done:** DL380 EDSFF-bundle rules, the DL380 chassis-intrusion kit P48922, DL360 cable-kit requirements per backplane,
Cray/DPU cards, and the other Gen11 models. `-001` spares are not in QuickSpecs.

## Correction — DL380 G11/G12 fan counts (2026-09-21, build .10; user-reported)

**The first Gen11 pass was wrong** to set DL380 G11 standard fans to 4 for any processor count: the tool then flagged "DL380 G11 with 2
processors takes 4 standard fans — 6 entered", and the user (correctly) said that can't be right. I had read the QuickSpecs line "8SFF, 8LFF
and 12LFF CTO models ship with 4 standard fans" (the base server, no processors) as the count for every build, and treated the absence of a
2-fan standard kit in the current V47 text as proof there was none. **Sources that settle it:** HPE's own *DL380 Gen11 Server User Guide*,
"Fan mode behavior" (support.hpe.com, docId sd00002446en_us) — single processor = fans in bays 3-6 with blanks in 1-2 ("four fans and two
blanks"), dual processors = "six fans are required for redundancy"; the Gen12 user guide (sd00005878en_us) says the same; the stale V23 doc
lists "HPE ProLiant DL380 Gen11 Standard Fan Kit P49146-B21 — includes two standard fans, not supported with 24SFF and 12EDSFF CTO server"; the
DL380 Gen12 QuickSpecs list the same kit ("Includes 2 Standard Fans"), and the V47 cooling page still carries P49146-B21 in its part-number column.
**Now:** DL380 G11 `fans:{one:4,two:6,perf:6}`, the 12EDSFF/36EDSFF chassis ship 6 standard whatever the processor count (`fansByBay`, new key), the
24SFF ships 6 high-performance (unchanged), and the fan explainer names the 2-fan Standard Fan Kit P49146-B21 (`fanKit2P`, new key) for the
second processor. **DL380 G12 had the same wrong count** (pre-existing, `two:4`): fixed the same way — 4 ship on SFF/8LFF, 6 on 12LFF (`fansByBay`) /
EDSFF, 24SFF ships 6 high-performance (`fanBays` added), two processors need 6. Both models' fan notes rewritten (the old G12 note said fans
depend on the bay "not CPU count" — wrong). Lesson recorded in memory: a QuickSpecs "CTO ships N" line is the base server, not the count for a
built one — check the server's user guide for fan/DIMM population, and when the user pushes back on a check, treat their hardware knowledge as
the prior. 739 ok / 0 FAIL. Not audited for this: DL560 G11 / other 2U models' fan counts.

## DL560 G11 fan audit (2026-09-22, build .1; user asked to audit after the DL380 fan-count fix)

**Source:** the cached DL560 Gen11 QuickSpecs (DA-17093, `quickspecs-cache/DL560-G11.txt`). Its "System Fans" section names
only "High Performance Fan Kit" — no standard tier exists at all: "On 8SFF Air-cooled CTO server model ships with 6 high
performance fan kit. On 8SFF Liquid-cooled CTO server model ships with 5 performance fan kit." A CTO-config table repeats the
same 6 / 5 split. Neither figure is tied to processor count (1-4) or CPU TDP — unlike DL380, this doc never scales the fan
count by socket count. No orderable part number is given for either fan kit anywhere in the doc (checked exhaustively, unlike
DL380/DL360's P48820/P49146).

**Bug found (pre-existing, this pass): `fans:{two:6,perf:6}` had no `one:` key**, so a single-processor pick left the Fans
field unfilled (no auto quantity, no explainer) despite the doc's count being fixed regardless of socket count. Also, because
the model didn't override `fanW`, it inherited the G11 default (`fanW:206`) — CPUs at or above 206W (6 of the 9 confirmed
SKUs) were getting an extra, unsourced "requires the high performance fan kit" reason tied to wattage, which happens to be
true by coincidence but is not why this chassis has one kit. And the "Std Fans" pill/explainer ("Standard fans are adequate…")
doesn't apply to a chassis whose only air-cooled kit is itself called High Performance.

**Fix — new `fanNoChoice` key** (same idea as the existing `hsNoChoice`, for fans): defaults the Fans pill to "Perf Fans" and
shows an info check ("has one fan kit for air cooling — there is no standard-vs-performance choice to make") instead of the
Standard-fans explainer, but does not fight a manual pick (the quantity is 6 either way, so there's nothing to actually get
wrong). Set alongside `fanW:0` so the wattage-based reason no longer fires — this model's fan count is fixed, not
CPU-TDP-triggered. `fans:{one:6,two:6,perf:6}` — 6 fans regardless of 1-4 processors. Rewrote the fan note to say so plainly and
flag that no part number exists for it in this doc. The liquid-cooled 5-fan variant is a cooling-method choice (DLC), which
the user has scoped out of this project for every model, so it stays a note only, not a selectable mode.

QA: 746 ok / 0 FAIL (7 new tests: fixed TDP CPUs low/high, 1P and 4P quantity, manual-Standard-pick doesn't block). Every
other Gen9-Gen12 2U/4-socket model's `fans` was checked in the previous pass and already has the right two-processor count —
this was the one gap. **Not fixed, flagged only:** the doc mentions an EDSFF chassis (up to 16 at 2P / 24 at 4P) not in the
bay list; the 5-fan liquid-cooled variant and its DLC heat sink kit (P54791-B21) aren't modeled as a selectable cooling mode
(out of scope per the user); no heatsink kit part number is set for this model either (`hsPart` unset) — the doc does list
one (P48818-B21 for 2P, P48905-B21 for 4P) but that's a separate axis from this fan-only audit.

## DL360 G10+ / DL380 G10+ brought up to G10/G11 info depth (2026-09-22, build .2; user: "do the dl360/380 models for the g10+ have as much info as the g10 and g11 lines? if not then start on those")

**Answer: no, they didn't** — psu/ctrl/flr/riser were already sourced with part numbers, but cpuAllow, per-CPU memory speed caps,
DIMM kit part numbers and a battery list (all things G11 has, and G10 has for at least the AMD siblings) were missing. Used the
already-cached CURRENT docs confirmed during the 2026-09-21 stale-source audit (`DL360-G10+-v44.txt`, `DL380-G10+-v42.txt` — both
already the latest hpe.com version, no new download needed for this part).

**CPU pool.** `cpuAllow` (34 SKUs each, shared array — both docs list the identical 3rd Gen Xeon Scalable pool): the 31 SKUs
the CURRENT doc actually orders (9 Platinum + 18 Gold + 4 Silver), plus 3 more the doc still specs in its feature table but has
quietly dropped from the orderable Step-2a list — Platinum 8351N, Platinum 8352S, Gold 6314U (all three still have real part
numbers in the older cached mirror: P37602/P37613/P37610-B21 — kept for refurb stock, the same "union of snapshots" reasoning
used for the Gen11 CPU pools). Excluded: DL110 G10+'s two NEBS/telecom-only SKUs (5320T, 6338T). **Found a real correctness bug**:
Platinum 8351N is single-socket-only despite not being a "U"-suffix part (both docs' own note: "8351N is single socket capable
even though not being a 'U' processor") — added to `SINGLE_SOCKET_EXTRA`, which the generic 2-CPU check already reads.

**Memory.** Per-CPU DDR4 speed cap now enforced (`CPU_MEM_MAX`, same mechanism as sp4/sp5, previously flat-listed as
"documented gap, too fine-grained" back on 2026-09-15 — that reasoning is now superseded by the sp4/sp5 precedent): Silver
SKUs and Gold 5318N/6330N/6338N cap at 2667; Platinum 8352V and Gold 5315Y/5317/5318S/5318Y/5320/6330 cap at 2933; everything
else runs the platform ceiling, 3200. Sourced from DL360 G10+'s clean per-SKU ordering notes (DL380's own text extraction of
the same wide feature table is badly column-mangled by `pdftotext -raw` — tried `-layout` on the cached PDFs in scratchpad too,
but those turned out to be a stale 2021 V7 doc and an unrelated NEBS supplement, not useful); applied to both models since
memory speed is a CPU silicon property, not a chassis one. **Doc typo not copied:** DL360's Gold 6338N note reads "2677 MT/s" —
DDR4 has no such speed, read as 2667. `dimmKits:true` on both models now shows the real SmartMemory kit part number under the
memory field (`DIMM_KITS.sp3`, new): 8GB P07525, 16GB P06031, 32GB P06033, 64GB P06035, 128GB P06037, 256GB P06039 (all -B21).
16GB and 32GB each also have a single-rank alternative (P06029, P40007) — noted, the dual-rank part is what shows.

**Battery.** `bat:[]` on both (previously falling back to the generic list): 96W battery P01366-B21, hybrid capacitor
P02377-B21, no battery. No 16W-capacitor or standalone-battery variant in these docs (those were DL380 G11-only additions).

**Fans — found a real bug matching the DL560 G11 class.** `DL360 G10+`'s `fans:{two:7,perf:7}` was missing a `one:` key
entirely, so a single-processor pick got NO fan quantity auto-filled at all. Its own doc is explicit: base server ships 5
fans, the 2-fan Standard Fan Kit **P37861-B21** ("complements base server default (5) to system max. of 7... supports
processors with a TDP equal or lower than 195W") brings a 2-CPU build to 7, and the High-Performance Fan Kit P26477-B21 (7
fans, replacing them all) is required at 205W+ — matching the fanW:205 threshold already set. Fixed to
`fans:{one:5,two:7,perf:7}`, added `fanKit2P:{n:'Standard Fan Kit',pn:'P37861-B21'}` (same new mechanism from the DL380 G11 fan
fix) so the explainer names the part. `DL380 G10+` already had all three fan-count keys correct; added the matching
`fanKit2P` (its own 2-fan add-on is **P37042-B21**, confirmed in its own doc) and `fanPart:'P14608-B21'` (was set on the
heatsink notes text but never on the rule key).

QA: 760 ok / 0 FAIL (14 new tests: cpuAllow pool + exclusions, 8351N single-socket, per-CPU speed narrowing incl. the uncapped
control case, MEMORY SPEED hard stop, DIMM kit hint, battery list both models, the fan-quantity fix both models).

**Not done — needs a fresh document fetch (the current stand-up-card section's raw-mode text is too column-mangled to
transcribe reliably, and the only cached PDFs for these two models turned out to be a stale 2021 doc and an unrelated NEBS
supplement):** the stand-up NIC/Fibre-Channel-HBA card list with part numbers (`cards`, the G11-style axis — flr/OCP already
has PNs, this would be its PCIe-slot sibling), rails/bezel/iLO sales-hint part numbers, and the NS204i-p/NS204i-r boot device
(G10+'s generation of the device G11 calls NS204i-u — currently just two unsourced entries in the generic `CARDLIST`). All
three would need the CURRENT V44/V42 PDF downloaded fresh and read with `pdftotext -layout` (raw mode badly mangles this
particular wide table in both docs) — asking the user before doing that, same as before the Gen11 PDFs were fetched.

## DL360 G10+ / DL380 G10+ stand-up cards (second half, 2026-09-22, build .3) — user approved the fresh PDF download

Downloaded the current V44 (DL360, a50002559enw) and V42 (DL380, a50002553enw) QuickSpecs from hpe.com with permission —
both matched the already-cached raw-mode text exactly (same revision), confirming no re-audit of the other axes was needed.
The scratchpad's earlier cached PDFs for these two turned out to be the wrong documents (a stale 2021 V7 doc and an
unrelated NEBS supplement) — this pass used freshly downloaded ones. `pdftotext -raw`, `-layout` and even the hpe.com
in-browser viewer's own search all garble this specific wide Ethernet/FC-HBA table in both docs identically (columns
visually correct, text-extraction order scrambled) — **`pdftotext -table` ("optimized for tables") is what actually works**
for this shape, worth remembering for the next model that hits the same wall.

**Stand-up cards** (`cards`, same mechanism as the Gen11 pass): two separate arrays (`DL360G10P_CARDS`/`DL380G10P_CARDS`,
not one shared list — the OCP-card axis already taught this lesson once). Ethernet 1Gb through 200Gb, InfiniBand, Omni-Path,
storage-offload and Fibre Channel HBAs, all with real part numbers. Real per-model differences confirmed, not assumed: DL360
gets 2 extra Emulex SN1600E parts (Q0L11A/Q0L12A) DL380 does not offer; DL380 gets a Slingshot NIC (R4K46A, Cray-only) DL360
does not. 35 cards on DL360, 34 on DL380.

**Found a real, unsourced part number already sitting in the tool** (predates this session): `flr` on both models listed
"InfiniBand HDR/Eth 200Gb 1p (P31323-B21)". Checked against both fresh docs — **P31323-B21 never appears anywhere in
DL360's own document**, so removed there entirely. DL380's own doc references it twice, but only as a column header in a
restrictions table — it never gives the part its own product-name line anywhere in the document. Kept for DL380, reworded
to say plainly that the doc names the part number without ever naming the product, rather than presenting a guessed name as
fact. This same string also sits in 4 other G10+ models' `flr` overrides (DL325/DL345/DL365/DL385) and in the shared
`OCP_CARDS` fallback — **not touched**, since those models' docs were not re-verified this session; flagged for whoever
next audits them.

**Slip stripping bug found and fixed**: `SLIP_PN` only matched suffix-less HPE part numbers starting `R` or `S` (R2E08A,
S2A69A). The new Fibre Channel HBA codes include `Q`-prefixed (Q0L11A-Q0L14A) and `P`-prefixed (P9D93A/P9D94A) parts of the
identical shape, which the regex let straight through onto the engineer-facing slip. Widened the leading-letter class from
`[RS]` to `[A-Z]` (letter + digit + 3 characters + trailing `A`, still exactly 6 characters, still word-bounded) — checked
this doesn't introduce any new false match anywhere in the test suite.

QA: 768 ok / 0 FAIL (11 new tests: both card-picker lists with counts and per-model differences confirmed, the generic
starter list is unaffected on a model without its own `cards` override, the corrected/flagged InfiniBand P31323-B21 handling
on each model, the widened slip-stripping regex). Build 2026.09.22.3.

**Still open for these two, lower priority now that CPU/memory/battery/fans/cards are all sourced:** rails/bezel/iLO hint
part numbers (the G11-style sales hints under those fields — not yet built for any G10+ model) and the NS204i-p/NS204i-r
boot device (G10+'s generation of what G11 calls NS204i-u — still just two unsourced placeholder entries in the shared
generic `CARDLIST`, not a real per-model catalogue entry).

## Per-riser-position rear cages (G10 + G10+), G10+ boot device, G10 cpuAllow/battery (2026-09-22, build .4)

User: "do the Per-riser-position rear-cage modeling for g10 and g10+, then the g10+ era boot device, then the g10 cpuallow
and battery list." Downloaded the current DL360 Gen10 (V74, a00008159enw) and DL380 Gen10 (V77, a00008180enw) QuickSpecs
from hpe.com with permission — confirmed by their own revision-history tables, not just the filename. Along the way,
answered the user's separate question about the download mechanism: this session's browser pane auto-saves to Downloads
without a manual "Save" dialog (unlike a real desktop browser); every download this pass was verified against the PDF's own
`%%EOF` marker and its embedded version/date text, not trusted from the filename alone.

**Per-riser-position rear cages.** New mechanism additions to `rearCageChecks()` (previously built only for DL380 G11):
a generic check that a cage in the secondary/tertiary position needs the 2nd processor, and a `conflictsWith` field for a
documented cage-vs-cage exclusion that isn't a same-position clash (two different positions the doc still says can't be
used together).
- **DL380 G10** (`DL380G10_CAGES`, new — first use of this mechanism on a classic-G10 chassis): simpler than G11 — the
  2SFF SAS/SATA kit 826688-B21 is ONE part number good for either the primary or secondary riser (not two distinct
  per-position parts), max 2 total on the SFF chassis (confirmed: "2 SFF in the rear is only supported with a 24 SFF model
  or 12 LFF model... max 2 supported SFF model"). LFF instead takes the 3LFF kit 826685-B21 in the secondary position only.
  4LFF midtray 826686-B21. **Found and fixed a real mislabel**: the flat list's "2SFF NVMe rear" entry (826687-B21)
  implied NVMe drives could go in that rear slot — the doc says the opposite ("drive cage can be used in the rear of the
  chassis, but will not support NVMe drives rear" — NVMe is front-only on this cage). Renamed to "2SFF SAS/SATA rear".
- **DL380 G10+** (`DL380G10P_CAGES`, replacing the flat list): three real per-position 2LFF kits (primary P14579-B21,
  secondary P25903-B21, tertiary P14580-B21) plus the one-part-two-positions 2SFF kit P26920-B21 (primary or secondary,
  qty 2 = both) and two front/tertiary 2SFF kits (P26922/P26923-B21). The secondary and tertiary 2LFF kits cannot combine
  even though they occupy different positions — a documented exclusion, now the first real use of `conflictsWith`.
  rearMax: 3×2SFF (6SFF) on SFF, 2×2LFF (4LFF) on LFF.
- **DL360 G10 / DL360 G10+**: left as flat lists (enriched with real PNs only) — both are genuinely single-position
  chassis (DL360 G10: one rear-drive location behind the primary riser; DL360 G10+: no rear drive bays at all, confirmed
  in its own doc) — per-position modeling doesn't apply and forcing it on would be inventing structure the docs don't have.

**G10+ boot device.** `NS204i-p` (P12965-B21, PCIe x8 stand-up card, needs the High Performance Fan Kit — new fan-reason
check added, `cardNames` matched against `/NS204i-p/i`) is on both `DL360G10P_CARDS` and `DL380G10P_CARDS`. DL360 G10+ also
gets a riser-integrated alternative, `NS204i-r` (P26463-B21, new entry in `RISERS['DL360 G10+']`) — replaces the default
primary riser, adds 2x M.2 22110 (media not included), and needs the same fan kit; DL380 G10+ has no such riser variant.

**G10 cpuAllow.** Discovered the hard way (several pre-existing regression tests failed) that the current V74/V77 docs have
pruned the CPU pool down to 29/35 SKUs each, while the shared CPU pool and multiple long-standing tests assume a much
wider set is still valid. Rather than narrow to the pruned current-doc list (which would have wrongly blocked real,
previously-working CPUs — the exact risk the DL560/DL380 G10 cpuAllow decision warned about back on 2026-09-17), built the
union with a wider pre-pruning snapshot already cached for this project: **DL360 G10 = 106 SKUs**, **DL380 G10 = 111 SKUs**
(both fully diffed against their source text programmatically, not hand-checked, after two manual-transcription slips —
G5215L and G5222 — were caught this way and fixed). DL380 gets several SKUs DL360 doesn't (8156, 8160M, 8260M, 8276M,
8280M, the Financial Sector Gold 6137/876562-B21, 5215L/5215M) — real per-model differences, not copied across.

**G10 battery.** `bat:[]` on both, same 96W-battery/hybrid-capacitor/none pattern as every other generation (P01366-B21 /
P02377-B21) — this part hasn't changed across Gen9–Gen11.

QA: 789 ok / 0 FAIL (21 new tests: rear-cage per-position checks on all 4 models including the new conflictsWith/needs-CPU2
mechanics, cpuAllow counts with per-model exclusions, battery lists, both boot-device paths, slip stripping). Build
2026.09.22.4.

**Not done / lower priority now:** DL360 G10's 10SFF Premium chassis fan/riser specifics beyond what's already modeled;
rails/bezel/iLO PN hints for G10 (only built for G11 so far); the DL380 G10+ EDSFF-bundle rules and intrusion kit still
flagged from the earlier stand-up-card pass.

## SAS expander section: a real 2nd-controller picker + OCP-first controller sorting (2026-09-23, build .1)

User: G11 doesn't use SAS expander cards, it uses multiple controllers instead — the "SAS expander / extra HBA" field
already had a "second controller" option, but it was a plain, non-selectable string with no way to say WHICH controller.
Also asked for controller lists to sort OCP slots before PCI card variants.

**Second controller.** `expandersFor(m)` now lists the model's own real controller options (the same source as the
primary `#ctrl` field — `m.rules.ctrl` if the model has one, else the generic `CTRLS` list filtered to its generation) as
`"2nd controller: <name + part number>"`, pickable exactly like the primary controller field, wherever no real
expander-card SKU exists for that model (most of G11/G12, and plenty of older chassis too — see `EXPANDER_PARTS`). A
model with a genuine expander card (DL380/DL385 G9/G10, DL560 G9/G10, DL580 G10, ML350 G10, ML110 G10, DL380/DL385
G10+) still gets that listed first, unchanged — the 2nd-controller options are additional choices there, not a
replacement. The field's label/hint/placeholder now switch dynamically (`#expander-label`/`#expander-hint`, mirroring
the existing FlexibleLOM/OCP label-switch pattern): "SAS expander / extra HBA" where a real card exists, "2nd
controller / extra HBA" with an explicit "no SAS Expander Card exists for X" hint where it doesn't. The EXPANDER config
check and suggestion note pick up the same wording split. Removed the now-redundant `EXPANDER_HBAS` array (P408e-p/
E208e-p/H241 as separate hardcoded fallbacks) — those same parts already surface through the model's own controller
list with the correct generation filtering, so the extra layer was duplicate logic.

**Controller sorting.** DL360/DL380 G11's `ctrl:[]` arrays now list the `— OCP (mezzanine) —` group before
`— PCI (plug-in card) —` (previously PCI first) — an OCP mezzanine slot is what a trader reaches for first on these
chassis, so the picker should offer it first too.

**A real bug found while wiring this up, not from the docs this time but from the codebase's own structure:**
`expandersFor()` lives at the file's global scope (a plain data helper, called from both inside and outside the app's
main IIFE), but `rulesFor()` — which I first reached for to read `R.ctrl` — is declared *inside* that IIFE and isn't
visible from outside it. Calling it from `expandersFor()` threw `ReferenceError: rulesFor is not defined` on every
single model pick, which silently broke the ENTIRE tool (every check, every field, the whole `run()` pipeline never
completed) — caught immediately by the QA harness dropping from 800 potential passes to 507, with the rest cascading to
"No rules triggered yet." Fixed by reading `m.rules.ctrl` directly instead (safe: `GEN_DEFAULTS` never sets a `ctrl` key
for any generation, so `m.rules.ctrl` and `rulesFor(m).ctrl` are always identical) rather than moving the function or
widening the IIFE's scope. Worth remembering: this file has two scope tiers (global helpers vs. the IIFE-private app
logic) — a global-scope helper can never call an IIFE-private one, and the failure mode when it does is silent to a
person just glancing at the page (the UI renders fine until you actually pick a model) but catastrophic to every check
in the harness at once.

QA: 800 ok / 0 FAIL (11 new tests: the 2nd-controller list contents and ordering on both G11 models, the real
expander-card path staying unchanged on DL380 G9, picking a 2nd-controller option and its slip line, the wording split
on both EXPANDER check paths, OCP-first sorting on both G11 controller lists). Build 2026.09.23.1.

**Not done / could extend later:** the 2nd-controller picker and OCP-first sorting were only requested for G11 and
implemented generically (so every other model without a real expander SKU already benefits) — but the OCP-first
*sorting* change itself was only applied to DL360/DL380 G11's `ctrl` arrays; other models with an OCP+PCI split (e.g.
DL325 G10+, DL385 G10+) haven't been resorted the same way, since the user's wording ("for G11") didn't clearly ask for
those too.

## CPU picker: full name/cores/clock/TDP readout after selection (2026-09-23, build .2)

User (with a screenshot of the open CPU dropdown): once a processor is picked, the closed combo field only has room
for the bare code ("G6430") — completely wasting the extra name/core-count/clock/TDP the open dropdown's own sub-text
shows. Asked for that detail to stay visible at a glance after picking, without adding it to the spec slip.

Added a `<span class="cap-note" id="cpu-detail">` right under the `#cpu-combo` field, populated inside `evaluate()`
(which already computes `cpu=cpuByCode(v('cpu'))` on every `run()` pass) from the exact same `CPUS` fields the
dropdown's own `sub` text uses — `cpu[1]+' · '+cpu[3]+'W'`, e.g. "Xeon Gold 6430 · 32C 2.1GHz · 270W" — so the two can
never disagree. It's fed straight from the `cpu` var already in scope, not a separate lookup, and reuses the plain
`.cap-note` styling already used for `psu-note`/`mem-note`/etc. rather than inventing a new visual treatment.
Display-only by construction: `buildSlip()` only ever pushes `v('cpu')` (the bare code) onto the slip, and the new
readout isn't wired into `buildSlip()` at all, so it can't leak into it.

QA: 804 ok / 0 FAIL (4 new tests: the readout shows the full name/cores/clock/TDP after picking G6430; it never
appears in the spec slip; switching to a different CPU updates it, including a descriptive suffix like G6458Q's
"liquid-cooled Speed Select" note; it clears on Clear/reset). Verified live in the browser too — served the file
through a throwaway `python -m http.server` via a new `.claude/launch.json` (`file://` loads render as a static
snapshot in the browser pane, so clicks/JS don't apply to what's on screen; a real HTTP origin is needed to drive the
UI for real) — picked DL380 G11 → G6430 and confirmed the readout renders under the field exactly as intended, and the
slip still only shows "1x G6430". Build 2026.09.23.2.

## "Paste the client's request": a thorough shorthand pass (2026-09-23, build .3)

User: with all the model-specific data now built up (rear cages, real controller/FLR-OCP lists, riser kits, boot
devices…), take another pass at the free-text box and try as many shorthand ways a trader would actually write a
build as possible — the more that gets parsed, the more a pasted client request can be run straight through the tool
and show what issues arise, without the trader re-typing it by hand. Asked for real time spent thinking through
G10/G10+/G11 shorthand, not just a couple of quick additions.

**What changed, by field:**

- **Normalisation.** The Unicode multiplication sign "×" (and "✕") — extremely common in anything pasted out of
  Word/Excel, since autocorrect turns a typed "x" into it — is now replaced with a plain "x" right at the top of
  `parseClientText()`, before any grabber runs. Every single "NxNN"-shaped regex in the file (CPU qty, memory, PSU,
  drives, cards) was silently blind to it before; none of them needed touching individually, just the one line up
  front. En/em dashes are normalised to a plain hyphen the same way.
- **System model.** A bare model number with no "DL"/"ML" at all ("380g10", "360 gen10") is now accepted — but ONLY
  when a real, known model number (built from `MODELS` itself via `bareModelNums()`, never hand-maintained) sits
  immediately against a generation mention; a bare number floating anywhere else in a build spec (a drive/memory/PSU
  figure) is never touched. The one real brand collision ("110" — DL110 and ML110 both exist) falls back to
  whichever chassis toggle (Rack/Tower) is currently selected. "10" itself is deliberately excluded from this
  fallback — it's ML10's number AND a generation digit, hopelessly ambiguous as a bare token, so ML10 stays reachable
  only by typing "ML10" in full. Also added: "gen-10" (hyphen between the word and the digit), and "10.5" — informal
  community slang for Gen10 Plus (it sits between 10 and 11) — resolving to G10+.
  **A real, pre-existing bug found and fixed along the way:** "DL380a Gen12" (the one model with a lowercase "a"
  suffix) could never resolve, in ANY casing, typed by hand or pasted. `findModelAndGen()` uppercased its ENTIRE
  match including the "a", producing "DL380A", which never string-equals the real `MODELS` entry `DL380a` (lowercase)
  in the exact-match compare a few lines later. Fixed by keeping that one suffix letter lowercase while still
  uppercasing the rest.
- **Processor quantity.** Added: the reversed order ("6248 x2", qty AFTER the code); a bare "2 CPU"/"2 CPUs"/"2
  processors"/"2 sockets" with no "x" needed at all (the word itself is unambiguous); "three"/"four" as words (for
  the real 4-socket DL560/DL580 boards); "both sockets populated"/"both CPUs" resolving to the model's own socket
  count once a model's identified (else 2).
- **Processor identification.** When no bare code matches, the existing core-count fallback is now joined by two more
  narrowing axes: an architecture/silicon name ("Sapphire Rapids", "Cascade Lake", "Genoa", "Turin", "4th Gen Xeon
  Scalable" …) mapped to the internal platform code(s) `PLATFORM_LABELS` already uses, and an exact clock speed
  ("2.1GHz" — GHz only, deliberately never MHz, since MHz is how memory speed gets written and treating a "2933MHz"
  DIMM mention as a CPU clock would misfire badly). All given axes narrow the SAME pool (also cpuAllow-checked, so the
  reported count matches what the dropdown itself would show); a pool of exactly one is picked and reported as FOUND,
  not a guess — it's exactly as certain as the client having typed the bare code, just arrived at a different way.
  Real example that lands on a unique part: "Sapphire Rapids Gold, 24 core, 2.6GHz" → G6442Y on DL380/DL360 G11, and
  nothing else. (Core+clock alone isn't always unique — e.g. 32C/2.1GHz matches BOTH G6430 and G6448Y on the same
  platform, different TDP — that stays a properly-counted CHECK, not a wrong guess. TDP-based narrowing was
  deliberately left out: CPU wattage and PSU wattage read identically as "NNNw" in free text, and disambiguating them
  reliably wasn't worth the collision risk.)
- **Memory.** `grabMem()` now also captures an explicit speed sitting next to the size ("8x32GB 2933MHz", "8x 32GB,
  2933 MT/s") — a bare "@2933" with no unit is deliberately left alone as too ambiguous. Separately, **the size
  figure itself is now restricted to the real DIMM sizes this tool actually offers** (8/16/32/64/96/128/256GB, the
  full union of `MEM_CAPS` — a genuine pre-existing latent bug: the old regex accepted ANY 1–3 digit "GB" figure in
  the "NxNNgb" shape, so a bare "8x 600GB" with no other hint would have been silently misread as 8×600GB of RAM
  instead of 8 drives, it just happened that every existing test always had a drive keyword nearby to avoid ever
  tripping over it). A bare total with no qty×size breakdown ("384GB total", "1.5TB memory") now feeds the REAL
  `#memtarget` field and fires its own input handler, so the trader gets the same live even-split suggestions they'd
  get typing it in by hand — not just a dead-end "split it manually" note like before.
- **PSU.** Added: "1+1" (redundant pair → qty 2) / "1+0" (single, non-redundant → qty 1); the reversed "800w psu x2"
  (a word between the number and the multiplier); an efficiency-tier word (Titanium/Platinum/Gold/-48VDC) now raises a
  CHECK to pick the exact matching real part from the model's own list — deliberately never guessed at directly,
  since not every tier exists at every wattage on every model and this project's whole premise is "no guessing" on
  real part numbers.
- **Storage controller(s) — the part of this request named directly.** An EXACT code straight out of the model's own
  real controller list (the same source `#ctrl` itself offers — `R.ctrl` or the generic `ctrlsFor(m)` fallback) is now
  recognised via a new generic `scanCodeList()` helper, and it's as certain as the client having typed it: FOUND, not
  a guess. Two distinct real codes in one paste fill BOTH the primary `#ctrl` field and the 2nd-controller slot the
  SAS-expander field doubles as (see the previous build's "real 2nd-controller picker" work) — first mentioned goes
  primary, second goes secondary. A single code with "dual"/"two" sitting directly against it ("dual MR416i-p")
  fills BOTH slots with that same part, flagged to confirm. A generic, unattached "add a second controller"/"second
  controller" mention with no part named at all (the exact case the user described: G11 "doesn't use expander cards,
  it uses multiple controllers... needs an 'add controller' line... without a way to select what controller") now
  gets a plain CHECK pointing at the 2nd-controller field instead of silently doing nothing OR guessing wrong. The
  older family-only fallback patterns (`P408`, `MR416`, etc., without knowing the exact suffix) are unchanged and
  still run when a model has no matching exact-list hit. Codes claimed here are tracked (`claimedCardCodes`) and kept
  out of the generic add-in-card scan later in the function, so the same mention can't ALSO show up as a second,
  unplaced "card" row.
- **FlexibleLOM/OCP.** Same `scanCodeList()` idea, tried before the older "NNNFLR" shorthand: an exact OCP mezzanine
  code straight out of the model's own real `flr` list (e.g. "BCM57414", never shaped like "NNNFLR" so the old code
  could never have matched it) is now recognised too. Also claims its code so it can't double up as a card.
- **NS204i-u** added alongside the already-supported -p/-r boot-device shorthand (this tool built NS204i-u kit
  support for G11 in an earlier pass; the paste parser had never been told about the third variant).
- **Battery.** A wattage mentioned right next to "battery"/"capacitor" (e.g. "16w cap") is now matched against the
  MODEL'S OWN real battery list when one exists and actually offers that wattage, using the real part string instead
  of the generic 96W guess. Falls back to the old generic 96W-battery guess whenever there's no wattage, no model, or
  no match (most Smart Array kits do ship the 96W one; the guess text now also mentions 16W as a possibility, not
  just 12W).
- **Bay config.** Recognises `NNEDSFF` now, not just LFF/SFF — a real, plain gap before this (Gen11's 12EDSFF/24EDSFF/
  36EDSFF front configs were never matched at all). Every bay-shaped mention AFTER the first (front bays) becomes its
  own separate rear/mid-tray line — a build can genuinely carry more than one ("8LFF front, 2SFF rear, 2SFF
  midtray"), and the old code only ever took the second mention, silently dropping a third. A mention sitting next to
  the word "midtray"/"mid-tray"/"midbay" now keeps that word on the line instead of always writing "... rear" — a
  real, if narrow, correctness bug: `evaluate()`'s own midtray-vs-rear logic (`fanW`/heatsink midtray rule) looks for
  exactly that substring, so the old blind " rear" suffix would have silently misfiled a client's stated mid-tray
  drive as a plain rear cage.
- **Diskless.** "diskless"/"no drives"/"ships with no drives"/"without drives" now checks the "No drives" box.
- **Drives.** A bare capacity with ZERO other descriptor (no speed/class/RPM/interface word anywhere nearby) now
  still adds a drive line — as long as it's shaped like a drive rather than a DIMM. TB is unambiguous (never a real
  DIMM size); a GB figure only counts here when it's genuinely NOT one of the real DIMM sizes above (a bare "4x 32GB"
  with nothing drive-ish at all stays read as memory, unchanged, deliberately conservative — still genuinely
  ambiguous and better left to a human). The bare-added line is flagged with an explicit CHECK to confirm the
  interface. Also added: RPM spelled out in full ("10000rpm" displays as "10K", same as the abbreviated form); the
  full words "Read Intensive"/"Mixed Use"/"Write Intensive"/"Value Read Optimized" mapped to their RI/MU/WI/VRO
  codes (spec-sheet language, not just the 2-letter shorthand); "U.2"/"U.3" read as an NVMe interface signal.

**A live, deliberately messy end-to-end check** (not just the QA suite) pasted a build naming a real controller, an
unnamed "add a second controller", an architecture+core+clock CPU spec, a memory speed, a PSU tier, and an EDSFF bay
count that doesn't actually exist on that chassis, all in one string. Every field the paste could reasonably fill got
filled — and every resulting real-world contradiction (wrong memory speed for that CPU, EDSFF needing NVMe not
SAS/SATA, EDSFF having no internal controller at all so the named controller can't be used, the bay count
outrunning the controller's ports) surfaced immediately as its own config check, entirely from EXISTING check logic
this pass never touched. That's the actual point of the feature working end to end: paste a client's ask, see every
real problem with it at a glance, without retyping anything by hand.

QA: 842 ok / 0 FAIL (38 new tests — one per shorthand behaviour above, plus the DL380a case-bug fix and a couple of
deliberate false-positive guards: a stray "380W" never becomes a phantom model, a bare "4x 32GB" still reads as
memory not a drive). Two real bugs were caught and fixed only by writing the tests, not by inspection: the "second
controller" phrase check originally used one OR'd condition that let a generic "add a second controller" (no part
named) wrongly fall into the "dual — same part twice" branch when exactly one real code was ALSO mentioned elsewhere
in the text; and the memory-size restriction above. Verified live in the browser too (see above) — including
discovering that this tool's own "Clear sheet" button calls `window.confirm()`, which silently auto-declines under
browser-pane automation with no human to click it (the QA harness already knew this — `w.confirm=()=>true` — a
plain page reload plus `localStorage.clear()` is the manual-testing equivalent).

**Not done / known pre-existing rough edge, not introduced by this pass:** mentioning "ilo" anywhere (e.g. for the
iLO license — "ilo advanced") also still trips the generic CARDLIST scan's "iLO dedicated NIC (already onboard)"
entry, adding a spurious, harmless card-confirmation note. This already happened before this pass (the generic
per-code CARDLIST scan is unchanged); left alone rather than special-cased, since the same class of ambiguity exists
for other short, common words in that same generic list and fixing it properly wants a broader look at that scan,
not a one-off patch. Build 2026.09.23.3.

## Full-rundown step 1: close the DL360/DL380 gaps across G10, G10+ and G11 (2026-09-23, build .4)

User asked where the project stands and what still needs the "DL360/DL380 treatment". The answer was a per-model
matrix (only DL360/DL380 G11 had everything; G10/G10+ DL360/DL380 were close; most other models have only PSU/
controller/FLR part numbers or chassis facts). Step 1 of the agreed order was to finish the DL360/DL380 family first.
Sources: DL360 G10 V74 + V32 (Apr 2020) PDFs, DL380 G10 V77 PDF, DL360/DL380 G10+ V44/V42 PDFs (all `pdftotext -table`,
which pairs name/part-number columns cleanly — `-layout`/`-raw` shift the PN column in several of these tables), DL380
G11 V47 text (current) + V11 PDF (used only to pair bundle/cable-kit names with part numbers; PNs don't change).

**G10 memory kits (`DIMM_KITS.sp1`/`sp2`, `dimmKits` on DL360/DL380 G10).** Both docs: a 1st Gen processor takes only
the DDR4-2666 kits, and the 2666 kits are only supported with 1st Gen — so sp1 = 2666 kits, sp2 = 2933 kits. The
current docs list only the 8-64GB 2933 RDIMMs; 128GB and every 2666 kit come from the older snapshots. A third tuple
element names the alternate kit of the same size (single-rank / LRDIMM / 3DS). The Gen11 even-DIMM-quantity check no
longer fires on sp1/sp2 (the Gen10 docs have no such rule; only "no RDIMM/LRDIMM mixing"). **Fix found on the way:**
the kit hint said "swap -B21 for -F21" for every platform — no DDR4 doc (G10 or G10+) lists any -F21 part, so that
suffix is now shown for sp4/sp5 only.

**G10 stand-up cards (`G10_NIC_CARDS`/`G10_FC_CARDS`, `DL360G10_CARDS`/`DL380G10_CARDS`).** DL360 V74 has pruned the
Ethernet list to 2 cards, so the list is the current doc unioned with DL360 V32. The DL380's older docs extract with
shifted PN columns (confirmed: several adjacent PNs rotated by one line), so an older card is listed for the DL380
only if its PN appears in the DL380's own older doc AND a clean table names that PN. DL380-only: MCX512F, X2522, the
Universal SATA M.2 AIC enablement kit 878783-B21. Both: NS204i-p (P12965-B21, no fan requirement on Gen10 — unlike
G10+), Pensando DSC-25, 200Gb HDR card with its mandatory aux card P06154-B23.

**Rails / bezel / intrusion / iLO hints** for DL360/DL380 G10 and G10+ (new `intrusion` rule key, shown in the bezel
hint). iLO: DL380 G10's doc names the Advanced Premium Security Edition (no PN), the other three list Advanced only
(`iloNoPremium`).

**Bug fixed: DL360 G10 rear option "2x M.2 (dual uFF) rear (867978-B21)".** 867978-B21 is the SATA M.2 2280 *primary
riser* (2x M.2 on the riser, no slot lost). Both rear options (1SFF or dual uFF) are the one rear kit 867972-B21
("1SFF Rear SAS/SATA/UFF Backplane Kit"). Relabelled; the note explains the two parts.

**DL380 G11 EDSFF bundle (`edsffBundle`).** V47: the EDSFF cage is direct-attach only and needs a factory EDSFF bundle
(36EDSFF P56075-B21 / 20EDSFF P56076-B21, 20 drives max), the 12EDSFF CPU1/2 Cable Kit P52153-B21 and 2x 12EDSFF NVMe
kits (no PN given). Checks: info line with the kits; stop on 1 processor; stop on a tertiary riser; stop on >16 x 256GB
DIMMs; forces the High-Performance Fan Kit. Intrusion Cable Kit P48922-B21 (required with Trusted Supply Chain) added.
**Per-backplane cable kits: not buildable from QuickSpecs** — V47 only lists the cable kits, it never says which
backplane needs which. The list (with PNs) is a model note pointing at the HPE cabling guide instead.

QA: 867 ok / 0 FAIL (25 new tests; 2 older tests that used DL380 G10 as the "model with no own rail/card data" example now use DL385 G10). New tests cover: kits per CPU generation, alt kit, no odd-count flag on G10, G10+ still flagged,
8 model/bay rail+bezel+intrusion+iLO combos, card lists incl. a one-PN-one-name uniqueness check, the rear fix, all
EDSFF bundle checks). Still open for DL360/DL380: `-001` spares (not in QuickSpecs), DL360 G11 has no bezel PN in
its doc. Next per the agreed order: the G10+ AMD family. Build 2026.09.23.4. (`.claude/launch.json` now runs a small Node static server, `.claude/serve.js` — python is not installed on this machine.)

## Full-rundown step 3: remaining G10 Intel racks — DL560/DL580/DL160/DL180/DL20 G10 (2026-09-23, build .5)

User moved AMD to the back of the queue ("99% of the servers we deal in are intel") and asked for step 3. Sources:
DL560 G10 V19 text (final revision) + V1 PDF; DL580 G10 V20 text + V16 PDF; DL160/DL180 G10 mid-life mirrors (raw,
single-space rows — cleanly aligned) + current V32/V35; DL20 G10 mirror + V25; ML30 G10 mirror + V24.

**Method for card/option part numbers (reusable for every remaining model).** Several texts have shifted PN columns
(DL560 V19, DL580 V20, DL20 V25, DL160 V32, DL180 V35 all print whole blocks of adapters one row off — e.g. DL560 prints
"SN1200E 16Gb 1p Q0L11A", which is the SN1600E's PN). So: product NAMES come from the model's own doc (which cards it
offers); PART NUMBERS come from a name→PN map built only from `pdftotext -table` extractions (13 PDFs, no adapter name
maps to two PNs; PNs with two names are just old-marketing vs chip naming). Chip-name aliases (X550-AT2 = 562T
817738-B21 etc.) were admitted from the DL160 mirror only after all 9 of its cross-checkable rows agreed exactly.
New helper `g10Cards(pns, extra)` filters the step-1 G10 master lists by PN, so every model shares one label per PN.

**Per model:** DL560/DL580 — 36 doc-listed adapters + Universal SATA M.2 kit 878783-B21, shared sp1/sp2 memory kits,
batteries, rails (DL560: easy-install 733662 + CMA 733664 or ball-bearing 720864 + CMA 720865; DL580: 4U kit 872151-B21
with the CMA included — new `rails.cmaIncluded`), DL580 4U bezel 869872-B21 (+ OEM 869873-B21), intrusion 867824-B21;
DL560's docs give no bezel/intrusion PN (bezelNote says so). DL160/DL180 — `cpuAllow` from their own docs (57/56;
DL160 adds Platinum 8164), 23/22 cards (only DL160 has OP101), per-model kit tables (`dimmKits` can now be an object
keyed by platform) and new `memCaps` (module sizes the doc lists: 8-64GB, no 128GB; DL160 lists no LRDIMM at all, so
1st Gen + 64GB on DL160 is flagged — no 2666 64GB kit exists for it), rails/CMA, bezel/lock, intrusion, redundant fan
kit PNs, Media Module adapters (in the notes — they use an on-board connector, not a PCIe slot). DL20 — see below.

**Real errors found and fixed.**
- **xeone platform (DL20 G10 + ML30 G10):** the tool offered 32GB modules and a 128GB ceiling; both docs say 8GB/16GB
  UDIMM only, 64GB max (4 x 16GB). `MEM_CAPS.xeone` → [8,16], `MEM_PER_SOCKET.xeone` → 64, kits 879505/879507-B21.
- **xeone CPU pool:** had 6 SKUs, 3 of them (E-2124/E-2136 fine — the DL20 doc confirms E-2100 support, since retired —
  but E-2288G) in neither model's doc, and was missing 8 real ones (E-2226G/2234/2244G/2274G/2278G/2286G, Pentium G5420,
  Core i3-9100). Added the 8 (specs from DL20's aligned table; ML30 V24's TDP column is shifted), and gave both models
  a `cpuAllow` (DL20 13, ML30 11 — E-2278G/E-2286G are DL20-only). Pentium/i3 codes keep their brand prefix so they
  never read as a Xeon Gold code. Both run memory at 2400 (`CPU_MEM_MAX`).
- **DL20 battery:** it takes the 12W Smart Storage Battery 782961-B21, required with P408i-a/P408e-p (new `batReq`
  verify). The cached-controller suggestion said "96W battery" for every model — it now names the model's own first
  battery when that isn't a 96W one.

QA: 886 ok / 0 FAIL (19 new). Verified in the browser (DL20 G10 end to end via the paste box). Still open on these:
DL20 G10 riser count shows "not confirmed" (pre-existing); -001 spares. Next per the agreed order: G10+ Intel
(DL20/DL110/ML30 G10+), then the other G11 Intel models, towers, G12; AMD and G9 last.

## G10+ Intel: DL20 / DL110 / ML30 Gen10 Plus full rundown (2026-09-23, build .6)

Sources: DL20 G10+ V7 and ML30 G10+ V9 PDFs (`-table`, clean), DL110 G10+ V18 text (current) + V1 PDF; current DL20 V24 /
ML30 V22 texts checked for list changes (none) but NOT used for values — their processor tables are badly scrambled
(V24 gives the Pentium G6405 6 cores). Same names-from-own-doc / PNs-from-clean-tables method as build .5, via a new
`g10pCards(pns, extra)` helper over the DL360/DL380 G10+ card lists.

- **xeone3 CPU pool (DL20/ML30 G10+) had 4 of the 11 processors both docs list** — added E-2324G, E-2334, E-2374G,
  E-2378, E-2378G, E-2386G, Pentium G6405 (2666 memory), and `cpuAllow` on both. UDIMM kit PNs P43016/P43019/P43022-B21.
- **DL20 G10+:** cards (9 NICs + 8 FC + NS204i-p + M.2 AIC); the NS204i-p is not supported with the Pentium (new
  `ns204pNoCpu` stop); 12W battery 782961-B21 required with P408i-a/P408e-p (`batReq`); rail/bezel/intrusion/latch-ear.
- **DL110 G10+:** doc lists 8-128GB only and 1TB max — the tool allowed 256GB and a 4TB ceiling (`memCaps`,
  `memPerSocket:1024`). Stand-up cards: the V18 text prints no PNs for them at all; 8 resolved from clean tables, two
  newer Intel cards (E810-XXVDA4T GNSS, E810-2CQDA2) are listed WITHOUT a part number rather than guessed. Rail kit
  P50427-B21 needs the ear kit P50420-B21 (`rails.note`). iLO Advanced only.
- **ML30 G10+:** the 95W E-2386G/E-2388G need the High Performance Heat Sink Kit P45221-B21 (`hsW:95`); battery needs
  the holder kit 786710-B21; rack option = tower-to-rack kit 874578-B21 (CMA included); bezel key-lock is standard.

QA: 901 ok / 0 FAIL (15 new). Verified in the browser (ML30 G10+ with E-2388G). Small pre-existing oddity noticed, not
changed: tower slips say "No bezel" even where the doc says the bezel is standard.
