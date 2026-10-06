# GCC Registry (ฐานข้อมูลลูกค้า GCC)

React + Vite + TypeScript implementation of the Claude Design prototype
`project/GCC Registry.dc.html` (plus its map, `project/GCC Map.html`).

## Run

```bash
cd app
npm install
npm run dev        # http://localhost:5173
npm test           # unit tests (run against the real dataset in ../project/data)
npm run build      # static site in dist/ — deploy to any static host
```

`npm run dev` / `build` first run `scripts/sync-data.mjs`, which copies the datasets from
`../project/data` (single source of truth; also what `project/tools/tgo-sync.mjs` updates)
into `public/data/` (git-ignored). The build uses relative paths, so `dist/` works from any
sub-path (GitHub Pages, Netlify, Cloudflare Pages…). Like the prototype it must be served over
HTTP — opening `index.html` from disk will not load the data.

## Structure

| Path | What |
| --- | --- |
| `src/lib/core.ts` | Port of `gcc-core.js`: data loading, dedup (union-find), CFO/GI status and target-group rules, Excel importer |
| `src/lib/engine.ts` | `GccEngine` — dataset + CRM state, recalculation for the reference date, renewal rounds, status monitor, TGO sync, upload, backup import/export. React subscribes via `useSyncExternalStore` |
| `src/lib/search.ts` | Search-tab filtering (company / certificate views) |
| `src/lib/storage.ts` | **All persistence.** IndexedDB (`gcc-registry` / `kv`) + localStorage, same keys as the prototype so existing browser data carries over. Swap these implementations to move to a shared database |
| `src/lib/tgoSync.ts` | Port of `tgo-sync.js` (reads the TGO CFO list through a CORS proxy) |
| `src/state.tsx` | UI state (tab, filters, drawer, modal, dashboard cross-filters) and navigation helpers |
| `src/tabs/*` | One component per tab: Overview, Search, Track, Plan, Map, Dedup, Update, Notes |
| `src/components/*` | Header + banners, company drawer, scheduling modal, shared UI bits |

The design's "Tweaks" (rows per page, row density, default soon-window) are in `CONFIG` in
`src/lib/constants.ts`.

## Differences from the prototype

- The map is a native React/d3 component instead of an iframe + `postMessage`; it uses the
  header's reference date and the full company data (including manual contact edits).
- When the day rolls over while the page is open and the reference date was "today", it moves
  to the new today (as described in the design chat).
- Fixed two prototype bugs: completing a task from the plan list threw (`B` undefined), and
  source-detail rows in the company drawer rendered an undefined field — they now show the
  organisation, activity, key dates and the scope 1–3 bar.
