# MFP App

Internal tool for processing pledge and payment data against a Master Google Sheet. Used seasonally (~every 6 months) when a new pledge cycle opens, and on an ongoing basis for tracking monthly payments.

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

Upload a Pabbly CSV/XLSX export. The app matches each row against the Master Sheet, flags discrepancies, and lets you push updates row-by-row or in batches. Review rows with field mismatches can be exported to an Excel report for regional coordinators to resolve.

### Payments

Upload a bank transaction export (UOB or DBS, personal or business account). The app matches each transaction to a member by MF number or amount, and writes the payment amount into the correct monthly column on the Master Sheet.

## Session Persistence

In-progress sessions (uploaded but not yet fully pushed) are saved automatically to a Google Sheets tab (`_pledge_queue_` or `_payment_queue_`). Closing and reopening the page resumes where you left off.

## Audit Logs

All pushed records are written to `_pledge_log_` and `_payment_log_` tabs in the Master Sheet. These tabs are append-only and act as a permanent audit trail. Reverted pushes are marked `"reverted"` rather than deleted.

See [RUNDOWN.md](./RUNDOWN.md) for the full workflow, data model, matching rules, and error reference.
