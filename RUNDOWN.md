# MFP App — Rundown

## Purpose

A seasonal internal tool used every ~6 months when a new pledge cycle opens, and on an ongoing basis for tracking monthly bank payments. Admins work from a Master Google Sheet shared with a service account — no browser OAuth required.

---

## High-Level Flow

```
Login  →  Connect to Master Sheet (Sheet ID + tab name)
       →  Home screen — choose workflow:

    Pledges                          Payments
    ───────                          ────────
    Upload Pabbly CSV/XLSX           Upload bank statement (UOB/DBS)
    → auto-matched against master    → auto-matched against master
    → review preview                 → review preview
    → push rows                      → push rows
    → Revert last push (if wrong)    → Revert last push (if wrong)
    → Discard file (start over)      → Discard file (start over)
```

Closing the browser mid-session is safe — the in-progress file is saved to a Google Sheets queue tab and auto-resumed on next visit.

---

## Master Sheet Structure

| Col | Header | Notes |
|-----|--------|-------|
| A | MF Number | Format: `MF` + 3 digits + 1 letter, e.g. `MF123A` |
| B | Full Name | |
| C | Region | `North`, `North East`, `East`, `Central`, `South`, `West` |
| D | Partial NRIC | Last 3 digits + letter, e.g. `123A` |
| E | Ref No. | Blank for most records. Auto-assigned (A, B, …) only when multiple people share the same base MF number |
| F | Contact Number | Singapore mobile |
| G | Email | |
| H | Service | `English`, `Mandarin`, etc. — **never overwritten** |
| I | Pledge Amount | Numeric string, e.g. `1000.00` |
| J+ | Monthly columns | `MAR`, `APR`, `MAY`, … — written by the Payment workflow |

---

## Session Persistence

When a file is uploaded and parsed, the rows are saved to a Google Sheets queue tab:

| Workflow | Queue tab | Overrides tab | Log tab |
|----------|-----------|---------------|---------|
| Pledges | `_pledge_queue_` | `_pledge_overrides_` | `_pledge_log_` |
| Payments | `_payment_queue_` | — | `_payment_log_` |

On page load, the app checks for a pending queue tab first. If one exists, it auto-resumes directly into the review preview (re-fetching master sheet data and re-running matching so already-pushed rows are filtered out). No manual "resume" step required.

What persists across a browser close (until pushed or discarded):

