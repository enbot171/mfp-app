import { MASTER_COLS } from "@/config/columns";

function parseCurrencyNum(str) {
  if (!str) return 0;
  return parseFloat(String(str).replace(/[$,\s]/g, "")) || 0;
}

export function calcPledge(pabblyRow, masterRow) {
  const newMonthly = parseCurrencyNum(pabblyRow.monthlyPledge);

  if (!pabblyRow.isAdditional) {
    return newMonthly.toFixed(2);
  }

  // Additional pledge: stack on top of existing master pledge
  const existingPledge = masterRow
    ? parseCurrencyNum(masterRow[MASTER_COLS.PLEDGE_AMOUNT])
    : 0;
  return (existingPledge + newMonthly).toFixed(2);
}
