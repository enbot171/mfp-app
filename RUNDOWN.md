# MFP App — Rundown

## Purpose

A seasonal internal tool used every ~6 months when a new pledge cycle opens. Admins upload a Pabbly form export (CSV/XLSX), the app matches it against the Master Google Sheet, flags discrepancies, and lets admins push updates in controlled batches.

---

## Seasonal Workflow

```
Login
  → Connect to Master Sheet (Sheet ID + tab name)
  → Upload Pabbly CSV
      → new rows appended to _pabbly_queue tab (duplicate Ticket IDs skipped)
      → compared against master, preview shown
  → Push clean rows  (Update + clean New rows, no issues)
  → For Review rows with field mismatches:
      Option A — resolve manually in the table (Current / New toggles)
      Option B — Export review report → regional coordinator fills in decisions
                  → Admin uploads filled response → resolved rows flip to Update
  → Push resolved rows
  → Repeat until queue is empty → Done screen
```

If the admin leaves mid-session, decisions and queue state persist in the `_pabbly_queue` tab. On next visit a **Resume** banner appears — clicking it restores the table exactly as left, including all toggle choices and region selections.

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
| J+ | Monthly columns | `MAR`, `APR`, `MAY`, … — managed by Phase 2 (payments), never touched |

---

## Queue Tab (`_pabbly_queue`)

A hidden tab created automatically in the Master Sheet. Stores all uploaded CSV rows with a `status` column appended as the last column.

### Row statuses

| Value | Meaning |
|-------|---------|
| `""` (empty) | Pending — shown in the preview table |
| `{"overrides":{...}}` | Pending with saved decisions — shown in preview with toggles pre-filled |
| `"pushed"` | Successfully written to master sheet |
| `"dismissed"` | Removed by admin (individual dismiss, bulk error dismiss, or discard all) |

Rows are **never deleted** from the queue tab — only their status changes. This means:
- Re-uploading the same CSV skips already-known rows (any status) by Ticket ID
- All history is preserved in the tab as an audit log
- Decisions saved as JSON in the status column survive page refresh and resume correctly

### "Dismiss all pending and start fresh"

Marks all pending rows as `"dismissed"`. Pushed rows and their history are preserved. If the same CSV is re-uploaded after dismissing, those rows are still recognised by Ticket ID and skipped.

---

## Multi-Upload Deduplication

Every Pabbly form submission has a unique **Ticket ID** (column 13 of the CSV). On each upload:

1. The app reads all Ticket IDs already in the queue tab (any status — pending, pushed, dismissed)
2. Rows in the new CSV whose Ticket ID is already known are silently skipped
3. Only genuinely new Ticket IDs are appended to the queue
4. A skip count banner appears in the preview: `"X rows already queued or processed — skipped"`

This means uploading the same CSV twice, or uploading a new cumulative export that includes old submissions, is always safe.

---

## Pabbly CSV Column Mapping

| Pabbly column (index) | Master field | Notes |
|-----------------------|--------------|-------|
| 0 — pledge type string | — | Contains "first time" → new entry; anything else → returning pledger |
| 2 — MFP number | MF Number | Auto-corrected: missing `MF` prefix is prepended |
| 1 or 3 — Partial NRIC | Partial NRIC | Col 3 preferred; falls back to col 1 |
| 4 — Full Name | Full Name | |
| 5 — Region string | Region | `"North Region"` → `"North"`, unrecognised values → blank (requires manual selection) |
| 8 — Contact Number | Contact Number | |
| 9 — Email Address | Email | |
| 10 — Monthly Pledge Amount | Pledge Amount | Strips `$`, commas, spaces |
| 11 — Additional pledge | — | Non-empty → pledge is additive (stacked on top of existing) |
| 13 — Ticket Id | — | Used for deduplication only, never written to master |

---

## MF Number Standardisation

Format: **`MF` + exactly 3 digits + 1 uppercase letter** (e.g. `MF123A`).

| Raw input | Action | Result |
|-----------|--------|--------|
| `MF123A` | Already valid — uppercase | `MF123A` |
| `mf123a` | Uppercase | `MF123A` |
| `123A` | Missing prefix — prepend `MF` | `MF123A` → flag `MF_AUTOCORRECTED` |
| *(blank)* | No MF provided | Falls through to NRIC lookup |

---

## Matching Logic