- **Uploaded rows** — the queue tab. Adding another file (Add file / Add new CSV) rewrites the queue with the merged set.
- **Dismissed rows** — removed from the queue, so they do not reappear on resume.
- **Pledge field decisions** — regional-response decisions and manual Current/New picks are saved to `_pledge_overrides_`, keyed by Ticket ID, and re-applied on resume (re-mapped to that run's rows).

The queue (and overrides) tab is deleted when all rows in the session are pushed, or when "Discard file" is confirmed. The in-memory **revert** snapshot is the exception — it is lost on close (the Sheets write stands; the log entry remains).

---

## Pledge Workflow

### File format

CSV or XLSX exported from Pabbly Connect. Each row is one pledge submission.

### Pabbly Column Mapping

| Pabbly column (index) | Master field | Notes |
|-----------------------|--------------|-------|
| 0 — pledge type string | — | Contains "first time" → new entry; anything else → returning pledger |
| 2 — MFP number | MF Number | Auto-corrected: missing `MF` prefix is prepended |
| 1 or 3 — Partial NRIC | Partial NRIC | Col 3 preferred; falls back to col 1 |
| 4 — Full Name | Full Name | |
| 5 — Region string | Region | `"North Region"` → `"North"`, unrecognised → blank (requires manual selection) |
| 8 — Contact Number | Contact Number | |
| 9 — Email Address | Email | |
| 10 — Monthly Pledge Amount | Pledge Amount | Strips `$`, commas, spaces |
| 11 — Additional pledge | — | Non-empty → pledge is additive (stacked on top of existing) |
| 13 — Ticket ID | — | Used for deduplication only, never written to master |

### Matching Logic

```
For each Pabbly row:
  1. Normalise MF number (prepend "MF" if missing)
  2. Look up by MF number in master
       Found    → matched, cross-validate fields
       Not found → MF_NOT_FOUND error, fall through to NRIC
  3. If not yet matched AND returning pledger AND NRIC provided → look up by NRIC
       Found    → matched (MF_NOT_FOUND cleared), cross-validate fields
       Not found → not matched
  4. If matched:
       No errors/warnings → Update
       Has warnings       → Review
  5. If not matched:
       "first time" pledge type → New (appended to master)
       Otherwise               → Error (returning pledger not found)
```

On update: only Pabbly-sourced fields are patched. Blank Pabbly fields never overwrite existing master values. Service (col H) and monthly columns are never touched.

On insert: MF number is generated from NRIC — `"MF" + NRIC`. If taken, try `MF + NRIC + "A"`, `"B"`, … up to Z.

### Row statuses in preview

| Status | Colour | Meaning |
|--------|--------|---------|
| **Update** | Green | Matched, no issues — safe to push |
| **Review** | Amber | Matched but has field mismatches |
| **New** | Violet | First-time pledger, will be appended |
| **Error** | Red | Returning pledger not found, or blocking error |

### Field Mismatch Handling

When a matched row has differing values between Pabbly and master, it is flagged **Review**. Each mismatched cell shows two buttons — **Current** (master value) and **New** (Pabbly value). The admin's choice is applied when the row is pushed.

Affected fields: Full Name, Region, Partial NRIC, Contact Number, Email.

### Regional Review Export / Response Flow

For Review rows to be sent to a regional coordinator:

1. Click **Export review report** → choose region → download Excel
2. The Excel has one row per mismatched field: MF No., Ref No., Full Name, Field, Current, New, Decision, Notes. Hidden columns (`_mfNumber`, `_refNo`, `_field`) are used as lookup keys on re-import — do not delete them.
3. The Decision column has a dropdown restricted to `current` or `new`.
4. Regional coordinator fills in Decision and returns the file.
5. Admin clicks **Upload region response** → decisions applied in memory:
   - `current` → reverts output row to master value
   - `new` → keeps Pabbly value
   - Resolved warnings removed; if all resolved → row promoted to Update
6. Nothing is written to master until the admin explicitly pushes.

### Pledge Amount Logic

```
If Additional pledge column (col 11) is empty:
  Pledge Amount = new value  (replaces existing)

If Additional pledge column has any value:
  Pledge Amount = existing master amount + new value  (stacked)
```

### "Add new CSV" (merge)

In the preview, **Add new CSV** appends rows from a second Pabbly export into the current session. Rows already in the preview (matched by Ticket ID) are skipped. Only genuinely new Ticket IDs are added.

After merging, an **Undo last add** button (amber) appears. Clicking it reverts the session to the pre-merge state and updates the queue tab, including if the browser is closed before undoing.

### Deduplication

Ticket IDs already present in `_pledge_log_` are filtered out on file upload and on resume, so already-pushed rows never appear in the preview.

---

## Payment Workflow

### Supported bank formats

| Format ID | Bank | Account type |
|-----------|------|--------------|
| `format1` | Generic | — |
| `uob_pn` | UOB | Personal |
| `uob_bo` | UOB | Business |
| `dbs_pn` | DBS | Personal |
| `dbs_bo` | DBS | Business |
| `bank5` | — | — |

The parser detects the format automatically from the sheet header structure. Multi-sheet XLSX files are supported — each sheet is parsed independently.

### Matching Logic

Each parsed bank transaction is matched to a master row by MF number (extracted from the reference/description field) or by amount. The matched cell is the monthly column (`MAR`, `APR`, etc.) corresponding to the transaction date. If the column does not yet exist, an **Add missing months** prompt appears.

### Deduplication

Payment fingerprints (`date|mfNumber|amount|reference`) already present in `_payment_log_` are filtered out on file upload and on resume.

---

## Preview Actions (both workflows)

### Action bar buttons

| Button | When visible | Action |
|--------|-------------|--------|
| **Add new CSV** (pledge) / **Add file** (payment) | Always | Merge rows from another export into the session. Duplicates (Ticket ID for pledge, fingerprint for payment) are skipped |
| **Undo last add** | After an Add | Revert the last merge — restores pre-merge queue state |
| **Upload region response** | Pledge, always | Import filled Excel → apply decisions to Review rows (persisted to `_pledge_overrides_`) |
| **Discard file** | Always | Confirm prompt → delete queue tab, clear session, return to history or upload |
| **Revert last push** | After any push | Undo the last Google Sheets write — restores master cells and returns rows to preview |
| **View Pledge / Payment History** | In preview header | Go to the append-only log view (reloads from the log tab) |
| **Update X selected** (pledge) / **Push X selected** (payment) | Always | Push all checked rows |
| **Push X matched** | Payment | Push every matched row currently in view (respects filters) |

### Sorting & filtering (both previews)

Each column header (Status, Source*, MF No., Name, Date*, Month*, Amount*) is click-to-sort. A filter row sits under the headers: dropdowns for Status / Region* / Source* / Month*, text search for MF No. / Name / Email*. Batch actions ("Dismiss X errors", "Push X matched", "Update X clean") act on the **filtered** view and are labelled "(filtered)" when a filter is active.
<br>*payment-specific or pledge-specific columns differ; see each table.*

### In-table actions

| Button | Workflow | Action |
|--------|----------|--------|
| ↑ (per row) | Both | Push single row |
| ✕ (per row) | Both | Dismiss row — removed from preview **and** the queue tab |
| **Dismiss X errors** | Both | Dismiss all error rows in view (removed from queue) |
| **Export review report** | Pledge | Open region picker → download Excel |
| **Add X new** | Pledge | Push all clean New rows |
| **Update X clean** | Pledge | Push all clean Update rows |

---

## Revert

After a push, **Revert last push** undoes the most recent write to Google Sheets:

- For pledges: restores all master cells that were updated and deletes any rows that were appended. The reverted rows return to the preview.
- For payments: restores the monthly amount cells that were overwritten. The reverted rows return to the preview.

The revert snapshot is kept in browser memory only. It is cleared when:
- Another push is made (that push becomes the new revert target, after user confirms)
- The page is refreshed or closed (session memory lost — the Google Sheets write stands)
- The rows are reverted successfully

The log tab marks reverted entries as `"reverted"` rather than deleting them.

---

## Audit Logs

Both log tabs are append-only. Each pushed record gets a row with a fingerprint (for dedup on future uploads), identifying fields, and a timestamp. Reverted rows are updated in-place to status `"reverted"`.

### `_pledge_log_` columns

`Fingerprint | MF No. | Full Name | Pledge Amount | Service | Entry Date | Status | Pushed At`

### `_payment_log_` columns

`Fingerprint | MF No. | Month | Date | Amount | Source | Status | Pushed At`

---

## MF Number Standardisation

Format: **`MF` + exactly 3 digits + 1 uppercase letter** (e.g. `MF123A`).

| Raw input | Action | Result |
|-----------|--------|--------|
| `MF123A` | Already valid | `MF123A` |
| `mf123a` | Uppercase | `MF123A` |
| `123A` | Missing prefix — prepend `MF` | `MF123A` → flag `MF_AUTOCORRECTED` |
| *(blank)* | No MF provided | Falls through to NRIC lookup |

---

## Error / Warning Reference

| Code | Severity | Condition |
|------|----------|-----------|
| `MF_AUTOCORRECTED` | Info | `MF` prefix was missing and auto-added |
| `MF_NOT_FOUND` | Error | MF not found in master (clears if NRIC fallback succeeds) |
| `MF_GENERATION_FAILED` | Error | Could not generate a unique MF from NRIC — all 26 suffixes taken |
| `NAME_MISMATCH` | Warning | Name in form ≠ name in master |
| `NRIC_MISMATCH` | Warning | NRIC in form ≠ NRIC in master |
| `CONTACT_MISMATCH` | Warning | Contact in form ≠ contact in master |
| `EMAIL_MISMATCH` | Warning | Email in form ≠ email in master |
| `REGION_MISMATCH` | Warning | Region in form ≠ region in master |
| `MISSING_REGION` | Warning | Region blank or unrecognised — manual selection required before push |
| `MISSING_CONTACT` | Error | Contact blank in form AND blank in master |
| `MISSING_EMAIL` | Error | Email blank in form AND blank in master |
| `MISSING_PLEDGE` | Error | Monthly pledge amount is blank |
| `INVALID_EMAIL` | Error | Email fails format check |
| `INVALID_PHONE` | Error | Contact number not 8–15 digits after stripping non-digits |
| `NO_MONTH_COL` | Error | Monthly column for this transaction's date does not exist in master |

Warnings block auto-selection but do not prevent manual push. Errors block auto-selection; the push button is still available for the admin to override.

---

## Architecture & Code Map

Next.js App Router. Parsing and matching happen in the browser; every Google Sheets read/write goes through a server-side API route using the service account. The client never holds Google credentials.

```
Browser (client components)                Server (Node runtime)            Google
──────────────────────────                 ─────────────────────            ──────
app/page.js          connect sheet
app/pledge/page.js ──┐ parse + match        app/api/pledge    ┐
app/payment/page.js ─┤ (lib/*)        fetch app/api/payment   ├─ lib/googleSheets ─→ Sheets API v4
                     └───────────────────→  app/api/sheet     │   (service account)
                        JSON over fetch      app/api/queue     │
                                             app/api/*/revert  ┘
proxy.js  ── guards every request via mfp_session cookie ──────────────────────────
```

### Client libraries (`lib/`)

| File | Role |
|------|------|
| `parseFile.js` | Parse Pabbly CSV/XLSX → raw rows (pledge) |
| `parsePaymentFile.js` | Detect bank format per tab, parse → transactions (payment) |
| `matchRows.js` | Match pledge rows to master; classify Update/Review/New/Error |
| `matchPayments.js` | Match transactions to master row + month column |
| `mapFields.js`, `calcPledge.js`, `validateRows.js` | Field mapping, pledge-amount stacking, validation |
| `exportReviewReport.js` | Build the regional Review Excel (with Decision dropdown) |
| `parseReviewResponse.js` | Read a filled-in Review Excel back in |

### Server library

`lib/googleSheets.js` is the only module that talks to Google. Key functions: `fetchMasterSheet`, `addMonthColumns`, `read/write/deleteQueueTab`, `pushPledgeToMaster` / `revertPledgeUpdates`, `pushPaymentUpdates` / `revertPaymentUpdates`, `append*Log` / `read*Log` / `mark*Reverted`.

### Components

`PreviewTable.js` (pledge), `PaymentPreviewTable.js` (payment), `DropZone.js`, `ErrorBadge.js`.

---

## API Reference

All routes run on the Node runtime and require the `mfp_session` cookie (except `/api/auth`).

| Route | Method | Body / Query | Returns |
|-------|--------|--------------|---------|
| `/api/auth` | POST | `{ password }` | Sets `mfp_session` cookie |
| `/api/auth` | DELETE | — | Clears the cookie |
| `/api/sheet` | GET | `?sheetId&tab` | `{ headers, rows, title }` |
| `/api/sheet` | POST | `{ sheetId, tab, addMonths[] }` | `{ added[] }` (new month columns) |
| `/api/queue` | GET | `?sheetId&queueTab` | `{ rows }` (or `{ tabs }` if no `queueTab`) |
| `/api/queue` | POST | `{ sheetId, queueTab, rows }` | `{ ok }` — overwrites the tab |
| `/api/queue` | DELETE | `{ sheetId, queueTab }` | `{ ok }` |
| `/api/pledge` | GET | `?sheetId` | `{ fingerprints, rows }` from `_pledge_log_` |
| `/api/pledge` | POST | `{ sheetId, tab, updates, appends, logRows }` | `{ updated, appended, snapshot }` |
| `/api/pledge/revert` | POST | `{ sheetId, snapshot, fingerprints }` | `{ ok }` |
| `/api/payment` | GET | `?sheetId` | `{ fingerprints, rows }` from `_payment_log_` |
| `/api/payment` | POST | `{ sheetId, tab, updates, logRows }` | `{ pushed, snapshot }` |
| `/api/payment/revert` | POST | `{ sheetId, tab, cells, fingerprints }` | `{ reverted }` |

The push `snapshot` returned by each POST is what the matching `/revert` route consumes to restore the master and mark log rows `reverted`.

---

## Google Sheet Connection

Service account approach — no browser OAuth:

1. Create Google Cloud project, enable Sheets API
2. Create service account, download JSON key
3. Share the Master Sheet with the service account email (Editor)
4. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` in `.env.local`

Sheet ID is entered in the app UI (supports pasting the full URL — ID is auto-extracted). Stored in `sessionStorage` for the session; cleared on sign-out.

Write strategy:
- **Updates**: `batchUpdate` targeting exact rows by 1-based index
- **Inserts**: `values.append` after the last row
- **Queue tabs**: `values.update` from A1 with `RAW` input option
- **Log tabs**: `values.append` (append-only)

---

## Auth

Single admin password stored in `ADMIN_PASSWORD` env var. `proxy.js` intercepts every request, reads the `mfp_session` httpOnly cookie, and redirects to `/login` if missing or incorrect. Cookie is set on successful login and cleared on sign-out.

---

## What Is Never Overwritten

| Field | Reason |
|-------|--------|
| Service (col H) | Set manually per person; not present in Pabbly form |
| All monthly columns (col J+) | Written only by the Payment workflow, never by Pledge |
| Any master field blank in Pabbly but populated in master | Blank Pabbly field ≠ intentional clear |

Ref No. (col E) is written **only for new rows** and only when the generated MF number conflicts with an existing one. It is never modified on existing rows.
