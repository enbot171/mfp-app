import * as XLSX from "xlsx";
import fs from "fs";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.join(__dirname, "..");
const OUT_DIR   = path.join(ROOT, "test-payments");

// ── Helpers ─────────────────────────────────────────────────────────────────
const serial    = (d) => Math.floor(d.getTime() / 86400000) + 25569;            // Date → Excel serial
const yyyymmdd   = (d) => d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
const ABBR      = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];
const fmtDay    = (d) => `${d.getUTCDate()} ${["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"][d.getUTCMonth()]}`;
const utc       = (y, m, d) => new Date(Date.UTC(y, m, d));
// deterministic small hash so the dataset is stable across runs
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0); };

// ── Read test-master members ────────────────────────────────────────────────
const mwb  = XLSX.read(fs.readFileSync(path.join(ROOT, "test-master.xlsx")), { type: "buffer" });
const mAll = XLSX.utils.sheet_to_json(mwb.Sheets[mwb.SheetNames[0]], { header: 1, raw: true, defval: "" });
const members = mAll.slice(1)
  .filter((r) => String(r[0]).trim())
  .map((r) => ({ mf: String(r[0]).trim().toUpperCase(), name: String(r[1]).trim() }));

// Bank formats (one tab each), mirroring the MFP Testing Template tabs
const CHANNELS = ["format1", "uob_pn", "uob_bo", "dbs_pn", "dbs_bo", "bank5"];
const TAB = {
  format1: "1Bank Transactions 1", uob_pn: "UOB GEN PN", uob_bo: "UOB GEN BO",
  dbs_pn: "DBS BFC", dbs_bo: "DBS GEN BO", bank5: "DBS GEN PN",
};

// Assign each member a giving cadence, channel and base monthly amount (deterministic)
members.forEach((mem) => {
  const h = hash(mem.mf);
  const c = h % 10;
  mem.cadence = c < 2 ? "none" : c < 6 ? "monthly" : "weekly";   // 20% none, 40% monthly, 40% weekly
  mem.channel = CHANNELS[hash(mem.mf + "ch") % CHANNELS.length];
  mem.base    = 50 + (hash(mem.mf + "amt") % 19) * 25;           // 50..500
});

// ── Build the MAR–AUG week grid (Tue → following Mon) ───────────────────────
const weeks = [];
let cur = utc(2026, 2, 3); // first Tuesday in Mar 2026 (Mar 3) — month index 2 = March
const periodEnd = utc(2026, 7, 31); // Aug 31 — month index 7 = August
let wn = 1;
while (cur <= periodEnd) {
  const end = utc(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + 6);
  weeks.push({ n: wn++, start: new Date(cur), end });
  cur = utc(cur.getUTCFullYear(), cur.getUTCMonth(), cur.getUTCDate() + 7);
}

// ── Generate the transaction stream ─────────────────────────────────────────
const txns = []; // { mem, date, amount }
const round2 = (n) => Math.round(n * 100) / 100;
members.forEach((mem) => {
  if (mem.cadence === "none") return;
  if (mem.cadence === "weekly") {
    const weekly = round2(mem.base / 4);
    weeks.forEach((w) => {
      if (hash(`${mem.mf}-w${w.n}`) % 10 === 0) return;        // ~10% skipped weeks
      txns.push({ mem, date: w.start, amount: weekly });        // pay on the Monday (in-period)
    });
  } else { // monthly — one payment per month on a member-specific day
    const day = 5 + (hash(mem.mf + "day") % 20);               // 5..24
    for (let mo = 2; mo <= 7; mo++) {                          // Mar(2)..Aug(7)
      if (hash(`${mem.mf}-m${mo}`) % 10 === 0) continue;        // ~10% skipped months
      const partial = hash(`${mem.mf}-p${mo}`) % 5 === 0;       // ~20% partial
      txns.push({ mem, date: utc(2026, mo, day), amount: partial ? round2(mem.base / 2) : mem.base });
    }
  }
});

// ── Per-format builders ───────────────────────────────────────────────────────
const pad18 = (set) => { const r = new Array(18).fill(""); Object.entries(set).forEach(([i, v]) => (r[+i] = v)); return r; };
const FORMAT1_HEADER = ["Account Number", "Value Date", "Date", "Time", "Description", "Your Reference", "Remarks", "Deposit"];
const DBSPN_HEADER   = ["Date", "Value Date", "Transaction Description 1", "Transaction Description 2", "Debit", "Credit"];

