import * as XLSX from "xlsx";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROWS_PER_TAB = 50;

// Week number from CLI (default 1). Each week shifts all dates +7 days so the
// transactions get fresh fingerprints — i.e. the next weekly bank statement.
const WEEK       = Math.max(1, parseInt(process.argv[2] ?? "1", 10) || 1);
const DAY_OFFSET = (WEEK - 1) * 7;

// ── Helpers ─────────────────────────────────────────────────────────────────

// Excel serial date for a UTC calendar date (matches lib/parsePaymentFile excelSerialToDate)
const serial = (y, m, d) => Math.floor(Date.UTC(y, m - 1, d) / 86400000) + 25569;
// YYYYMMDD integer (matches yyyymmddToDate, used by DBS Bank Online)
const yyyymmdd = (y, m, d) => y * 10000 + m * 100 + d;

const MONTHS    = [4, 5, 6, 7, 8]; // APR–AUG (master already has these columns)
const MON_NAME  = { 4: "Apr", 5: "May", 6: "Jun", 7: "Jul", 8: "Aug" };
const VALID_MFS = Array.from({ length: 80 }, (_, i) => `MF${101 + i}A`); // MF101A–MF180A
const NAMES     = ["Alice Tan", "Ben Lim", "Chloe Wong", "David Ng", "Emily Goh", "Frank Chua"];

// Messy real-world PayNow descriptions for the DBS PayNow tab (col "Transaction
// Description 2"). These stress the free-text MF extractor: explicit MF, "MFP"
// prefix, bare partial NRIC, and rows with no usable MF buried in long account
// numbers. amount = the real credit; m/baseDay set the transaction date (a week
// offset is added so each weekly file stays collision-free).
const MESSY_DBS = [
  { desc: "MF456B April 2026 0245842758485094853C OTHER MARY TAN LENG HWA 2026042940258", amount: 200,    m: 4, baseDay: 1 },
  { desc: "MFP for Apr '26 789C 0245842758485094853C OTHER LOUISE ENG 2026042940258",     amount: 584.32, m: 4, baseDay: 2 },
  { desc: "NIL 14518450180488E1000000 OTHER LIEW MIN PEI 230584085DHSU39",                amount: 100,    m: 4, baseDay: 3 },
  { desc: "PayNow Transfer 148598581043910000000 OTHER TANG TIAN TIAN 202585490949",      amount: 50,     m: 5, baseDay: 1 },
  { desc: "PayNow Transfer 123A 148598581043910000000 OTHER JOHN LIM 202585490949",       amount: 1000,   m: 5, baseDay: 2 },
  { desc: "Missions Faith Pledge 1983483492898110000000 OTHER CODY TAN 2025929383298",    amount: 190,    m: 6, baseDay: 1 },
  { desc: "For MFP 123J 1983483492898110000000 OTHER SALLY TAN 2025929383298",            amount: 200,    m: 6, baseDay: 2 },
  { desc: "Missionaries 1983483492898110000000 OTHER SARAH LAE 2025929383298",            amount: 250,    m: 7, baseDay: 1 },
];

// Build 50 transaction descriptors for one tab. A few edge cases are mixed in:
//  - index 7  → bare partial NRIC (no "MF" prefix)  → auto-corrected on import
//  - index 23 → MF not in master                    → error row
function buildTxns(seed) {
  const out = [];
  for (let i = 0; i < ROWS_PER_TAB; i++) {
    const m   = MONTHS[i % MONTHS.length];
    // Each week occupies its own 7-day window (wk1: 1–7, wk2: 8–14 …) so dates
    // never roll past day 28 into the next month — keeps months within APR–AUG.
    const day = 1 + ((seed + i * 3) % 7) + DAY_OFFSET;
    let mfText;
    if (i === 7)       mfText = `${105 + (seed % 40)}A`;  // bare NRIC → autocorrect
    else if (i === 23) mfText = "MF999Z";                 // unmatched → error
    else               mfText = VALID_MFS[(seed + i) % VALID_MFS.length];
    out.push({
      mfText,
      name:   NAMES[i % NAMES.length],
      amount: 100 + ((seed + i) % 8) * 50, // 100–450
      y: 2026, m, d: day,
      ref: `REF${seed}${String(i).padStart(3, "0")}`,
    });
  }
  return out;
}

const dateRange = (txns) => {
  const months = [...new Set(txns.map((t) => t.m))].sort((a, b) => a - b);
  return `1 ${MON_NAME[months[0]]} - 28 ${MON_NAME[months[months.length - 1]]} 2026`;
};

const padRow = (len, set) => {
  const row = new Array(len).fill("");
  Object.entries(set).forEach(([i, v]) => { row[+i] = v; });
  return row;
};

