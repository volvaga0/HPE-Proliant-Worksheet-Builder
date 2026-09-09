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
`position:fixed` with `z-index:900` and `body` reserves `92px` of
bottom padding so form content clears it.

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

- **`CPUS`** — `[code, description, platform, TDP watts, cores]` for every
  seeded processor

- **`PLATFORM_LABELS`** — display names for the CPU dropdown's group
  headers (e.g. `sp2` → "2nd Gen Xeon Scalable — Cascade Lake")

- **`MEM_PER_SOCKET`** — max GB per socket by platform, used for the
  memory-ceiling check

### Rule keys (documented in a comment block right above `GEN_DEFAULTS`)

```
hsW / hsWtext     TDP at/above this → performance heatsink
hsSku             codes that always ship performance heatsink
hsStdException    codes that ship STANDARD despite exceeding hsW
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
rearMaxW          rear drives unsupported above this CPU wattage
rear2SFF          bay configs a 2SFF rear cage is allowed on
coolTierW         dual-socket TDP at/above which air cooling is unsupported
singleMaxAirW     air-cooled TDP that is single-socket only
liquidReqW        TDP at/above which liquid cooling is mandatory, any socket count
validCounts       the only CPU counts a board actually supports (e.g. [1,2,4] — DL560 Gen10 skips 3)
riserMax          physical riser positions (hard cap on the input, not just a warning)
psuMax            power supply bays (hard cap on PSU qty). Only set where confirmed —
                  DL360/DL380/DL385/DL325/ML350 = 2 (dual Flex Slot). DL560/DL580 left
                  unset pending a QuickSpecs recheck (2 vs 4).
fans              {one,two,perf} standard fan count for 1 CPU / 2 CPUs and the
                  high-performance kit count. Auto-fills the fan qty and drives the
                  "standard is fine because…" note.
pcie              {one,two} add-in-card slots with 1 CPU / 2 CPUs (secondary+tertiary
                  risers need CPU 2, so the 1-CPU number is much smaller). FlexibleLOM
                  is NOT counted — separate connector.
memPerSocket      override for max GB per socket
hsPart/fanPart    HPE option part numbers, shown in check text
notes             model caveats. Shown filtered: `noteRelevant()` hides a note
                  until at least one thing it names (a bay config, NVMe, rear/
                  midtray drives, a GPU, 24G SAS, a 3-/4-processor build) is
                  actually selected. Notes that name none of those always show.
verified          true = checked against THIS model's own QuickSpecs
```

Riser-kit lists live in the separate **`RISERS`** map (keyed `"MODEL GEN"`),
lifted from each model's QuickSpecs "Riser Information" table — currently
DL380 Gen10 (full) and DL360 Gen10. Models without an entry fall back to
`GENERIC_RISERS` hints. The `#riser` field is a datalist fed from whichever
applies. Filling out `RISERS` / `fans` / `pcie` / `psuMax` for the rest of
the verified fleet is the obvious next job — it needs the clean QuickSpecs
tables (search-scraped text mangles the part-number columns; get the PDFs).

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

- **Combobox** (`setupCombo()`) — generic searchable dropdown used for
  both System model and Processor. Type-to-filter, grouped headers
  (generation for models, platform for CPUs), keyboard nav.
- **Paste-to-fill** (`parseClientText()`) — regex-driven best-effort
  parser for pasted client text. Reports FILLED / CHECK (guessed) /
  SKIPPED so the trader knows what to verify. Never silently guesses a
  consequential field (e.g. ambiguous controller suffix gets a CHECK
  flag, not a silent fill).
- **Capacity planner** — enter usable TB + RAID level, get up to 5
  drive-population suggestions ranked by least wasted capacity, with a
  one-click "Use" that drops the line into the drive list.
- **Repeatable lines** — drives and PCI cards are add/remove line lists,
  not fixed fields.
- **Spec slip** — plain-text output on the right, copy-to-clipboard
  button, matches the shorthand format the traders already use
  (`2x S4110`, `8LFF + 2SFF`, etc.).
- **"Standard" defaults are shown, not omitted** — Backplane defaults to
  "SAS/SATA backplane", TPM to "No TPM", Motherboard to "Standard
  motherboard", Media bay to "No media bay", Bezel to "No bezel" — all
  pre-checked radios with real (non-empty) values, so the slip always
  states these explicitly instead of going silent and needing a
  follow-up question to the trader. Rails and HP-authenticated-memory
  are deliberately NOT defaulted — those are consequential enough that
  silence should stay a visible gap, not get papered over.

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

**Corrected data errors found along the way:**
- AMD per-socket memory ceilings were wrong (Rome was 4096GB, should be
  2048GB; Genoa was 6144GB, should be 3072GB) — fixed, and the memory
  check is meaningfully stricter now as a result.

**Verified in the Sept 2026 hardware-data pass (PSU bays / fan counts /
PCIe slot counts / riser positions, from each model's own QuickSpecs —
cooling thresholds separately noted per model):**
- DL560 Gen9 (2 PSU, 6 fans, 4→7 PCIe), DL580 Gen9 (4 PSU, 4 fans,
  9 PCIe, 96 DIMM via 8 cartridges, 2-proc minimum)
- DL560 Gen10 (4 PSU, 6 fans, 3→8 PCIe, riserMax 3),
  DL580 Gen10 (4 PSU, 12 fans, 6→16 PCIe, riserMax 3)
- DL560 Gen11 (4 PSU, 6/5 HP fans air/liquid, 6 PCIe + 2 OCP, 150W
  heatsink step, 4P = liquid-cooling only) — now `verified:true`
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
- **ML30 Gen10, ML110 Gen10, ML30 Gen10 Plus** — now `verified:true`. All
  single-socket entry towers: 2 fixed non-hot-plug fans (no kit choice),
  psuMax 2 (single ATX standard, Flex Slot pair needs an RPS kit), riserMax 1.
  ML30 = 4 UDIMM / 4 PCIe; ML110 = 6 DIMM / 5 PCIe.
- **ML350 Gen9** — hardware verified (4 PSU bays, 3→5 fans + redundant fan
  kit 725878-B21, 9 PCIe, 24 DIMM); left `unverified` because the QuickSpecs
  has no processor-specific heatsink step (v3/v4 share one heatsink).
- **ML350 Gen10 / Gen11** — already fully verified.
- **Still to do:** ML10 / ML30 / ML110 / ML150 Gen9, ML30 / ML110 Gen11,
  ML350 Gen12.

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
