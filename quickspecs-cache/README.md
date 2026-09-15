# QuickSpecs text cache

Extracted plain text from official HPE QuickSpecs PDFs, kept so a future verification pass doesn't have to re-fetch and re-extract a document this project already sourced — hpe.com itself is slow/blocks direct fetches, mirrors go stale, and every model-compatibility audit this project has done so far had to re-discover a working mirror from scratch. This directory exists so that stops happening.

**What's in here:** one `.txt` per model+generation, produced with `pdftotext -raw` (or `-layout` where a table needed it — noted in MANIFEST.md when that's the case) from the actual QuickSpecs PDF, not a paraphrase or a reseller's marketing page.

**What's NOT in here:** the raw PDFs themselves. They're 1-2MB each and add nothing a grep can't get from the extracted text — keeping only the text keeps this cache small enough to live in git.

## Using the cache

Before fetching a model's QuickSpecs again, check `MANIFEST.md` for an existing entry. If one exists:
- Grep/read the cached `.txt` directly — don't re-fetch.
- Only re-fetch if the manifest's doc version looks old enough to doubt (HPE does revise these — e.g. a doc gaining a new CPU generation), or if the question you're answering needs a page/section that a prior pass didn't extract cleanly.

After fetching a new one:
- Save the extracted text as `<MODEL>-<GEN>.txt` (e.g. `DL380-G11.txt`, `DL325-G10+.txt`, `DL325-G10+v2.txt` for the AMD Milan refresh — match the tool's own `m.g` string, replacing `/` and spaces with nothing, `+` kept literal).
- Add a row to `MANIFEST.md`: model, gen, doc ID (from the PDF's own footer if it has one), doc version/date, the URL/mirror actually used, the date this session fetched it, and the extraction method (`-raw` vs `-layout`) if not the default.

## A cache entry is a snapshot, not a live source

HPE revises QuickSpecs (new CPU tiers get added, part numbers change). Treat a cached file as "what the doc said as of the fetch date in MANIFEST.md" — if something you're checking seems to contradict what's already coded in `index.html`/`PROJECT.md`, and the cached doc is more than a few months old relative to when the code was last touched for that fact, re-fetch and diff rather than trusting the cache blindly.
