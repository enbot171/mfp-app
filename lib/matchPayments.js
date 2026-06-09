import { MASTER_COLS } from "@/config/columns";

const MONTH_ABBR = ["JAN","FEB","MAR","APR","MAY","JUN","JUL","AUG","SEP","OCT","NOV","DEC"];

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

function findMonthColIndex(masterHeaders, month) {
  if (!month) return -1;
  return masterHeaders.findIndex((h) => h.trim().toUpperCase() === month.toUpperCase());
}

// paymentRows: output of parsePaymentFile().rows
// masterRows / masterHeaders: from /api/sheet
// processedFingerprints: string[] already in the ledger (already pushed)
export function matchPayments(paymentRows, masterRows, masterHeaders, processedFingerprints = []) {
  const mfIndex   = buildMFIndex(masterRows);
  const nricIndex = buildNRICIndex(masterRows);
  const processed = new Set(processedFingerprints);

  // Running totals per cell for transactions within this same file.
  // Key: `${masterRowIndex},${monthColIndex}` → accumulated new total so far.
  const cellTotals = {};

  return paymentRows.map((payRow) => {
    // ── Duplicate ─────────────────────────────────────────────────────────────
    if (processed.has(payRow.fingerprint)) {
      return {
        ...payRow,
        matchType:      "duplicate",
        isDuplicate:    true,
        masterRowIndex: null,
        masterRow:      null,
        name:           "",
        monthColIndex:  -1,
        currentAmount:  0,
        newAmount:      payRow.amount,
        pledgeAmount:   0,
        errors:         [],
      };
    }

    // ── MF lookup ─────────────────────────────────────────────────────────────
    const errors = [];
    let masterRowIndex = null;
    let masterRow      = null;

    if (payRow.mfNumber) {
      if (Object.prototype.hasOwnProperty.call(mfIndex, payRow.mfNumber)) {
        masterRowIndex = mfIndex[payRow.mfNumber];
        masterRow      = masterRows[masterRowIndex];
      } else {
        // NRIC fallback: strip MF prefix and try partial NRIC lookup
        const nricPart = payRow.mfNumber.replace(/^MF/i, "");
        if (Object.prototype.hasOwnProperty.call(nricIndex, nricPart)) {
          masterRowIndex = nricIndex[nricPart];
          masterRow      = masterRows[masterRowIndex];
        } else {
          errors.push({
            code:     "MF_NOT_FOUND",
            message:  `"${payRow.mfNumber}" not found in master sheet`,
            severity: "error",
          });
        }
      }
    } else {
      errors.push({
        code:     "NO_MF",
        message:  "Could not extract an MF number from this row",
        severity: "error",
      });
    }

    if (payRow.mfAutoCorrected) {
      errors.push({
        code:     "MF_AUTOCORRECTED",
        message:  `MF number normalised to "${payRow.mfNumber}"`,
        severity: "info",
      });
    }

    // ── Month column ──────────────────────────────────────────────────────────
    const monthColIndex = findMonthColIndex(masterHeaders, payRow.month);
    if (masterRow && monthColIndex === -1) {
      errors.push({
        code:     "NO_MONTH_COL",
        message:  `Column "${payRow.month}" not found in the master sheet`,
        severity: "error",
      });
    }

    // ── Amounts ───────────────────────────────────────────────────────────────
    const pledgeAmount = masterRow ? (parseFloat(masterRow[MASTER_COLS.PLEDGE_AMOUNT]) || 0) : 0;
    let currentAmount  = 0;
    let newAmount      = payRow.amount;

    if (masterRow && monthColIndex !== -1) {
      const cellKey     = `${masterRowIndex},${monthColIndex}`;
      const sheetValue  = parseFloat(masterRow[monthColIndex]) || 0;
      // If an earlier row in this same file already touched this cell, continue from there
      currentAmount = Object.prototype.hasOwnProperty.call(cellTotals, cellKey)
        ? cellTotals[cellKey]
        : sheetValue;
      newAmount = currentAmount + payRow.amount;
      cellTotals[cellKey] = newAmount;
    }

    const hasErrors = errors.some((e) => e.severity === "error");
    const matchType = hasErrors || !masterRow || monthColIndex === -1 ? "error" : "matched";

    return {
      ...payRow,
      masterRowIndex,
      masterRow,
      name:          masterRow ? (masterRow[MASTER_COLS.FULL_NAME] ?? "").trim() : "",
      monthColIndex,
      currentAmount,
      newAmount,
      pledgeAmount,
      matchType,
      isDuplicate:   false,
      errors,
    };
  });
}
