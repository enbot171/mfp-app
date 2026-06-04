import { PABBLY_COLS } from "@/config/columns";

const VALID_REGIONS = new Set(["north", "north east", "east", "central", "south", "west"]);

// "North Region" → "North", "North East Region" → "North East"
// Non-geographic values ("I Am Not Sure", "Victory International Church", etc.) → ""
function parseRegion(raw) {
  if (!raw) return "";
  const cleaned = raw.replace(/\s*region\s*/i, "").trim();
  return VALID_REGIONS.has(cleaned.toLowerCase()) ? cleaned : "";
}

// "$1,000.00" → "1000.00"
function parseCurrency(raw) {
  if (!raw) return "";
  return raw.replace(/[$,\s]/g, "").trim();
}

// Auto-correct MF number: if missing "MF" prefix, prepend it.
function normaliseMF(raw) {
  const trimmed = (raw ?? "").trim();
  if (!trimmed) return { value: "", corrected: false };
  if (/^MF/i.test(trimmed)) return { value: trimmed.toUpperCase(), corrected: false };
  const corrected = `MF${trimmed}`.toUpperCase();
  return { value: corrected, corrected: true };
}

export function mapPabblyRow(row) {
  const { value: mfNumber, corrected: mfAutoCorrected } = normaliseMF(row[PABBLY_COLS.MF_NUMBER]);
  const partialNric = (
    (row[PABBLY_COLS.NRIC_2] ?? "").trim() ||
    (row[PABBLY_COLS.NRIC_1] ?? "").trim()
  ).toUpperCase();

  return {
    pledgeType:     (row[PABBLY_COLS.PLEDGE_TYPE]     ?? "").trim(),
    mfNumber,
    mfAutoCorrected,
    partialNric,
    fullName:       (row[PABBLY_COLS.FULL_NAME]        ?? "").trim(),
    region:         parseRegion(row[PABBLY_COLS.REGION]),
    postalCode:     (row[PABBLY_COLS.POSTAL_CODE]      ?? "").trim(),
    contactNumber:  (row[PABBLY_COLS.CONTACT_NUMBER]   ?? "").trim(),
    email:          (row[PABBLY_COLS.EMAIL]             ?? "").trim(),
    monthlyPledge:  parseCurrency(row[PABBLY_COLS.MONTHLY_PLEDGE]),
    isAdditional:   !!(row[PABBLY_COLS.ADDITIONAL]     ?? "").trim(),
    entryDate:      (row[PABBLY_COLS.ENTRY_DATE]       ?? "").trim(),
  };
}
