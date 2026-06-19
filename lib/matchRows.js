import { MASTER_COLS, PABBLY_COLS } from "@/config/columns";
import { mapPabblyRow } from "./mapFields";
import { calcPledge } from "./calcPledge";
import { validateRow } from "./validateRows";

// MF numbers are unique in master — one index entry per MF
function buildMFIndex(masterRows) {
  const map = {};
  masterRows.forEach((row, i) => {
    const mf = (row[MASTER_COLS.MF_NUMBER] ?? "").trim().toUpperCase();
    if (mf) map[mf] = i;
  });
  return map;
}

function buildNRICIndex(masterRows) {
  const map = {};
  masterRows.forEach((row, i) => {
    const nric = (row[MASTER_COLS.PARTIAL_NRIC] ?? "").trim().toUpperCase();
    if (nric) map[nric] = i;
  });
  return map;
}

function isFirstTimePledger(pledgeType) {
  const s = (pledgeType ?? "").toLowerCase();
  // English "first time" or Mandarin "这是我第一次承诺" (第一次 = first time)
  return s.includes("first time") || (pledgeType ?? "").includes("第一次");
}

// For new rows: derive MF number from NRIC ("999A" → "MF999A").
// If that MF already exists in master or was already assigned in this batch,
// append a capital letter suffix (A, B, C…) until a free slot is found.
// The suffix letter is stored as the Ref No.
function assignNewMFNumbers(results, masterRows) {
  const existingMFs = new Set(
    masterRows
      .map((row) => (row[MASTER_COLS.MF_NUMBER] ?? "").trim().toUpperCase())
      .filter(Boolean)
  );
  const batchMFs = new Set(); // MFs assigned earlier in this same upload
  const LETTERS  = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

  results.forEach((result) => {
    if (result.masterRowIndex !== null || result.matchType !== "new") return;

    const nric = (result.pabblyRow.partialNric ?? "").toUpperCase();
    if (!nric) return;

    const baseMF = `MF${nric}`;

    // Try base MF first
    if (!existingMFs.has(baseMF) && !batchMFs.has(baseMF)) {
      result.outputRow[MASTER_COLS.MF_NUMBER] = baseMF;
      result.outputRow[MASTER_COLS.REF_NO]    = "";
      batchMFs.add(baseMF);
      return;
    }

    // Base taken — try MF+A, MF+B, …
    for (let i = 0; i < LETTERS.length; i++) {
      const ref         = LETTERS[i];
      const candidateMF = `${baseMF}${ref}`;
      if (!existingMFs.has(candidateMF) && !batchMFs.has(candidateMF)) {
        result.outputRow[MASTER_COLS.MF_NUMBER] = candidateMF;
        result.outputRow[MASTER_COLS.REF_NO]    = ref;
        batchMFs.add(candidateMF);
        return;
      }
    }

    // All 26 letters exhausted — should never happen in practice
    result.errors.push({
      code:     "MF_GENERATION_FAILED",
      message:  `Could not generate a unique MF number from NRIC ${nric} — too many conflicts`,
      severity: "error",
    });
    result.hasErrors = true;
    result.matchType = "error";
  });
}

