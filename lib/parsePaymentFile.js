import { extractMF } from "./mfNumber.js";

const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

// Tabs that are never transaction sources
const SKIP_TABS = new Set(["master", "pabbly"]);

export const FORMAT_LABELS = {
  format1: "GIRO / Funds Transfer",
  uob_pn:  "UOB PayNow",
  uob_bo:  "UOB Bank Online",
  dbs_pn:  "DBS PayNow",
  dbs_bo:  "DBS Bank Online",
  bank5:   "Bank Transactions (PayNow)",
};

// ── Date helpers ──────────────────────────────────────────────────────────────

const MONTH_NAMES = {
  jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
  jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11,
};

function excelSerialToDate(serial) {
  if (!serial || typeof serial !== "number") return null;
  return new Date(Math.round((serial - 25569) * 86400 * 1000));
}

// YYYYMMDD as integer/string (e.g. 20260519)
function yyyymmddToDate(val) {
  const s = String(Math.round(parseFloat(String(val))));
  if (!/^\d{8}$/.test(s)) return null;
  const year = parseInt(s.slice(0, 4), 10);
  const month = parseInt(s.slice(4, 6), 10) - 1;
  const day   = parseInt(s.slice(6, 8), 10);
  if (year < 2000 || month < 0 || month > 11) return null;
  return new Date(Date.UTC(year, month, day));
}

const fullYear = (y) => { const n = parseInt(y, 10); return n < 100 ? 2000 + n : n; };
const mkDate   = (y, mon, d) =>
  (mon < 0 || mon > 11 || d < 1 || d > 31) ? null : new Date(Date.UTC(y, mon, d));

// Text dates: "18-Jan-2026", "18 Jan 2026", "18/01/2026", "2026-01-18", "Jan 18, 2026"
function parseTextDate(str) {
  const s = str.trim();
  let m;
  // ISO  YYYY-MM-DD
  if ((m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/)))             return mkDate(+m[1], +m[2] - 1, +m[3]);
  // DD <MonthName> YYYY  (sep = space, dash or slash)
  if ((m = s.match(/^(\d{1,2})[\s\-/]+([A-Za-z]{3,})[\s\-/]+(\d{2,4})$/))) {
    const mon = MONTH_NAMES[m[2].slice(0, 3).toLowerCase()];
    if (mon !== undefined) return mkDate(fullYear(m[3]), mon, +m[1]);
  }
  // <MonthName> DD, YYYY
  if ((m = s.match(/^([A-Za-z]{3,})[\s\-/]+(\d{1,2}),?[\s\-/]+(\d{2,4})$/))) {
    const mon = MONTH_NAMES[m[1].slice(0, 3).toLowerCase()];
    if (mon !== undefined) return mkDate(fullYear(m[3]), mon, +m[2]);
  }
  // DD/MM/YYYY or DD-MM-YYYY  (day-first — Singapore bank exports)
  if ((m = s.match(/^(\d{1,2})[/\-](\d{1,2})[/\-](\d{2,4})$/)))   return mkDate(fullYear(m[3]), +m[2] - 1, +m[1]);
  return null;
}

// Unified date parser: Excel serial number, YYYYMMDD, or a text date string.
function parseDateCell(val) {
  if (val === null || val === undefined || val === "") return null;
  if (typeof val === "number") {
    // 8-digit integers are YYYYMMDD, not serials (a real serial is ~5 digits)
    if (Number.isInteger(val) && val >= 19000101 && val <= 99991231) return yyyymmddToDate(val);
    return excelSerialToDate(val);
  }
  const s = String(val).trim();
  if (!s) return null;
  if (/^\d{8}$/.test(s))            return yyyymmddToDate(s);          // YYYYMMDD string
  if (/^\d+(\.\d+)?$/.test(s)) {                                       // numeric string
    const n = parseFloat(s);
    return n >= 19000101 ? yyyymmddToDate(n) : excelSerialToDate(n);
  }
  return parseTextDate(s);                                            // text date
}

function monthFromDate(date) {
  if (!date) return null;
  return MONTH_ABBR[date.getUTCMonth()];
}

// ── MF normalisation ──────────────────────────────────────────────────────────

// MF extraction (direct column value or free-text remarks/description) uses the
// shared canonical extractor — handles MF/MFP, full NRIC → last 3, S123C, and
// ignores 3-digit+letter sequences inside long transaction/account numbers.
const normaliseMFFromRaw = extractMF;
const extractMFFromText  = extractMF;

// ── Date range detection (fix 3) ─────────────────────────────────────────────

// Row 0 of most bank tabs is a date range like "19 May - 25 May".
// format1 has column headers in row 0 — detect and exclude.
function extractDateRange(rows) {
  const cell = String(rows[0]?.[0] ?? "").trim();
  const hasMonth = /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec/i.test(cell);
  return hasMonth ? cell : null;
}

