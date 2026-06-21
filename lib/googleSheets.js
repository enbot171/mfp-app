import { google } from "googleapis";

function getClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// A row is blank when it has no cells, or every cell is empty.
function isBlankRow(row) {
  return !row || row.every((c) => c === "" || c === null || c === undefined);
}

// Number of fully-blank rows above the header (master sheets may have a title /
// spacer row before the real header). The header is the first non-blank row.
function countLeadingBlankRows(allRows) {
  let n = 0;
  while (n < allRows.length && isBlankRow(allRows[n])) n++;
  return n;
}

// Returns { headers: string[], rows: string[][], title: string, headerOffset: number }
export async function fetchMasterSheet(sheetId, tab) {
  const sheets = getClient();

  const [valuesRes, metaRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tab }),
    sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "properties.title" }),
  ]);

  const all          = valuesRes.data.values ?? [];
  const headerOffset = countLeadingBlankRows(all);          // skip blank/title rows above header
  const [headers, ...rows] = all.slice(headerOffset);
  const title = metaRes.data.properties?.title ?? sheetId;
  return { headers: headers ?? [], rows: rows ?? [], title, headerOffset };
}

// Returns all tab names in the sheet that start with "_queue_".
export async function listQueueTabs(sheetId) {
  const sheets = getClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties.title",
  });
  return (meta.data.sheets ?? [])
    .map((s) => s.properties.title)
    .filter((t) => t.startsWith("_queue_") || t.startsWith("_payment_"));
}

// Returns raw rows [[header,...], [row1,...], ...] or null if tab missing / empty.
export async function readQueueTab(sheetId, tabName) {
  const sheets = getClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: tabName,
    });
    const values = res.data.values ?? [];
    if (values.length < 2) return null;
    return values;
  } catch {
    return null;
  }
}

// Writes rawRows ([[header,...], [row1,...], ...]) to the named queue tab.
// Creates the tab if it doesn't exist; clears and rewrites if it does.
// Pass [] to clear only.
export async function writeQueueTab(sheetId, rawRows, tabName) {
  const sheets = getClient();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties",
  });
  const existing = meta.data.sheets?.find((s) => s.properties.title === tabName);

  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: tabName } } }] },
    });
  } else {
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: tabName });
  }

  if (rawRows && rawRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${tabName}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rawRows },
    });
  }
}

// Deletes the named tab from the spreadsheet entirely.
export async function deleteQueueTab(sheetId, tabName) {
  const sheets = getClient();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties",
  });
  const sheet = meta.data.sheets?.find((s) => s.properties.title === tabName);
  if (!sheet) return; // already gone

  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      requests: [{ deleteSheet: { sheetId: sheet.properties.sheetId } }],
    },
  });
}

// ── Payment log ───────────────────────────────────────────────────────────────

const LEDGER_TAB  = "_payment_ledger"; // legacy — read-only going forward
const LOG_TAB     = "_payment_log_";
const LOG_HEADERS = ["Fingerprint", "MF No.", "Month", "Date", "Amount", "Source", "Status", "Pushed At"];

// Fix 4: resolve column indices by header name, not hardcoded position
function resolveLogCols(headerRow) {
  const h = (headerRow ?? []).map((c) => String(c).trim().toLowerCase());
  return {
    fingerprint: h.indexOf("fingerprint"),
    mfNo:        h.indexOf("mf no."),
    month:       h.indexOf("month"),
    date:        h.indexOf("date"),
    amount:      h.indexOf("amount"),
    source:      h.indexOf("source"),
    status:      h.indexOf("status"),
    pushedAt:    h.indexOf("pushed at"),
  };
}

