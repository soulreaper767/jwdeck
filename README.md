# JW Dash

Weekly (Monday) and monthly management reporting for JW Group.

- **Consumer Global Cluster:** Pakistan Holstein, Royal JW Foods, Royal JW Buffalo, JW Al-Arabia
- **Supply Chain Cluster:** EPS Packages, JW Packages

There are two ways to run it:

- **Server (hub):** the web app on a server. It works in any browser, on desktop and mobile.
- **Windows desktop app:** a full local copy with its own database. It works offline and syncs with the hub automatically.

## Server

Requires Node.js 22.13 or later. The database is built-in SQLite, so there's nothing else to install.

```
npm run setup        # install, build, load the clean structure
npm start            # http://localhost:5050
```

| Command | Effect |
|---|---|
| `npm run seed` | Wipes the database and loads the clean structure: companies, reporting lines and users. No figures. |
| `npm run seed:demo` | Same as `seed`, plus sample SKUs, opening balances, budgets, and weekly and monthly reports at different workflow stages. |
| `npm run dev` | Hot reload: UI on :5173, API on :5050. |

To put it on a server, run `npm start` behind HTTPS (nginx, IIS or similar) and point desktops at that address.

## Windows desktop app

```
npm run desktop:install   # once
npm run desktop:build     # → desktop/release/JW Dash Setup 1.0.0.exe
```

1. Install with `JW Dash Setup 1.0.0.exe`.
2. On first launch, enter the server address and a user's email and password. The app downloads that user's companies, people, budgets and history.
3. From then on:
   - Sign-in, entry, calculations and approvals work without internet.
   - The app syncs every 30 seconds, and right after every save.
   - The bar at the bottom of the window shows the sync state and how many changes are waiting to be sent.

How conflicts are handled:

- The hub's workflow decisions (approvals, reopens) take precedence over offline edits.
- A newer submission made offline is accepted.
- Figures entered offline after the Monday 11:00 cut-off are kept as a draft. Once the group reviewer reopens the week, they can be submitted and synced.

## Users (demo password `demo123`)

| Role | Login |
|---|---|
| Administrator | admin@jwdash.local / admin123 |
| Executive (view) | ceo@jwdash.local / ceo123 |
| Group reviewer | group.reviewer@jwdash.local |
| Cluster reviewer | cgc.reviewer@, scc.reviewer@jwdash.local |
| Company DPO | phl.dpo@, rjf.dpo@, rjb.dpo@, jwa.dpo@, eps.dpo@, jwp.dpo@jwdash.local |
| Company reviewer | phl.reviewer@, rjf.reviewer@ … jwp.reviewer@jwdash.local |

What each role can see:

- Company users see only their own company.
- Cluster reviewers see their cluster or clusters. A user can be given more than one.
- Group users see everything.

## Reporting

**Weekly (Monday):**

- **Packs:** Revenue & Recoveries; Production & Sales by SKU; Payments & Cash Position.
- **SKU totals:** per SKU, then totals per unit, then grand totals across all units and total sales value.
- **Every line shows:**
  - Week, MTD and YTD, each with target, actual, variance and variance %.
  - Any prior-week adjustment, with a mandatory reason.
  - An MTD reconciliation: previously reported + this week, compared with now, with any difference flagged.
- **Cash** rolls forward on its own from the opening balance.
- **Month-end weeks** split into two portions: the first closes the old month, the second opens the new one.
- **Cut-off:** a week's entry closes at 11:00 the following Monday, Pakistan time (configurable). An unsubmitted week becomes *Lapsed* and counts as no figures; any saved figures are kept. A week that contains a month end stays open until that month's close is submitted.

**Monthly (month close):**

- The full P&L (company enters cost of sales, expenses, depreciation, finance cost and tax) and the cash flow statement.
- Sales, recoveries, payments, cash and volumes compile automatically from the weeks, including the last partial week and its adjustments.
- There are no adjustments at month close. Once a month is submitted, its weeks are locked.
- P&L figures above company level are like-for-like: they include only companies that have submitted month close.

**Levels:** each report starts with the summary for the selected level (group, cluster or company), then lists its clusters or companies. Clicking a unit drills into it.

**Workflow (weekly and monthly):**

1. The DPO submits.
2. The company reviewer approves.
3. The cluster reviewer approves.
4. The group reviewer approves.

Only the group reviewer (or an admin) can reopen a report, lapsed or submitted, for entry. Reopened reports carry an **R** mark from then on, and every step is kept in the trail.

**Budgets:** an annual figure per line. Month-specific amounts go in their month and the rest is spread by days. Weekly, MTD and YTD targets come from that automatically.

**Profiles:** group, cluster and company profiles hold the logo, description, nature of business, entity type, start date, registration numbers and contacts.

**Display:** figures are entered in full rupees. Reports show millions by default, with a toggle to full figures, and hovering any figure shows the full amount. The layout works on mobile.