// Rows that precede each week's data block (the per-week date-range header,
// plus the column/D1 header that the with-header formats repeat each week).
function preamble(ch, range) {
  if (ch === "dbs_pn") return [[range], DBSPN_HEADER];
  if (ch === "uob_pn") return [[range], pad18({ 0: "D1", 1: "Account", 5: "Description", 10: "Remarks", 17: "Deposit" })];
  return [[range]]; // bank5, dbs_bo, uob_bo, format1 (label only)
}
function dataRow(ch, t) {
  switch (ch) {
    case "format1": return ["4584005929", serial(t.date), serial(t.date), 0.5, "Funds Transfer", t.mem.name, t.mem.mf, t.amount];
    case "uob_pn":  return pad18({ 0: "D2", 1: "4502013210", 2: serial(t.date), 3: serial(t.date), 5: "PAYNOW-INWARD", 6: "REF", 10: `SI        ${t.mem.mf}`, 17: t.amount });
    case "uob_bo":  return [t.mem.mf, t.mem.name.toUpperCase(), t.amount, "PBU", "VFCL", serial(t.date)];
    case "dbs_pn":  return [serial(t.date), serial(t.date), "Inward PayNow", `OTHR ${t.mem.mf} PAYMENT`, "", t.amount];
    case "dbs_bo":  return [t.mem.mf, t.mem.name.toUpperCase(), t.amount, yyyymmdd(t.date), 0.5, "PayNow"];
    case "bank5":   return [serial(t.date), serial(t.date), "Inward PayNow", `PAYNOW ${t.mem.mf}`, "", t.amount];
  }
}

// One tab per bank: weeks stacked vertically — date-range header, data, blank row,
// next week's date-range header, … (matches the MFP Testing Template layout).
function buildStackedTab(ch, groups) {
  const rows = [];
  if (ch === "format1") rows.push(FORMAT1_HEADER); // column header sits once at the top
  groups.forEach((g) => {
    preamble(ch, g.range).forEach((r) => rows.push(r));
    g.txns.forEach((t) => rows.push(dataRow(ch, t)));
    rows.push([]); // blank separator between weeks
  });
  return rows;
}

// Emit one cumulative workbook: one tab per bank, weeks `weekIdxs` stacked inside.
function emitStacked(filename, weekIdxs, txnFilter) {
  const wb = XLSX.utils.book_new();
  let count = 0;
  CHANNELS.forEach((ch) => {
    const groups = [];
    weekIdxs.forEach((wi) => {
      const w = weeks[wi];
      let ts = txns.filter((t) => t.mem.channel === ch && t.date >= w.start && t.date <= w.end);
      if (txnFilter) ts = ts.filter(txnFilter);
      ts.sort((a, b) => a.date - b.date);
      if (ts.length) groups.push({ range: `${fmtDay(w.start)} - ${fmtDay(w.end)}`, txns: ts });
    });
    if (!groups.length) return;
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(buildStackedTab(ch, groups)), TAB[ch]);
    count += groups.reduce((n, g) => n + g.txns.length, 0);
  });
  if (!count) return 0;
  XLSX.writeFile(wb, path.join(OUT_DIR, filename));
  return count;
}

const allWeekIdxs = weeks.map((_, i) => i);

// ── Write files ─────────────────────────────────────────────────────────────
fs.rmSync(OUT_DIR, { recursive: true, force: true });
fs.mkdirSync(OUT_DIR, { recursive: true });

// Weekly cumulative (week N = weeks 1..N), weeks stacked inside each bank tab
weeks.forEach((w, i) => {
  const idxs = allWeekIdxs.slice(0, i + 1);
  const n = emitStacked(`weekly-cumulative-${String(w.n).padStart(2, "0")}-to-${ABBR[w.end.getUTCMonth()].toLowerCase()}${w.end.getUTCDate()}.xlsx`, idxs);
  console.log(`  week ${String(w.n).padStart(2)} (→ ${fmtDay(w.end)}): ${n} txns over ${i + 1} week-section(s)`);
});

// Monthly cumulative (through end of each month MAR..AUG), weeks stacked inside each tab
console.log("");
[2, 3, 4, 5, 6, 7].forEach((mo, i) => {
  const cutoff = utc(2026, mo + 1, 0); // last day of month mo
  const n = emitStacked(`monthly-cumulative-${i + 1}-through-${ABBR[mo].toLowerCase()}.xlsx`, allWeekIdxs, (t) => t.date <= cutoff);
  console.log(`  month through ${ABBR[mo]}: ${n} txns`);
});

console.log(`\nMembers: ${members.length} (` +
  `${members.filter((m) => m.cadence === "weekly").length} weekly, ` +
  `${members.filter((m) => m.cadence === "monthly").length} monthly, ` +
  `${members.filter((m) => m.cadence === "none").length} none) · ` +
  `${txns.length} total txns · ${weeks.length} weeks · → test-payments/`);
