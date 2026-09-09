# HPE ProLiant Worksheet Builder

A single self-contained HTML tool that traders fill in when they sell a machine,
so engineers get a correct, buildable spec instead of a vague request.

**Live:** https://volvaga0.github.io/HPE-Proliant-Worksheet-Builder/

## Files

- `index.html` — the tool (single self-contained file: HTML + CSS + JS)
- `worksheet-qa.js` — headless regression tests (`npm install` then `npm test`)
- `PROJECT.md` — full handoff notes: architecture, rule keys, model verification status

## Updating

Edit `index.html`, run `npm test`, commit and push. GitHub Pages redeploys
automatically, so traders always get the current version when they reload the page.