// ── Format detection ──────────────────────────────────────────────────────────

function detectFormat(sheetName, rows) {
  const key = sheetName.toLowerCase();
  if (SKIP_TABS.has(key) || key.startsWith("_")) return null;
  if (!rows || rows.length < 2) return null;

  const r0 = (rows[0] ?? []).map((c) => String(c ?? "").trim());
  const r1 = (rows[1] ?? []).map((c) => String(c ?? "").trim());

  // format1: row 0 is the header with Account Number + Remarks + Deposit
  if (r0.includes("Account Number") && r0.includes("Remarks") && r0.includes("Deposit")) return "format1";

  // dbs_pn: row 1 header has "Transaction Description" columns
  if (r1.some((c) => c.startsWith("Transaction Description"))) return "dbs_pn";

  // uob_pn: row 1 col[0] is "D1"
  if (r1[0] === "D1") return "uob_pn";

  // bank5: row 1 col[2] is "Inward PayNow" (no header row, data starts at row 1)
  if (r1[2] === "Inward PayNow") return "bank5";

  // dbs_bo: col[3] of first data row is an 8-digit YYYYMMDD — check before uob_bo
  if (/^\d{8}$/.test(String(Math.round(parseFloat(String(r1[3]))))) && parseInt(r1[3]) > 20000000) return "dbs_bo";

  // uob_bo: row 1 col[0] starts with MF (MF012A, MF102AB…)
  if (/^MF/i.test(r1[0])) return "uob_bo";

  return null;
}

// ── Row factory ───────────────────────────────────────────────────────────────

function makeRow(idx, sheetName, mfResult, amount, date, rawRef) {
  const month       = monthFromDate(date);
  const fingerprint = [
    date ? date.toISOString().slice(0, 10) : "nodate",
    mfResult.value || "nomf",
    String(amount),
    rawRef,
  ].join("|");
  return {
    rowIndex:       idx,
    fingerprint,
    sheetName,
    mfNumber:       mfResult.value,
    mfAutoCorrected: mfResult.corrected,
    amount,
    date,
    month,
  };
}

// ── Format 1: GIRO / Funds Transfer ──────────────────────────────────────────
// Row 0: Account Number | Value Date | Date | Time | Description | Your Reference | Remarks | Deposit

function parseFormat1(rows, sheetName, startIdx) {
  return rows.slice(1)
    .filter((r) => r.some((c) => c !== "" && c !== null && c !== undefined))
    .map((row, i) => {
      const accountNumber = String(row[0] ?? "").trim();
      const valueDate     = row[1];
      const dateSerial    = row[2];
      const remarks       = String(row[6] ?? "").trim();
      const deposit       = parseFloat(row[7]) || 0;
      const date          = parseDateCell(dateSerial);
      const mfResult      = normaliseMFFromRaw(remarks);
      const rawRef        = [accountNumber, String(valueDate), String(dateSerial), remarks.toUpperCase()].join("|");
      return makeRow(startIdx + i, sheetName, mfResult, deposit, date, rawRef);
    });
}

// ── UOB PayNow ────────────────────────────────────────────────────────────────
// Row 0: date range | Row 1: D1 header | Row 2+: D2 data rows
// Cols: [0]D2 [1]Account [2]ValueDate [3]Date [4]Time [5]Desc [6]YourRef [7]OurRef ... [10]Remarks ... [17]Deposit

function parseUobPn(rows, sheetName, startIdx) {
  return rows.slice(2)
    .filter((r) => String(r[0] ?? "").trim() === "D2")
    .map((row, i) => {
      const accountNumber = String(row[1] ?? "").trim();
      const valueDate     = row[2];
      const dateSerial    = row[3];
      const remarks       = String(row[10] ?? "").trim();
      const deposit       = parseFloat(row[17]) || 0;
      const date          = parseDateCell(dateSerial);
      // Remarks can be "SI        MF321C" — use text extraction, not raw normalise
      const mfResult      = extractMFFromText(remarks);
      const rawRef        = [accountNumber, String(valueDate), String(dateSerial), remarks.toUpperCase()].join("|");
      return makeRow(startIdx + i, sheetName, mfResult, deposit, date, rawRef);
    });
}

// ── UOB Bank Online ───────────────────────────────────────────────────────────
// Row 0: date range | Row 1+: data (no separate header)
// Cols: [0]MF [1]Name [2]Amount [3]Type [4]Bank [5]Date(serial)

function parseUobBo(rows, sheetName, startIdx) {
  return rows.slice(1)
    .filter((r) => r.some((c) => c !== "" && c !== null && c !== undefined))
    .map((row, i) => {
      const mfRaw   = String(row[0] ?? "").trim();
      const amount  = parseFloat(row[2]) || 0;
      const dateVal = row[5];
      const date    = parseDateCell(dateVal);
      const mfResult = normaliseMFFromRaw(mfRaw);
      const rawRef  = [mfRaw.toUpperCase(), String(dateVal), String(amount)].join("|");
      return makeRow(startIdx + i, sheetName, mfResult, amount, date, rawRef);
    });
}