// ── Format builders ───────────────────────────────────────────────────────────

// format1 — GIRO / Funds Transfer. Row 0 = header (Account Number / Remarks / Deposit).
function buildFormat1(txns) {
  const rows = [["Account Number", "Value Date", "Date", "Time", "Description", "Your Reference", "Remarks", "Deposit"]];
  txns.forEach((t) => rows.push([
    "1234567890", serial(t.y, t.m, t.d), serial(t.y, t.m, t.d), "10:00:00",
    "GIRO COLLECTION", t.ref, t.mfText, t.amount,
  ]));
  return rows;
}

// uob_pn — UOB PayNow. Row 0 = date range, row 1 = "D1" header, row 2+ = "D2" data.
function buildUobPn(txns) {
  const rows = [[dateRange(txns)], padRow(18, { 0: "D1", 1: "Account", 5: "Description", 10: "Remarks", 17: "Deposit" })];
  txns.forEach((t) => rows.push(padRow(18, {
    0: "D2", 1: "1234567890", 2: serial(t.y, t.m, t.d), 3: serial(t.y, t.m, t.d),
    4: "10:00", 5: "PAYNOW-INWARD", 6: t.ref, 10: `SI        ${t.mfText}`, 17: t.amount,
  })));
  return rows;
}

// uob_bo — UOB Bank Online. Row 0 = date range, row 1+ = data ([0]MF [2]Amount [5]Date serial).
function buildUobBo(txns) {
  const rows = [[dateRange(txns)]];
  txns.forEach((t) => rows.push([t.mfText, t.name, t.amount, "PayNow", "DBS", serial(t.y, t.m, t.d)]));
  return rows;
}

// dbs_pn — DBS PayNow. Row 0 = date range, row 1 = header (Transaction Description), row 2+ = data.
function buildDbsPn(txns) {
  const rows = [
    [dateRange(txns)],
    ["Date", "Value Date", "Transaction Description", "Transaction Description 2", "Debit", "Credit"],
  ];
  txns.forEach((t, i) => {
    // First rows carry the messy real-world descriptions; the rest are clean.
    const messy = MESSY_DBS[i];
    if (messy) {
      const d = messy.baseDay + DAY_OFFSET;
      rows.push([serial(2026, messy.m, d), serial(2026, messy.m, d), "INWARD PAYNOW", messy.desc, "", messy.amount]);
    } else {
      rows.push([serial(t.y, t.m, t.d), serial(t.y, t.m, t.d), "INWARD PAYNOW", `OTHR ${t.mfText} PAYMENT`, "", t.amount]);
    }
  });
  return rows;
}

// dbs_bo — DBS Bank Online. Row 0 = date range, row 1+ = data ([0]MF [2]Amount [3]YYYYMMDD).
function buildDbsBo(txns) {
  const rows = [[dateRange(txns)]];
  txns.forEach((t) => rows.push([t.mfText, t.name, t.amount, yyyymmdd(t.y, t.m, t.d), "12:00:00", "PayNow"]));
  return rows;
}

// bank5 — PayNow inward (no header). Row 0 = date range, row 1+ = data ([2]"Inward PayNow" [3]Desc [5]Credit).
function buildBank5(txns) {
  const rows = [[dateRange(txns)]];
  txns.forEach((t) => rows.push([
    serial(t.y, t.m, t.d), serial(t.y, t.m, t.d), "Inward PayNow", `PAYNOW ${t.mfText}`, "", t.amount,
  ]));
  return rows;
}

// ── File assembly ───────────────────────────────────────────────────────────

// One combined workbook per week, holding every bank format as a separate tab.
const TABS = [
  { sheet: "UOB PayNow",    build: buildUobPn,   seed: 1  },
  { sheet: "UOB Online",    build: buildUobBo,   seed: 17 },
  { sheet: "DBS PayNow",    build: buildDbsPn,   seed: 33 },
  { sheet: "DBS Online",    build: buildDbsBo,   seed: 49 },
  { sheet: "GIRO",          build: buildFormat1, seed: 65 },
  { sheet: "PayNow Inward", build: buildBank5,   seed: 81 },
];

const wb = XLSX.utils.book_new();
TABS.forEach(({ sheet, build, seed }) => {
  const ws = XLSX.utils.aoa_to_sheet(build(buildTxns(seed)));
  XLSX.utils.book_append_sheet(wb, ws, sheet);
});

const name    = `test-payment-week${WEEK}.xlsx`;
const outPath = path.join(__dirname, "..", name);
XLSX.writeFile(wb, outPath);
console.log(`✓ ${name} — ${TABS.length} tabs, ${TABS.length * ROWS_PER_TAB} transactions (${TABS.map((t) => t.sheet).join(", ")})`);
