# JW Dash

Weekly (Monday) and monthly management reporting for JW Group.

JW Group
- Consumer Global Cluster: Pakistan Holstein, Royal JW Foods, Royal JW Buffalo, JW Al-Arabia
- Supply Chain Cluster: EPS Packages, JW Packages

## Run

Node.js 22.13+ (built-in SQLite, nothing else to install).

```
npm run setup        # install, build, load the clean structure
npm start            # http://localhost:5050
```

| Command | Effect |
|---|---|
| `npm run seed` | Wipe and load the clean structure: companies, reporting lines, admin + CEO logins. No figures. |
| `npm run seed:demo` | Same, plus sample SKUs, opening balances, budgets and weekly reports from W27 2026. |
| `npm run dev` | Hot reload: UI on :5173, API on :5050 |

Logins: `admin@jwdash.local` / `admin123`, `ceo@jwdash.local` / `ceo123`.
Demo also has `holstein@`, `foods@`, `buffalo@`, `arabia@`, `eps@`, `packages@`, `consumer@`, `supply@jwdash.local` / `demo123`.

## Reporting packs

1. **Revenue & Recoveries**: sales (from SKUs) + other revenue = gross revenue; less returns, discounts & rebates = net revenue.
   Recoveries are split into operating, investing and financing.
2. **Production & Sales**: per SKU, production quantity, sales quantity and sales value. Sales value feeds revenue.
3. **Payments & Cash Position**: payments are split into operating, investing and financing.
   Opening cash rolls forward automatically: closing = opening + recoveries − payments ± other movements.
4. **Profitability**: EBITDA, net profit, and both margins.

Every line shows:
- Week, MTD and YTD, each with target, actual, variance and variance %.
- Any prior-week adjustment.
- An MTD reconciliation: previously reported MTD + this week, compared with MTD now, with any difference flagged.

## Rules

- **Weeks:** a week runs Monday to Sunday and is due the next Monday (configurable).
  A week that crosses a month end is entered in two portions. The first closes the old month and the second opens the new one.
- **Entry:** users enter only this week's figures, in full rupees. Everything else is calculated.
  Reports show millions by default, with a toggle to full figures; hovering any figure shows the full amount.
- **Corrections:** filed weeks are locked. A correction is entered as a prior-week adjustment in the current week, with a mandatory reason.
  Adjustments are booked in the first portion of the week, so a split week closes the old month correctly.
  An admin can reopen a filed week if needed, and every revision is kept.
- **Filing:** weeks must be filed in order, once the week has ended.
- **Budgets:** enter an annual figure per line. Amounts that belong to a specific month are typed into that month.
  The rest is spread over the year by days. Weekly, MTD and YTD targets are prorated by days.
- **Opening position:** each company enters its first reporting week and its opening cash & bank once.
- **Financial year:** starts in July (configurable).
