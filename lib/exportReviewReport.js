import * as XLSX from "xlsx";
import { MASTER_COLS } from "@/config/columns";

const MISMATCH_META = {
  NAME_MISMATCH:    { colIndex: MASTER_COLS.FULL_NAME,      label: "Name" },
  NRIC_MISMATCH:    { colIndex: MASTER_COLS.PARTIAL_NRIC,   label: "NRIC" },
  CONTACT_MISMATCH: { colIndex: MASTER_COLS.CONTACT_NUMBER, label: "Contact" },
  EMAIL_MISMATCH:   { colIndex: MASTER_COLS.EMAIL,          label: "Email" },
  REGION_MISMATCH:  { colIndex: MASTER_COLS.REGION,         label: "Region" },
};

const today = () => new Date().toISOString().slice(0, 10);
const slug   = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

// One spreadsheet row per mismatched field across the given review results.
// includeRegion → adds a visible "Region" column (used by the combined export).
function buildDataRows(reviewRows, includeRegion) {
  const dataRows = [];
  reviewRows.forEach((result) => {
    const mf     = (result.outputRow[MASTER_COLS.MF_NUMBER] ?? "").trim();
    const ref    = (result.masterRow?.[MASTER_COLS.REF_NO]  ?? "").toString().trim();
    const name   = (result.outputRow[MASTER_COLS.FULL_NAME] ?? "").trim();
    const region = (result.outputRow[MASTER_COLS.REGION]    ?? "").trim();

    result.errors
      .filter((e) => e.severity === "warning" && MISMATCH_META[e.code])
      .forEach((err) => {
        const { colIndex, label } = MISMATCH_META[err.code];
        const row = {
          _mfNumber:   mf,
          _refNo:      ref,
          _field:      label,
          "MF No.":    mf,
          "Ref No.":   ref,
          ...(includeRegion ? { "Region": region } : {}),
          "Full Name": name,
          "Field":     label,
          "Current":   (result.masterRow?.[colIndex] ?? "").toString().trim(),
          "New":       (result.outputRow[colIndex]   ?? "").toString().trim(),
          "Decision":  "",
          "Notes":     "",
        };
        dataRows.push(row);
      });
  });
  return dataRows;
}

// Build a workbook (review sheet + instructions) from prepared data rows.
function buildWorkbook(dataRows, sheetLabel, includeRegion) {
  const header = [
    "_mfNumber", "_refNo", "_field", "MF No.", "Ref No.",
    ...(includeRegion ? ["Region"] : []),
    "Full Name", "Field", "Current", "New", "Decision", "Notes",
  ];

  // Hint row — shows "(Current / New)" under the Decision header.
  // Skipped on import because _mfNumber is empty.
  const hintRow = Object.fromEntries(header.map((h) => [h, h === "Decision" ? "(Current / New)" : ""]));

  const ws = XLSX.utils.json_to_sheet([hintRow, ...dataRows], { header });
  ws["!cols"] = header.map((h) => {
    if (h.startsWith("_")) return { hidden: true };
    if (h === "Current" || h === "New") return { wch: 25 };
    if (h === "Full Name" || h === "Notes") return { wch: h === "Notes" ? 30 : 20 };
    return { wch: 12 };
  });

  const instructions = XLSX.utils.aoa_to_sheet([
    ["Review Report — Instructions"],
    [""],
    ["For each row, select a value in the Decision column:"],
    [""],
    ["  Current  →  Keep the current value from the master sheet"],
    ["  New      →  Use the new value submitted via the form"],
    ["  (blank)  →  No decision yet — row stays under review"],
    [""],
    ["If two people share the same MF No., the Ref No. column tells them apart."],
    [""],
    ["You may fill in partial decisions — only rows with a Decision will be resolved."],
    ["Do not add, remove, or reorder rows. Do not edit any other columns."],
    ["Save the file and return it to the admin to be uploaded back into the app."],
  ]);

  const wb = XLSX.utils.book_new();
  // Sheet name capped at Excel's 31-char limit
  XLSX.utils.book_append_sheet(wb, ws, sheetLabel.slice(0, 31));
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions");
  return wb;
}

function downloadWorkbook(wb, filename) {
  const buf  = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

const regionOf = (r) => (r.outputRow[MASTER_COLS.REGION] ?? "").trim();

// ── Public API ──────────────────────────────────────────────────────────────

// Single region → one file.
export function exportReviewReport(reviewRows, regionLabel) {
  const dataRows = buildDataRows(reviewRows, false);
  if (dataRows.length === 0) return;
  downloadWorkbook(buildWorkbook(dataRows, regionLabel, false), `review-${slug(regionLabel)}-${today()}.xlsx`);
}

// All regions, one file per region (downloads are staggered so the browser
// doesn't drop them). Returns the number of files generated.
export function exportAllRegionsSeparate(reviewRows) {
  const byRegion = new Map();
  reviewRows.forEach((r) => {
    if (r.matchType !== "review") return;
    const region = regionOf(r);
    if (!region) return;
    if (!byRegion.has(region)) byRegion.set(region, []);
    byRegion.get(region).push(r);
  });

  const regions = [...byRegion.keys()].sort();
  regions.forEach((region, i) => {
    const dataRows = buildDataRows(byRegion.get(region), false);
    if (dataRows.length === 0) return;
    const wb = buildWorkbook(dataRows, region, false);
    setTimeout(() => downloadWorkbook(wb, `review-${slug(region)}-${today()}.xlsx`), i * 350);
  });
  return regions.length;
}

// All regions in a single file (one sheet, with a Region column).
export function exportAllRegionsCombined(reviewRows) {
  const rows = reviewRows.filter((r) => r.matchType === "review" && regionOf(r));
  const dataRows = buildDataRows(rows, true);
  if (dataRows.length === 0) return;
  downloadWorkbook(buildWorkbook(dataRows, "All Regions", true), `review-all-regions-${today()}.xlsx`);
}
