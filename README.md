# MFP App

Internal tool for processing **pledge** and **payment** data against a Master Google Sheet. Used seasonally (~every 6 months) when a new pledge cycle opens, and on an ongoing basis for tracking monthly payments.

## Requirements

- Node.js 20.9+
- A Google Cloud service account with the Sheets API enabled
- The Master Google Sheet shared with the service account (Editor access)

## Setup

1. Install dependencies:
   ```bash
   npm install
   ```

2. Create `.env.local` with your credentials:
   ```
   GOOGLE_SERVICE_ACCOUNT_EMAIL=your-service-account@project.iam.gserviceaccount.com
   GOOGLE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
   ADMIN_PASSWORD=your-admin-password
   ```

3. Start the dev server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000).

## Workflows

### Pledges

Upload a Pabbly CSV/XLSX export. The app matches each row against the Master Sheet, flags discrepancies, and lets you push updates row-by-row or in batches. Review rows with field mismatches can be exported to an Excel report for regional coordinators to resolve, then re-imported.

### Payments

Upload a bank transaction export (UOB / DBS, personal or business; multi-tab supported). The app detects each tab's format, matches every transaction to a member by MF number, and writes the amount into the correct monthly column on the Master Sheet.

Both workflows support: **Add file** (merge another export into the current session), **Discard file**, **Revert last push**, per-row and batch push, column sorting/filtering, and a persisted **History** view.

## Architecture

Next.js (App Router). The browser never talks to Google directly — all Sheets access goes through server-side API routes using a service account.

```
Browser (React client pages)
  app/page.js        → home / connect to sheet
  app/pledge/page.js → pledge workflow
  app/payment/page.js→ payment workflow
        │  fetch()
        ▼
Server API routes (Node runtime, service-account auth)
  app/api/*          → Google Sheets API v4
        │
        ▼
Master Google Sheet (data + queue + log tabs)
```

- **Parsing** is client-side (SheetJS): `lib/parseFile.js` (pledge), `lib/parsePaymentFile.js` (payment, format detection).
- **Matching** is client-side: `lib/matchRows.js` (pledge), `lib/matchPayments.js` (payment).
- **Writes** are server-side only: `lib/googleSheets.js` wraps every Sheets call.
- **Auth**: `proxy.js` (this Next.js version uses the `proxy` convention, not `middleware`) guards every route via the `mfp_session` cookie.

### Sheet tabs the app manages

| Tab | Purpose |
|-----|---------|
| *(your master tab)* | The data — members, pledges, monthly columns |
| `_pledge_queue_` / `_payment_queue_` | In-progress upload, for auto-resume |
| `_pledge_overrides_` | Saved field decisions (regional responses, manual picks) |
| `_pledge_log_` / `_payment_log_` | Append-only audit log of every push |

### API routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/auth` | POST, DELETE | Sign in / out (sets/clears `mfp_session` cookie) |
| `/api/sheet` | GET, POST | GET master rows+headers; POST adds missing month columns |
| `/api/queue` | GET, POST, DELETE | Read/write/delete a queue (or overrides) tab |
| `/api/pledge` | GET, POST | GET pledge log (fingerprints + rows); POST pushes updates/appends + logs |
| `/api/pledge/revert` | POST | Restore master cells + mark log rows `reverted` |
| `/api/payment` | GET, POST | GET payment log; POST pushes amount cells + logs |
| `/api/payment/revert` | POST | Restore amount cells + colours, mark log `reverted` |

## Session Persistence

In-progress sessions (uploaded but not yet fully pushed) are saved automatically to a queue tab (`_pledge_queue_` / `_payment_queue_`). Closing and reopening the page resumes straight into the review preview. Dismissing rows and (for pledge) field decisions are persisted too, so they survive a reload.

## Audit Logs

All pushed records are written to `_pledge_log_` / `_payment_log_`. These tabs are append-only and act as a permanent audit trail. Reverted pushes are marked `"reverted"` in-place rather than deleted, and are excluded from duplicate detection on future uploads.

See [RUNDOWN.md](./RUNDOWN.md) for the full workflows, data model, matching rules, API contracts, and error reference.
