# Northstar — Personal finance workspace

Northstar is a responsive, local-first personal finance manager for tracking transactions, planning budgets, monitoring subscriptions, understanding spending patterns and building savings goals. It is intentionally designed as a calm, premium dashboard rather than a spreadsheet.

## Run locally

This workspace is a no-build static application. Serve it from this folder so browser modules, local storage and the Google Fonts request work consistently:

```bash
python3 -m http.server 4173
```

Open <http://localhost:4173>.

## Included flows

- Persistent local demo workspace with seeded accounts, transactions, budgets, subscriptions, goals and generated insights.
- Local account creation and sign-in using browser storage and a SHA-256 password hash. The demo workspace is available immediately on first load.
- Add, edit, search, filter and delete transactions with automatic category suggestions.
- Add monthly budgets, recurring payments, savings goals and goal contributions.
- Dashboard metrics, cash-flow visualization, category spend chart, activity feed and smart recommendations.
- Environmental risk screening: geocode a place, compare NASA GIBS satellite imagery across two dates, load Open-Meteo weather/river context and generate flood, heat-island and vegetation-change screening signals.
- JSON workspace export, reset-to-demo controls, responsive mobile navigation, reduced-motion support and keyboard shortcut `⌘/Ctrl + K` for search.

## Important product note

Because this repository has no backend or package manifest, authentication and persistence are local-first rather than server-backed. Data stays in the current browser origin and is not encrypted, synced between devices or suitable for real financial credentials. Environmental risk reports use public Open-Meteo model/reanalysis context and NASA GIBS rendered imagery directly from the browser. They are screening-only outputs, not official flood warnings, property-level assessments, calibrated heat-island measurements or vegetation diagnoses. A production deployment should replace the local auth layer with a managed identity/database service, server-side authorization, encrypted transport, backups and server-side provider orchestration.

## Main files

- `index.html` — application shell, navigation and auth surface
- `styles.css` — responsive design system, dashboard cards, charts, tables and modals
- `script.js` — local auth, persistence, calculations, routes, rendering and event flows