// Reads from both legacy _payment_ledger AND new _payment_log_.
// Returns { fingerprints: string[], logRows: object[] } where logRows are all pushed entries.
export async function readPaymentLog(sheetId) {
  const sheets = getClient();
  const [legacyFps, logData] = await Promise.all([
    (async () => {
      try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: LEDGER_TAB });
        return (res.data.values ?? []).slice(1).map((r) => r[0]).filter(Boolean);
      } catch { return []; }
    })(),
    (async () => {
      try {
        const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: LOG_TAB });
        const values = res.data.values ?? [];
        if (values.length < 2) return { fingerprints: [], logRows: [] };
        const col = resolveLogCols(values[0]);
        if (col.fingerprint === -1) return { fingerprints: [], logRows: [] };
        const pushed = values.slice(1).filter((r) =>
          col.status === -1 || String(r[col.status] ?? "").trim() === "pushed"
        );
        return {
          fingerprints: pushed.map((r) => String(r[col.fingerprint] ?? "").trim()).filter(Boolean),
          logRows: pushed.map((r) => ({
            fingerprint: String(r[col.fingerprint] ?? "").trim(),
            mfNo:        String(r[col.mfNo]        ?? "").trim(),
            month:       String(r[col.month]       ?? "").trim(),
            date:        String(r[col.date]        ?? "").trim(),
            amount:      String(r[col.amount]      ?? "").trim(),
            source:      String(r[col.source]      ?? "").trim(),
            pushedAt:    String(r[col.pushedAt]    ?? "").trim(),
          })),
        };
      } catch { return { fingerprints: [], logRows: [] }; }
    })(),
  ]);
  return {
    fingerprints: [...new Set([...legacyFps, ...logData.fingerprints])],
    logRows:      logData.logRows,
  };
}

// Appends transaction rows to _payment_log_, creating the tab with headers if needed.
// logRows: [{ fingerprint, mfNo, month, date, amount, source }]
export async function appendToPaymentLog(sheetId, logRows) {
  if (!logRows.length) return;
  const sheets   = getClient();
  const pushedAt = new Date().toISOString();

  const meta     = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties" });
  const existing = meta.data.sheets?.find((s) => s.properties.title === LOG_TAB);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody:   { requests: [{ addSheet: { properties: { title: LOG_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId:    sheetId,
      range:            `${LOG_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody:      { values: [LOG_HEADERS] },
    });
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId:    sheetId,
    range:            `${LOG_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: logRows.map((r) => [
        r.fingerprint, r.mfNo, r.month, r.date, r.amount, r.source, "pushed", pushedAt,
      ]),
    },
  });
}

// Fix 6: finds rows by fingerprint (not row index), resolves status column from header.
// Marks matched pushed rows as "reverted" in a single batchUpdate.
export async function markLogReverted(sheetId, fingerprints) {
  if (!fingerprints.length) return;
  const sheets = getClient();
  let values;
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: LOG_TAB });
    values = res.data.values ?? [];
  } catch { return; }
  if (values.length < 2) return;

  const col = resolveLogCols(values[0]);
  if (col.fingerprint === -1 || col.status === -1) return;

  const fps = new Set(fingerprints);
  const updates = [];
  values.forEach((row, i) => {
    if (i === 0) return;
    const fp = String(row[col.fingerprint] ?? "").trim();
    const st = String(row[col.status]      ?? "").trim();
    if (fps.has(fp) && st === "pushed") {
      // i is 0-based full-array index; sheet row number = i + 1 (Sheets is 1-based)
      updates.push({
        range:  `${LOG_TAB}!${colLetter(col.status)}${i + 1}`,
        values: [["reverted"]],
      });
    }
  });
  if (!updates.length) return;

  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId:    sheetId,
    requestBody:      { valueInputOption: "RAW", data: updates },
  });
}