export function matchRows(pabblyRawRows, masterRows, masterHeaders) {
  const mfIndex   = buildMFIndex(masterRows);
  const nricIndex = buildNRICIndex(masterRows);
  const dataRows  = pabblyRawRows.slice(1);

  const results = dataRows.map((rawRow, i) => {
    const pabbly    = mapPabblyRow(rawRow);
    const firstTime = isFirstTimePledger(pabbly.pledgeType);
    const errors    = [];

    if (pabbly.mfAutoCorrected) {
      errors.push({
        code:     "MF_AUTOCORRECTED",
        message:  `MF number was missing the "MF" prefix — auto-corrected to "${pabbly.mfNumber}"`,
        severity: "warning",
      });
    }

    let masterRowIndex = null;
    let masterRow      = null;
    let matched        = false;

    if (pabbly.mfNumber) {
      const key = pabbly.mfNumber.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(mfIndex, key)) {
        masterRowIndex = mfIndex[key];
        masterRow      = masterRows[masterRowIndex];
        matched        = true;
      } else {
        errors.push({
          code:     "MF_NOT_FOUND",
          message:  `MF number "${pabbly.mfNumber}" could not be found in the master sheet`,
          severity: "error",
        });
      }
    }

    // NRIC fallback for returning pledgers who didn't provide their MF number.
    // Skipped for first-time pledgers — their NRIC is used to generate a new MF, not to find an existing row.
    if (!matched && !firstTime && pabbly.partialNric) {
      const key = pabbly.partialNric.toUpperCase();
      if (Object.prototype.hasOwnProperty.call(nricIndex, key)) {
        masterRowIndex = nricIndex[key];
        masterRow      = masterRows[masterRowIndex];
        matched        = true;
        // Remove the MF_NOT_FOUND error that was pushed when the MF lookup failed,
        // since the row was successfully identified via NRIC.
        const mfErrIdx = errors.findIndex((e) => e.code === "MF_NOT_FOUND");
        if (mfErrIdx !== -1) errors.splice(mfErrIdx, 1);
      }
    }

    // Cross-validate when matched
    if (masterRow) {
      const masterName    = (masterRow[MASTER_COLS.FULL_NAME]      ?? "").trim();
      const masterNric    = (masterRow[MASTER_COLS.PARTIAL_NRIC]   ?? "").trim().toUpperCase();
      const masterContact = (masterRow[MASTER_COLS.CONTACT_NUMBER] ?? "").trim();
      const masterEmail   = (masterRow[MASTER_COLS.EMAIL]          ?? "").trim();
      const masterRegion  = (masterRow[MASTER_COLS.REGION]         ?? "").trim();

      if (pabbly.fullName && masterName && pabbly.fullName.toLowerCase() !== masterName.toLowerCase())
        errors.push({ code: "NAME_MISMATCH",    message: `Name on record is "${masterName}" but form shows "${pabbly.fullName}"`, severity: "warning" });
      if (pabbly.partialNric && masterNric && pabbly.partialNric !== masterNric)
        errors.push({ code: "NRIC_MISMATCH",    message: `NRIC on record is "${masterNric}" but form shows "${pabbly.partialNric}"`, severity: "warning" });
      if (pabbly.contactNumber && masterContact && pabbly.contactNumber !== masterContact)
        errors.push({ code: "CONTACT_MISMATCH", message: `Contact on record is "${masterContact}" but form shows "${pabbly.contactNumber}"`, severity: "warning" });
      if (pabbly.email && masterEmail && pabbly.email.toLowerCase() !== masterEmail.toLowerCase())
        errors.push({ code: "EMAIL_MISMATCH",   message: `Email on record is "${masterEmail}" but form shows "${pabbly.email}"`, severity: "warning" });
      if (pabbly.region && masterRegion && pabbly.region.toLowerCase() !== masterRegion.toLowerCase())
        errors.push({ code: "REGION_MISMATCH",  message: `Region on record is "${masterRegion}" but form shows "${pabbly.region}"`, severity: "warning" });
    }

    errors.push(...validateRow(pabbly, masterRow));

    const pledgeAmount = calcPledge(pabbly, masterRow);

    let outputRow;
    if (masterRow) {
      outputRow = [...masterRow];
      if (pabbly.fullName)      outputRow[MASTER_COLS.FULL_NAME]      = pabbly.fullName;
      if (pabbly.region)        outputRow[MASTER_COLS.REGION]         = pabbly.region;
      if (pabbly.partialNric)   outputRow[MASTER_COLS.PARTIAL_NRIC]   = pabbly.partialNric;
      if (pabbly.contactNumber) outputRow[MASTER_COLS.CONTACT_NUMBER] = pabbly.contactNumber;
      if (pabbly.email)         outputRow[MASTER_COLS.EMAIL]          = pabbly.email;
      // Service: only fill when the master cell is blank — never overwrite a manually-set one
      if (pabbly.service && !String(masterRow[MASTER_COLS.SERVICE] ?? "").trim()) {
        outputRow[MASTER_COLS.SERVICE] = pabbly.service;
      }
      outputRow[MASTER_COLS.PLEDGE_AMOUNT] = pledgeAmount;
    } else {
      outputRow = Array(Math.max(masterHeaders.length, MASTER_COLS.PLEDGE_AMOUNT + 1)).fill("");
      // MF_NUMBER and REF_NO for new rows are filled by assignNewMFNumbers below
      outputRow[MASTER_COLS.MF_NUMBER]      = pabbly.mfNumber || "";
      outputRow[MASTER_COLS.FULL_NAME]      = pabbly.fullName;
      outputRow[MASTER_COLS.REGION]         = pabbly.region;
      outputRow[MASTER_COLS.PARTIAL_NRIC]   = pabbly.partialNric;
      outputRow[MASTER_COLS.CONTACT_NUMBER] = pabbly.contactNumber;
      outputRow[MASTER_COLS.EMAIL]          = pabbly.email;
      // New pledger: always record the service (default English when none detected)
      outputRow[MASTER_COLS.SERVICE]        = pabbly.service || "English";
      outputRow[MASTER_COLS.PLEDGE_AMOUNT]  = pledgeAmount;
    }

    const hasErrors   = errors.some((e) => e.severity === "error");
    // MF_AUTOCORRECTED is informational — it doesn't need admin review
    const hasWarnings = errors.some((e) => e.severity === "warning" && e.code !== "MF_AUTOCORRECTED");

    let matchType;
    if (matched) {
      matchType = hasErrors || hasWarnings ? "review" : "update";
    } else {
      matchType = firstTime ? "new" : "error";
    }

    return {
      pabblyIndex:    i,
      ticketId:       (rawRow[PABBLY_COLS.TICKET_ID] ?? "").trim(),
      pabblyRow:      pabbly,
      masterRow,
      matchType,
      masterRowIndex,
      outputRow,
      errors,
      hasErrors,
    };
  });

  // Generate unique MF numbers for first-time pledger rows
  assignNewMFNumbers(results, masterRows);

  return results;
}
