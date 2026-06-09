"use client";
import Papa from "papaparse";
import * as XLSX from "xlsx";

// Reads every tab from an xlsx/xls as raw values (no stringification — serials and amounts stay numeric).
// Returns { [sheetName]: rows[][] }
export function parseAllSheets(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (ext !== "xlsx" && ext !== "xls") {
    return Promise.reject(new Error("Payment files must be .xlsx or .xls"));
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const wb = XLSX.read(e.target.result, { type: "array" });
      const result = {};
      wb.SheetNames.forEach((name) => {
        result[name] = XLSX.utils.sheet_to_json(wb.Sheets[name], { header: 1, defval: "" });
      });
      resolve(result);
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}

// Returns a Promise resolving to a 2D array of strings (including header row at index 0)
export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split(".").pop().toLowerCase();

    // Drop rows where every cell is empty or whitespace — handles Pabbly's
    // trailing comma-only rows that skipEmptyLines alone doesn't catch.
    const dropBlank = (rows) =>
      rows.filter((row) => row.some((cell) => String(cell).trim() !== ""));

    if (ext === "csv") {
      Papa.parse(file, {
        skipEmptyLines: "greedy",
        complete: (result) => resolve(dropBlank(result.data.map((r) => r.map(String)))),
        error: reject,
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wb   = XLSX.read(e.target.result, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        resolve(dropBlank(rows.map((r) => r.map(String))));
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    } else {
      reject(new Error("Unsupported file type. Upload a .csv or .xlsx file."));
    }
  });
}
