import { PABBLY_COLS } from "@/config/columns";

// Region names (English, after stripping "Region") + the Mandarin form's Chinese names.
// Anything unrecognised (我不知道, Other Language Group, Victory Intl, I Am Not Sure) → ""
const REGION_MAP = {
  "north": "North", "north east": "North East", "east": "East",
  "central": "Central", "south": "South", "west": "West",
  "北区": "North", "东北区": "North East", "东区": "East",
  "中区": "Central", "南区": "South", "西区": "West",
};

function parseRegion(raw) {
  if (!raw) return "";
  const cleaned = String(raw).replace(/\s*region\s*/i, "").trim();
  return REGION_MAP[cleaned.toLowerCase()] ?? "";
}

// Service / language the pledger submitted under. The English and Mandarin forms
// place this in different columns (service@6 vs service@7), so we scan both and
// match on a known language keyword — postal codes and "Select" are ignored.
const SERVICE_PATTERNS = [
  [/华文部|华文|mandarin/i, "Mandarin"],
  [/方言部|方言|dialect/i,  "Dialect"],
  [/filipino/i,            "Filipino"],
  [/tamil|淡米尔/i,         "Tamil"],
  [/english|英文/i,         "English"],
];

function detectService(...candidates) {
  for (const c of candidates) {
    const s = (c ?? "").toString().trim();
    if (!s) continue;
    for (const [re, val] of SERVICE_PATTERNS) if (re.test(s)) return val;
  }
  return "";
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
    service:        detectService(row[PABBLY_COLS.SELECT_COL], row[PABBLY_COLS.POSTAL_CODE]),
    postalCode:     (row[PABBLY_COLS.POSTAL_CODE]      ?? "").trim(),
    contactNumber:  (row[PABBLY_COLS.CONTACT_NUMBER]   ?? "").trim(),
    email:          (row[PABBLY_COLS.EMAIL]             ?? "").trim(),
    monthlyPledge:  parseCurrency(row[PABBLY_COLS.MONTHLY_PLEDGE]),
    isAdditional:   !!(row[PABBLY_COLS.ADDITIONAL]     ?? "").trim(),
    entryDate:      (row[PABBLY_COLS.ENTRY_DATE]       ?? "").trim(),
  };
}
