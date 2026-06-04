"use client";
import Papa from "papaparse";
import * as XLSX from "xlsx";

// Returns a Promise resolving to a 2D array of strings (including header row at index 0)
export function parseFile(file) {
  return new Promise((resolve, reject) => {
    const ext = file.name.split(".").pop().toLowerCase();

    if (ext === "csv") {
      Papa.parse(file, {
        skipEmptyLines: true,
        complete: (result) => resolve(result.data.map((r) => r.map(String))),
        error: reject,
      });
    } else if (ext === "xlsx" || ext === "xls") {
      const reader = new FileReader();
      reader.onload = (e) => {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" });
        resolve(rows.map((r) => r.map(String)));
      };
      reader.onerror = reject;
      reader.readAsArrayBuffer(file);
    } else {
      reject(new Error("Unsupported file type. Upload a .csv or .xlsx file."));
    }
  });
}