// ── DBS PayNow (GEN PN, BFC, MFP) ────────────────────────────────────────────
// Row 0: date range | Row 1: Date|ValueDate|TxDesc1|TxDesc2|Debit|Credit header | Row 2+: data
// Cols: [0]Date(serial) [1]ValueDate [2]TxDesc1 [3]TxDesc2 [4]Debit [5]Credit

function parseDbsPn(rows, sheetName, startIdx) {
  return rows.slice(2)
    .filter((r) => r.some((c) => c !== "" && c !== null && c !== undefined))
    .map((row, i) => {
      const dateSerial = row[0];
      const desc2      = String(row[3] ?? "").trim();
      const credit     = parseFloat(row[5]) || 0;
      const date       = parseDateCell(dateSerial);
      const mfResult   = extractMFFromText(desc2);
      const rawRef     = [String(dateSerial), desc2.toUpperCase(), String(credit)].join("|");
      return makeRow(startIdx + i, sheetName, mfResult, credit, date, rawRef);
    });
}

// ── DBS Bank Online ───────────────────────────────────────────────────────────
// Row 0: date range | Row 1+: data (no separate header)
// Cols: [0]MF [1]Name [2]Amount [3]Date(YYYYMMDD) [4]Time [5]Type

function parseDbsBo(rows, sheetName, startIdx) {
  return rows.slice(1)
    .filter((r) => r.some((c) => c !== "" && c !== null && c !== undefined))
    .map((row, i) => {
      const mfRaw   = String(row[0] ?? "").trim();
      const amount  = parseFloat(row[2]) || 0;
      const dateVal = row[3];
      const date    = parseDateCell(dateVal);
      const mfResult = normaliseMFFromRaw(mfRaw);
      const rawRef  = [mfRaw.toUpperCase(), String(dateVal), String(amount)].join("|");
      return makeRow(startIdx + i, sheetName, mfResult, amount, date, rawRef);
    });
}

// ── Bank Transactions 5 (PayNow, no header) ───────────────────────────────────
// Row 0: date range | Row 1+: data
// Cols: [0]Date(serial) [1]ValueDate [2]"Inward PayNow" [3]Description [4]Debit [5]Credit

function parseBank5(rows, sheetName, startIdx) {
  return rows.slice(1)
    .filter((r) => r.some((c) => c !== "" && c !== null && c !== undefined))
    .map((row, i) => {
      const dateSerial = row[0];
      const desc       = String(row[3] ?? "").trim();
      const credit     = parseFloat(row[5]) || 0;
      const date       = parseDateCell(dateSerial);
      const mfResult   = extractMFFromText(desc);
      const rawRef     = [String(dateSerial), desc.toUpperCase(), String(credit)].join("|");
      return makeRow(startIdx + i, sheetName, mfResult, credit, date, rawRef);
    });
}

// ── Main export ───────────────────────────────────────────────────────────────

// sheets: { [sheetName]: rows[][] }  (raw values from parseAllSheets)
// Returns { rows: ParsedRow[], formatSummary: [{ sheetName, format, formatLabel, count, dateRange }] }
export function parsePaymentFile(sheets) {
  const allRows       = [];
  const formatSummary = [];
  let rowIdx          = 0;

  for (const [sheetName, rows] of Object.entries(sheets)) {
    const format = detectFormat(sheetName, rows);
    if (!format) continue;

    let parsed = [];
    if      (format === "format1") parsed = parseFormat1(rows, sheetName, rowIdx);
    else if (format === "uob_pn")  parsed = parseUobPn(rows, sheetName, rowIdx);
    else if (format === "uob_bo")  parsed = parseUobBo(rows, sheetName, rowIdx);
    else if (format === "dbs_pn")  parsed = parseDbsPn(rows, sheetName, rowIdx);
    else if (format === "dbs_bo")  parsed = parseDbsBo(rows, sheetName, rowIdx);
    else if (format === "bank5")   parsed = parseBank5(rows, sheetName, rowIdx);

    // Filter empty rows (zero amount + no MF) — likely trailing blank rows
    parsed = parsed.filter((r) => r.amount > 0 || r.mfNumber);

    allRows.push(...parsed);
    rowIdx += parsed.length;

    if (parsed.length > 0) {
      formatSummary.push({
        sheetName,
        format,
        formatLabel: FORMAT_LABELS[format],
        count:       parsed.length,
        dateRange:   extractDateRange(rows), // null for format1
      });
    }
  }

  if (allRows.length === 0) {
    throw new Error(
      "No recognised transaction sheets found. Make sure you are uploading a supported bank export file."
    );
  }

  return { rows: allRows, formatSummary };
}