// Convert 0-based column index to A1 letter(s): 0→A, 25→Z, 26→AA …
function colLetter(index) {
  let letter = "";
  let n = index + 1;
  while (n > 0) {
    const rem = (n - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    n = Math.floor((n - 1) / 26);
  }
  return letter;
}

// updates: Array<{ masterRowIndex, monthColIndex, amount, pledgeAmount }>
// Reads current cell values, adds amounts, writes back. Returns snapshot { cells } for revert.
export async function pushPaymentUpdates(sheetId, tab, updates) {
  if (!updates.length) return { cells: [] };
  const sheets = getClient();

  // Account for blank/title rows above the header (data row index → sheet row),
  // and grab the numeric sheet id so we can set a 1-decimal number format.
  const [colARes, metaRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: `${tab}!A1:A30` }),
    sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties" }),
  ]);
  const headerOffset   = countLeadingBlankRows(colARes.data.values ?? []);
  const sheetMeta      = metaRes.data.sheets?.find((s) => s.properties.title === tab);
  const numericSheetId = sheetMeta?.properties.sheetId;

  // Group by cell — multiple transactions can hit the same person+month
  const cellMap = {};
  updates.forEach(({ masterRowIndex, monthColIndex, amount, pledgeAmount }) => {
    const key = `${masterRowIndex},${monthColIndex}`;
    if (!cellMap[key]) cellMap[key] = { masterRowIndex, monthColIndex, totalAmount: 0, pledgeAmount };
    cellMap[key].totalAmount += amount;
  });
  const cells  = Object.values(cellMap);
  const ranges = cells.map(({ masterRowIndex, monthColIndex }) =>
    `${tab}!${colLetter(monthColIndex)}${masterRowIndex + headerOffset + 2}` // +headerOffset, +1 header, +1 1-based
  );

  const getRes = await sheets.spreadsheets.values.batchGet({
    spreadsheetId:     sheetId,
    ranges,
    valueRenderOption: "UNFORMATTED_VALUE",
  });

  const currentValues = (getRes.data.valueRanges ?? []).map((vr) => {
    const raw = vr.values?.[0]?.[0];
    return raw !== undefined && raw !== "" ? parseFloat(raw) || 0 : 0;
  });

  const round2 = (n) => Math.round(n * 100) / 100; // avoid float drift like 2921.6000000004

  const finalCells = cells.map((cell, i) => ({
    ...cell,
    range:         ranges[i],
    previousValue: currentValues[i],
    newValue:      round2(currentValues[i] + cell.totalAmount),
  }));

  // Write values as numbers, rounded to cents (no cell colouring — payments aren't highlighted)
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: finalCells.map(({ range, newValue }) => ({ range, values: [[newValue]] })),
    },
  });

  // Always show 2 decimal places on the written cells (100 → 100.00, 584.3 → 584.30)
  if (numericSheetId !== undefined) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: finalCells.map(({ masterRowIndex, monthColIndex }) => ({
          repeatCell: {
            range: {
              sheetId:          numericSheetId,
              startRowIndex:    masterRowIndex + headerOffset + 1, // 0-based: +headerOffset, +1 header
              endRowIndex:      masterRowIndex + headerOffset + 2,
              startColumnIndex: monthColIndex,
              endColumnIndex:   monthColIndex + 1,
            },
            cell:   { userEnteredFormat: { numberFormat: { type: "NUMBER", pattern: "0.00" } } },
            fields: "userEnteredFormat.numberFormat",
          },
        })),
      },
    });
  }

  // Return before-snapshot for revert
  return {
    cells: finalCells.map(({ range, previousValue }) => ({ range, previousValue })),
  };
}

// Restores cell values to the state captured before a push.
// cells: the snapshot.cells returned by pushPaymentUpdates ({ range, previousValue })
export async function revertPaymentUpdates(sheetId, tab, cells) {
  if (!cells.length) return;
  const sheets = getClient();

  // Write previous values back (empty string when 0 — clears the cell)
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody: {
      valueInputOption: "RAW",
      data: cells.map(({ range, previousValue }) => ({
        range,
        values: [[previousValue === 0 ? "" : String(previousValue)]],
      })),
    },
  });
}

// Appends missing month headers to the master sheet header row.
// Returns the list of months actually added (skips any already present).
export async function addMonthColumns(sheetId, tab, months) {
  const sheets = getClient();
  // Read the top rows so we can locate the real header (skip blank/title rows above it)
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId:     sheetId,
    range:             `${tab}!A1:Z30`,
    valueRenderOption: "UNFORMATTED_VALUE",
  });
  const allRows      = res.data.values ?? [];
  const headerOffset = countLeadingBlankRows(allRows);
  const headerRowNum = headerOffset + 1; // 1-based sheet row of the header
  const existing     = (allRows[headerOffset] ?? []).map((h) => String(h).trim().toUpperCase());
  const toAdd        = months.filter((m) => !existing.includes(m.toUpperCase()));
  if (!toAdd.length) return [];

  const startCol = colLetter(existing.length); // append after last column
  await sheets.spreadsheets.values.update({
    spreadsheetId:    sheetId,
    range:            `${tab}!${startCol}${headerRowNum}`,
    valueInputOption: "RAW",
    requestBody:      { values: [toAdd] },
  });
  return toAdd;
}

