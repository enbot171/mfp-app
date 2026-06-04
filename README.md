# MFP App

Internal tool for processing Pabbly pledge form exports against a Master Google Sheet. Used seasonally (~every 6 months) when a new pledge cycle opens.

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

## Usage

See [RUNDOWN.md](./RUNDOWN.md) for the full workflow, data model, matching rules, and error reference.

## Test Data

Sample CSVs for testing are in [test-data/](./test-data/):
- `pabbly-batch-1.csv` — 2 rows (Update + Review) for the initial upload
- `pabbly-batch-2.csv` — 2 rows (Update + New) to simulate a second upload later

Pair with `MFP Testing Template - Master.csv` (in Downloads) as the master sheet content.
