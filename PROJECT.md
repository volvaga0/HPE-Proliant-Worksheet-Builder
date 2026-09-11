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
  lives in the description. ~335 seeded processors. Gen9 v3 and v4 are
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
- **`attachList(input, listFn)`** — upgrades the former datalist text
  inputs (memory, controller, battery, PSU, FlexibleLOM, expander, bays,
  rear, and the drive `cap` / card `name` / riser `name` line inputs) to a
  real tap-to-pick dropdown via one shared floating `#ac-panel`. `<datalist>`
  on iOS only shows ~3 hints on the keyboard bar and no dropdown, which read
  as "broken" to users. Free typing still works — the list is suggestions.
  `listFn` returns a `string[]` (or a function for the model-dependent ones);
  entries starting with `—` render as non-selectable dividers. Selection is
  `pointerup` (movement < 12px = a tap, not a scroll) + a `click` fallback.
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
- **Picking a value implies a count** — selecting a CPU sets the processor
  count to 1 (min valid); selecting a PSU wattage sets the PSU qty to 1.
  Both only fire when the count is still blank.
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
- **Picking a storage controller implies a battery choice** — most Smart
  Array RAID controllers ship the 96W Smart Storage Battery; the
  cache-less HBAs / software RAID (`H240`, `H241`, `B140i`, `S100i`) need
  none. Only fills `#bat` when it's still blank.
- **Dropdown-driven qty defaults to 1** (`autoQty(row, keyAttr)`) —
  drive/card/riser line rows call this on their capacity/name field, so
  picking (or typing) a value with the qty still blank sets it to 1. Same
  idea as "picking a CPU/PSU implies a count", generalised to every
  repeatable line and to cards added by the paste parser.

## Verification status (as of this handoff)

**Fully verified against real QuickSpecs — the core ask ("all DL360 and
DL380 models verified") is met:**
- DL360: Gen9, Gen10, Gen10 Plus, Gen11
- DL380: Gen9, Gen10, Gen10 Plus, Gen11
- (Gen12 for both is NOT verified — there's no QuickSpecs data to verify
  against yet, since HPE hasn't published Xeon 6 processor kits. This
  isn't a gap in effort, it's a gap in what exists to check.)

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
- **Still to do:** ML10 / ML30 / ML110 / ML150 Gen9, ML30 / ML110 Gen11,
  ML350 Gen12; re-check the ML350 Gen11 slot map against its own QuickSpecs.

**Removed — HPE never made these:**
- DL580 Gen11 (the 4-socket line went DL580 Gen10 → DL580 Gen12)
- DL560 Gen10 Plus, DL580 Gen10 Plus (no Ice Lake 4-socket server)

**Still generation-default / cooling-unverified** (amber badge in the UI):
- DL20/60/80/120, DL110, DL320, DL340 across generations
- DL345/DL365 Gen10 Plus (Milan)
- ML110, ML30, ML150, ML10, ML350 Gen9
- All of Gen12 (Xeon 6 — no processor data exists yet to verify against)

## Known limitations, stated plainly

- Socket count (`s`) and DIMM slot count (`d`) for models I HAVEN'T
  explicitly verified come from general HPE product specs, not
  QuickSpecs read alongside the cooling data. They're very likely right
  for mainstream models but haven't been individually confirmed.
- The paste parser is best-effort text matching, not NLP. It won't
  resolve ambiguous controller suffixes (P408 could be i-a or i-p) — it
  guesses the common one and flags it as a CHECK item rather than
  silently picking.
- `riserMax` is set on the DL360/DL380 line plus DL560/DL580 Gen10,
  DL560 Gen11, DL325/DL345/DL365 Gen11. Others still have no riser cap —
  not because it's unlimited, the number just isn't sourced yet.
- `psuMax` / `fans` / `pcie` cover the DL360/DL380/DL560/DL580 lines,
  DL325/DL345/DL365 Gen11, DL385/DL325 (2U/1U AMD), DL160/DL180 Gen10
  and ML350 Gen10/11. Everything else: PSU qty is uncapped (soft "not
  verified" prompt over 2), no fan auto-count, no card-slot check.
- The "fans not tied to CPU wattage" finding is specific to plain Gen9
  and Gen10 DL360/DL380 — don't assume it generalizes to every
  unverified model; it was confirmed by direct QuickSpecs text, not
  inferred.

## Priority order for continuing verification

Given refurb volume is likely rack-server-heavy: DL385/DL325 remaining
gaps (DL345/DL365 Genoa), then DL560/DL580 Gen11, then the ML tower line,
then the entry-level DL20/60/80/110/320/340 family. Gen12 can wait until
HPE actually publishes Xeon 6 QuickSpecs — there's nothing to verify yet.

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