// ── Pledge push ───────────────────────────────────────────────────────────────

// updates: Array<{ rowIndex: number, values: string[] }>  (rowIndex is 0-based data row)
// appends: Array<string[]>
export async function pushToMasterSheet(sheetId, tab, updates, appends) {
  const sheets = getClient();

  if (updates.length > 0) {
    const data = updates.map(({ rowIndex, values }) => ({
      // +2: convert 0-based data row to 1-based sheet row, then skip header row
      range: `${tab}!A${rowIndex + 2}`,
      values: [values],
    }));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
  }

  if (appends.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: appends },
    });
  }
}

// Push to master sheet with a before-snapshot for revert.
// Returns { updated, appended, snapshot }
export async function pushPledgeToMaster(sheetId, tab, updates, appends) {
  const sheets = getClient();

  const [metaRes, curValRes] = await Promise.all([
    sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties" }),
    sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tab }),
  ]);

  const sheetMeta = metaRes.data.sheets?.find((s) => s.properties.title === tab);
  if (!sheetMeta) throw new Error(`Tab "${tab}" not found`);
  const numericSheetId = sheetMeta.properties.sheetId;
  const allRows        = curValRes.data.values ?? [];
  const beforeRowCount = allRows.length; // includes any blank/title rows + header
  const headerOffset   = countLeadingBlankRows(allRows); // blank rows above header
  // 0-based data row i sits at sheet row (i + headerOffset + 2): +1 for header, +1 for 1-based.
  const sheetRow = (rowIndex) => rowIndex + headerOffset + 2;

  const updateSnapshot = updates.map(({ rowIndex, values }) => {
    const original = allRows[rowIndex + headerOffset + 1] ?? []; // skip blanks + header
    // Pad to the pushed row width — values.get strips trailing empty cells, so without
    // padding the revert would miss trailing columns (e.g. Pledge Amount) that were blank
    // before the push, leaving the newly-written value behind.
    const prevRow = original.length >= values.length
      ? original
      : [...original, ...Array(values.length - original.length).fill("")];
    return { rowIndex, prevRow };
  });

  if (updates.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updates.map(({ rowIndex, values }) => ({
          range:  `${tab}!A${sheetRow(rowIndex)}`,
          values: [values],
        })),
      },
    });
  }

  if (appends.length > 0) {
    await sheets.spreadsheets.values.append({
      // Anchor on the header row so the append targets the data table (not a blank top row)
      spreadsheetId: sheetId,
      range:            `${tab}!A${headerOffset + 1}`,
      valueInputOption: "USER_ENTERED",
      requestBody:      { values: appends },
    });
  }

  return {
    updated:  updates.length,
    appended: appends.length,
    snapshot: { tab, numericSheetId, updateSnapshot, headerOffset, appendStartRow: beforeRowCount + 1, appendCount: appends.length },
  };
}

// Reverts a pledge push using the snapshot produced by pushPledgeToMaster.
export async function revertPledgeUpdates(sheetId, snapshot) {
  if (!snapshot) return;
  const { tab, numericSheetId, updateSnapshot, headerOffset = 0, appendStartRow, appendCount } = snapshot;
  const sheets = getClient();

  if (updateSnapshot?.length > 0) {
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        valueInputOption: "USER_ENTERED",
        data: updateSnapshot.map(({ rowIndex, prevRow }) => ({
          range:  `${tab}!A${rowIndex + headerOffset + 2}`,
          values: [prevRow.length > 0 ? prevRow : [""]],
        })),
      },
    });
  }

  if (appendCount > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: {
        requests: [{
          deleteDimension: {
            range: {
              sheetId:    numericSheetId,
              dimension:  "ROWS",
              startIndex: appendStartRow - 1,            // 0-based
              endIndex:   appendStartRow - 1 + appendCount,
            },
          },
        }],
      },
    });
  }
}

// ── Pledge log ────────────────────────────────────────────────────────────────

const PLEDGE_LOG_TAB     = "_pledge_log_";
const PLEDGE_LOG_HEADERS = ["Fingerprint", "MF No.", "Full Name", "Pledge Amount", "Service", "Entry Date", "Status", "Pushed At"];