```
For each Pabbly row:
  1. Normalise MF number
  2. If MF number provided → look up in master by MF number
       Found    → matched, cross-validate fields
       Not found → push MF_NOT_FOUND error, fall through to NRIC
  3. If not yet matched AND returning pledger AND NRIC provided → look up by Partial NRIC
       Found    → matched, MF_NOT_FOUND error cleared, cross-validate fields
       Not found → not matched
  4. If matched → classify:
       No errors or warnings → Update
       Has errors or warnings → Review
  5. If not matched:
       Pledge type contains "first time" → New  (MF assigned from NRIC, appended)
       Otherwise                         → Error (returning pledger not found)
```

**On update (matched rows):** Only fields sourced from Pabbly are patched. Blank Pabbly fields do not overwrite existing master values. `Service` and all monthly columns are never touched.

**On insert (new rows):** MF number is generated at preview time from the person's NRIC:

```
base MF = "MF" + NRIC  (e.g. NRIC "321D" → "MF321D")

If base MF is free              → use it, Ref No. = blank
If base MF is taken → try MF+"A" → use it if free, Ref No. = "A"
                    → try MF+"B" → use it if free, Ref No. = "B"
                    → … continues through A–Z
```

Multiple new rows with the same NRIC in the same upload are each assigned the next free letter.

---

## Row Status in Preview

| Status | Colour | Push button | Meaning |
|--------|--------|-------------|---------|
| **Update** | Green | ✓ | Matched in master, no issues — safe to push |
| **Review** | Amber | ✓ | Matched but has field mismatches or validation warnings |
| **New** | Violet | ✓ | First-time pledger, will be appended to master |
| **Error** | Red | ✗ | Returning pledger not found, or has blocking errors |

---

## Field Mismatch Handling

When a matched row has differing field values between Pabbly and master, it is flagged `Review`. Each mismatched cell shows two buttons:

- **Current** — value currently in Google Sheets
- **New** — value from the Pabbly form (default selection)

The selected choice turns green. The admin's choice is stored immediately in the queue tab status column (debounced 800ms) and survives a page refresh. The choice is applied to the output row when the row is pushed.

Affected fields: Full Name, Region, Partial NRIC, Contact Number, Email.

---

## Missing Region Handling

If a row's region is blank or unrecognised (e.g. the pledger selected "I Am Not Sure"), a `MISSING_REGION` warning is shown and a **region dropdown** appears in the Region cell. The admin picks the correct region before pushing.

The selected region is persisted to the queue tab immediately and restored on resume.

---

## Regional Review Export / Response Flow

For `Review` rows the admin wants a regional coordinator to decide:

1. Click **Export review report** → choose a region → download Excel file
2. The file has one row per mismatched field:

   | Column | Notes |
   |--------|-------|
   | MF No., Ref No., Full Name, Field, Current, New | Visible to reviewer |
   | Decision | Reviewer types `Current` or `New`. Rows left blank stay under review |
   | Notes | Free text, ignored on import |
   | `_mfNumber`, `_refNo`, `_field` | Hidden — used as lookup keys on re-import. Do not delete |

3. Regional coordinator fills in the Decision column and returns the file
4. Admin clicks **Upload region response** → decisions are applied in memory:
   - `Current` → output row reverts to master value
   - `New` → output row keeps pabbly value (already set)
   - Resolved mismatch warnings are removed from the row's error badges
   - If all mismatches resolved → row promoted from `Review` → `Update`
   - Partial decisions → row stays `Review` with only unresolved fields remaining
5. Decisions are saved to the queue tab status column — if the admin leaves before pushing, decisions are restored on resume
6. **Nothing is written to master until the admin explicitly pushes**

---

## Decision Persistence and Resume

All field-level decisions (Current/New toggles, region dropdown, and response file imports) are stored in the queue tab's `status` column as JSON:

```
{"overrides":{"1":"master","5":"pabbly","2":"North"}}
```

Keys are master column indices; values are `"master"`, `"pabbly"`, or a literal value (for region). On resume:
- Pending rows with JSON status show in the preview with toggles pre-filled
- The row stays `Review` (amber) — `matchType` is always recomputed fresh from current master data
- Pushing the row applies the stored decisions to the output — identical result to resolving via the response file

---

## Pledge Amount Logic

```
If Additional pledge column (col 11) is empty:
  Pledge Amount = new monthly pledge value  (replaces existing)

If Additional pledge column has any value:
  Pledge Amount = existing master pledge + new monthly pledge value
```

The pledge column in the preview shows the old amount struck through in grey with the new amount below when stacking.

Monthly columns (MAR, APR, MAY, …) are **never written** by this app.

---

## Error / Warning Reference

