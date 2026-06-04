import * as XLSX from "xlsx";

// Parses a filled-in review report XLSX.
// Returns { decisions: [{ mfNumber, refNo, field, decision: "master"|"pabbly" }], matched }
export function parseReviewResponse(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb   = XLSX.read(e.target.result, { type: "array" });
        const ws   = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });

        const decisions = [];
        let matched = 0;

        rows.forEach((row) => {
          const mfNumber = String(row["_mfNumber"] ?? "").trim();
          const refNo    = String(row["_refNo"]    ?? "").trim();
          const field    = String(row["_field"]    ?? "").trim();
          const decision = String(row["Decision"]  ?? "").trim().toLowerCase();

          if (!mfNumber || !field || !decision) return;

          if (decision === "current") { decisions.push({ mfNumber, refNo, field, decision: "master" }); matched++; }
          if (decision === "new")     { decisions.push({ mfNumber, refNo, field, decision: "pabbly" }); matched++; }
        });

        resolve({ decisions, matched });
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
}