function resolvePledgeLogCols(headerRow) {
  const h = (headerRow ?? []).map((c) => String(c).trim().toLowerCase());
  return {
    fingerprint:  h.indexOf("fingerprint"),
    mfNo:         h.indexOf("mf no."),
    fullName:     h.indexOf("full name"),
    pledgeAmount: h.indexOf("pledge amount"),
    service:      h.indexOf("service"),
    entryDate:    h.indexOf("entry date"),
    status:       h.indexOf("status"),
    pushedAt:     h.indexOf("pushed at"),
  };
}

// Returns { fingerprints: string[], logRows: object[] } for all pushed pledge entries.
export async function readPledgeLog(sheetId) {
  const sheets = getClient();
  try {
    const res    = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: PLEDGE_LOG_TAB });
    const values = res.data.values ?? [];
    if (values.length < 2) return { fingerprints: [], logRows: [] };
    const col    = resolvePledgeLogCols(values[0]);
    if (col.fingerprint === -1) return { fingerprints: [], logRows: [] };
    const pushed = values.slice(1).filter((r) =>
      col.status === -1 || String(r[col.status] ?? "").trim() === "pushed"
    );
    return {
      fingerprints: pushed.map((r) => String(r[col.fingerprint] ?? "").trim()).filter(Boolean),
      logRows: pushed.map((r) => ({
        fingerprint:  String(r[col.fingerprint]  ?? "").trim(),
        mfNo:         String(r[col.mfNo]         ?? "").trim(),
        fullName:     String(r[col.fullName]      ?? "").trim(),
        pledgeAmount: String(r[col.pledgeAmount]  ?? "").trim(),
        service:      String(r[col.service]       ?? "").trim(),
        entryDate:    String(r[col.entryDate]     ?? "").trim(),
        pushedAt:     String(r[col.pushedAt]      ?? "").trim(),
      })),
    };
  } catch { return { fingerprints: [], logRows: [] }; }
}

// Appends pledge entries to _pledge_log_, creating the tab with headers if needed.
export async function appendToPledgeLog(sheetId, logRows) {
  if (!logRows.length) return;
  const sheets   = getClient();
  const pushedAt = new Date().toISOString();
  const meta     = await sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "sheets.properties" });
  const existing = meta.data.sheets?.find((s) => s.properties.title === PLEDGE_LOG_TAB);
  if (!existing) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody:   { requests: [{ addSheet: { properties: { title: PLEDGE_LOG_TAB } } }] },
    });
    await sheets.spreadsheets.values.update({
      spreadsheetId:    sheetId,
      range:            `${PLEDGE_LOG_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody:      { values: [PLEDGE_LOG_HEADERS] },
    });
  }
  await sheets.spreadsheets.values.append({
    spreadsheetId:    sheetId,
    range:            `${PLEDGE_LOG_TAB}!A1`,
    valueInputOption: "RAW",
    requestBody: {
      values: logRows.map((r) => [
        r.fingerprint, r.mfNo, r.fullName, r.pledgeAmount, r.service, r.entryDate, "pushed", pushedAt,
      ]),
    },
  });
}

// Marks matched pushed pledge log rows as "reverted".
export async function markPledgeLogReverted(sheetId, fingerprints) {
  if (!fingerprints.length) return;
  const sheets = getClient();
  let values;
  try {
    const res = await sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: PLEDGE_LOG_TAB });
    values    = res.data.values ?? [];
  } catch { return; }
  if (values.length < 2) return;
  const col = resolvePledgeLogCols(values[0]);
  if (col.fingerprint === -1 || col.status === -1) return;
  const fps     = new Set(fingerprints);
  const updates = [];
  values.forEach((row, i) => {
    if (i === 0) return;
    const fp = String(row[col.fingerprint] ?? "").trim();
    const st = String(row[col.status]      ?? "").trim();
    if (fps.has(fp) && st === "pushed") {
      updates.push({ range: `${PLEDGE_LOG_TAB}!${colLetter(col.status)}${i + 1}`, values: [["reverted"]] });
    }
  });
  if (!updates.length) return;
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: sheetId,
    requestBody:   { valueInputOption: "RAW", data: updates },
  });
}
