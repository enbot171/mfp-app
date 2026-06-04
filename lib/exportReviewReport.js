import * as XLSX from "xlsx";
import { MASTER_COLS } from "@/config/columns";

const MISMATCH_META = {
  NAME_MISMATCH:    { colIndex: MASTER_COLS.FULL_NAME,      label: "Name" },
  NRIC_MISMATCH:    { colIndex: MASTER_COLS.PARTIAL_NRIC,   label: "NRIC" },
  CONTACT_MISMATCH: { colIndex: MASTER_COLS.CONTACT_NUMBER, label: "Contact" },
  EMAIL_MISMATCH:   { colIndex: MASTER_COLS.EMAIL,          label: "Email" },
  REGION_MISMATCH:  { colIndex: MASTER_COLS.REGION,         label: "Region" },
};

export function exportReviewReport(reviewRows, regionLabel) {
  const date = new Date().toISOString().slice(0, 10);
  const dataRows = [];

  reviewRows.forEach((result) => {
    const mf   = (result.outputRow[MASTER_COLS.MF_NUMBER] ?? "").trim();
    const ref  = (result.masterRow?.[MASTER_COLS.REF_NO]  ?? "").toString().trim();
    const name = (result.outputRow[MASTER_COLS.FULL_NAME]  ?? "").trim();

    result.errors
      .filter((e) => e.severity === "warning" && MISMATCH_META[e.code])
      .forEach((err) => {
        const { colIndex, label } = MISMATCH_META[err.code];
        dataRows.push({
          _mfNumber:   mf,
          _refNo:      ref,
          _field:      label,
          "MF No.":    mf,
          "Ref No.":   ref,
          "Full Name": name,
          "Field":     label,
          "Current":   (result.masterRow?.[colIndex] ?? "").toString().trim(),
          "New":       (result.outputRow[colIndex]   ?? "").toString().trim(),
          "Decision":  "",
          "Notes":     "",
        });
      });
  });

  if (dataRows.length === 0) return;

  const ws = XLSX.utils.json_to_sheet(dataRows, {
    header: ["_mfNumber", "_refNo", "_field", "MF No.", "Ref No.", "Full Name", "Field", "Current", "New", "Decision", "Notes"],
  });

  ws["!cols"] = [
    { hidden: true },  // _mfNumber
    { hidden: true },  // _refNo
    { hidden: true },  // _field
    { wch: 10 },       // MF No.
    { wch: 8  },       // Ref No.
    { wch: 20 },       // Full Name
    { wch: 12 },       // Field
    { wch: 25 },       // Current
    { wch: 25 },       // New
    { wch: 14 },       // Decision  ← column J (index 9)
    { wch: 30 },       // Notes
  ];

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
  XLSX.utils.book_append_sheet(wb, ws, regionLabel);
  XLSX.utils.book_append_sheet(wb, instructions, "Instructions");

  const buf  = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  const blob = new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement("a");
  a.href     = url;
  a.download = `review-${regionLabel.toLowerCase().replace(/\s+/g, "-")}-${date}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}