| Code | Severity | Condition |
|------|----------|-----------|
| `MF_AUTOCORRECTED` | Warning (info) | `MF` prefix was missing and auto-added — no review needed |
| `MF_NOT_FOUND` | Error | MF number provided but not found in master (clears automatically if NRIC fallback succeeds) |
| `MF_GENERATION_FAILED` | Error | Could not generate a unique MF from NRIC — all 26 letter suffixes taken |
| `NAME_MISMATCH` | Warning | Name in form ≠ name in master |
| `NRIC_MISMATCH` | Warning | NRIC in form ≠ NRIC in master |
| `CONTACT_MISMATCH` | Warning | Contact in form ≠ contact in master |
| `EMAIL_MISMATCH` | Warning | Email in form ≠ email in master |
| `REGION_MISMATCH` | Warning | Region in form ≠ region in master |
| `MISSING_REGION` | Warning | Region blank or unrecognised — requires manual selection before push |
| `MISSING_CONTACT` | Error | Contact blank in form AND blank in master |
| `MISSING_EMAIL` | Error | Email blank in form AND blank in master |
| `MISSING_PLEDGE` | Error | Monthly pledge amount is blank |
| `INVALID_EMAIL` | Error | Email fails format check |
| `INVALID_PHONE` | Error | Contact number not 8–15 digits after stripping non-digits |

Warnings block auto-selection but do not prevent manual push. Errors block auto-selection and are shown with a red badge; the push button is still available for the admin to override.

---

## Push Sequence (all push actions)

1. Validate: new rows must have a region selected
2. Mark rows as `"pushed"` in the queue tab **first** (before touching master sheet)
3. Write to master: `batchUpdate` for updates, `append` for new rows
4. On success: rows removed from preview UI, Done screen shown if queue is empty
5. On failure: rows reverted to `""` (pending) in queue tab — admin can retry

This order ensures that if the master sheet write fails, the queue tab is cleanly reverted and no data is lost.

---

## Table Features

- **Sticky black header** with filter row directly below
  - Status: multi-select dropdown (Update, Review, New, Error)
  - Region: multi-select dropdown
  - Full Name, MF Number, Email: text search
- **Sort** — click any column label to sort asc/desc; default sort is region A→Z then status priority
- **Select all** — header checkbox selects/deselects all visible (filtered) rows; indeterminate when partially selected
- **End-state display** — cells show the value that will be written to master if the row is pushed now

---

## Action Buttons

### Summary bar (inside the table)

| Button | Colour | Action |
|--------|--------|--------|
| **Dismiss X errors** | Red | Mark error rows as `"dismissed"`, remove from preview |
| **Export review report** | Amber | Open region picker → download Excel for regional coordinator |
| **Add X new** | Violet | Push all visible clean New rows → append to master |
| **Update X clean** | Green | Push all visible Update rows → update master |

### Preview header bar

| Button | Action |
|--------|--------|
| **Upload another file** | Return to upload screen (queue persists) |
| **Upload region response** | Import filled Excel → apply decisions to Review rows |
| **Update X selected** | Push all checked rows regardless of status |

### Per-row actions

| Icon | Action |
|------|--------|
| ↑ | Push this single row |
| ✕ | Dismiss this row (mark `"dismissed"`, remove from preview) |

---

## Google Sheet Connection

Service account approach — no browser OAuth:

1. Create Google Cloud project, enable Sheets API
2. Create service account, download JSON key
3. Share the Master Sheet with the service account email (Editor)
4. Set `GOOGLE_SERVICE_ACCOUNT_EMAIL` and `GOOGLE_PRIVATE_KEY` in `.env.local`

Sheet ID is entered in the app UI (supports pasting the full URL — ID is auto-extracted). Stored in `sessionStorage` for the session; cleared on sign-out.

Write strategy:
- **Updates**: `batchUpdate` targeting the exact row by 1-based index (`rowIndex + 2` accounts for 1-based rows and the header)
- **Inserts**: `append` after the last row
- **Queue tab**: `values.update` starting at `A1` with `RAW` input option to preserve exact strings

---

## Auth

Single admin password stored in `ADMIN_PASSWORD` env var. `middleware.js` intercepts every request, reads the `mfp_session` httpOnly cookie, and redirects to `/login` if missing or wrong. Cookie is set on successful login and cleared on sign-out.

---

## What Is Never Overwritten

| Field | Reason |
|-------|--------|
| Service (col H) | Set manually per person; not present in Pabbly form |
| All monthly columns (col J+) | Managed by Phase 2 payment processor |
| Any master field that is blank in Pabbly but already populated | Blank Pabbly field ≠ intentional clear |

Ref No. (col E) is written **only for new rows being appended** and only when the generated MF number conflicts with an existing one. It is never modified on existing rows.
