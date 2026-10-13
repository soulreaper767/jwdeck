# JW Dash

Consolidated financial reporting for JW Group. Companies file weekly and monthly key figures in **their own reporting format**,
and the system consolidates them into **standard group heads** across clusters and the whole group.

## Run it

Requires Node.js 22.13+ (uses the built-in `node:sqlite`, so there is no database server to install).

```bash
npm run setup      # install everything and load demo data
npm run build      # build the web UI
npm start          # http://localhost:5050
```

For development with hot reload: `npm run dev` (UI on http://localhost:5173, API on :5050).
`npm run reseed` wipes the database and reloads the demo group.

Demo logins:

| Role | Email | Password |
|---|---|---|
| Group Finance (admin) | admin@jwdash.local | admin123 |
| Executive (whole group) | ceo@jwdash.local | ceo123 |
| Cluster head (Textiles) | textiles@jwdash.local | tex123 |
| Company user (Spinning) | spinning@jwdash.local | spin123 |

## How it fits together

- **Company tree**: one group, then clusters (which can nest), then companies. Companies are the units that report.
  Each company has its own reporting currency.
- **Group heads**: the standard chart everything consolidates into. Types:
  - *input*: company lines map here
  - *group*: sum of sub-heads
  - *formula*: e.g. `GP / REV * 100`
  - *section*: display grouping only

  Each head also has a *nature*: flow (summed over periods), balance (closing value) or average.
  Formula and group heads are recalculated **after** consolidation, so margins and ratios are correct at every level.
- **Reporting formats**: per company and per frequency. The company keeps its own labels, ordering, headings and subtotal
  formulas. Each figure line maps to one input head, with an optional sign flip. A mapping matrix shows every company's
  line behind each head.
- **Filing**:
  - A company saves a draft, then files. Filing writes an immutable snapshot, which locks the figures.
  - Consolidation and comparatives read **only** locked filings.
  - Group Finance can reopen a filing with a reason. The previous revision stays in use until the company refiles, and every revision is kept.
- **Comparatives**: previous period and same period last year, always from the last locked filing. *Like-for-like*
  (on by default) restricts comparatives to companies that have filed the current period, so a late filer doesn't look like a drop.
- **Views**: Month / QTD / YTD (fiscal year configurable) or Week / MTD.
  - The dashboard has KPI tiles, trend vs last year, and contribution by unit.
  - The consolidated statement drills from the group to clusters to companies, then down to the company's own lines.
  - Company reports show each company in its own format.
  - The filing status board flags overdue companies against due-day settings.
- **FX**: monthly rates per currency, translated to the group currency. Counts such as headcount are not translated.
- **Access**: admin (everything), executive (view, optionally scoped), cluster head (view and file for their cluster),
  company user (file and view own company). Every change is in the audit log.

## Layout

```
server/  Express API + SQLite (server/data/jw_dash.db)
  src/consol.js    consolidation engine (tree, heads, FX, period aggregation)
  src/periods.js   monthly 'YYYY-MM' and ISO weekly 'YYYY-Www' period maths
  src/formula.js   safe formula parser used by heads and company subtotals
  src/routes/      auth, tree, heads, formats, entry (filing), consol (reports), admin
client/  React (Vite) + Recharts UI
```
