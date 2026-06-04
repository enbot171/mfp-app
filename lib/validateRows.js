import { MASTER_COLS } from "@/config/columns";

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE_REGEX = /^\d{8,15}$/;

export function validateRow(pabblyRow, masterRow) {
  const errors = [];

  const masterContact = (masterRow?.[MASTER_COLS.CONTACT_NUMBER] ?? "").trim();
  const masterEmail   = (masterRow?.[MASTER_COLS.EMAIL]          ?? "").trim();

  if (!pabblyRow.contactNumber) {
    if (!masterContact) {
      errors.push({ code: "MISSING_CONTACT", message: "Contact number is missing", severity: "error" });
    }
  } else if (!PHONE_REGEX.test(pabblyRow.contactNumber.replace(/\D/g, ""))) {
    errors.push({ code: "INVALID_PHONE", message: `Invalid contact number: "${pabblyRow.contactNumber}"`, severity: "error" });
  }

  if (!pabblyRow.email) {
    if (!masterEmail) {
      errors.push({ code: "MISSING_EMAIL", message: "Email address is missing", severity: "error" });
    }
  } else if (!EMAIL_REGEX.test(pabblyRow.email)) {
    errors.push({ code: "INVALID_EMAIL", message: `Invalid email: "${pabblyRow.email}"`, severity: "error" });
  }

  if (!pabblyRow.monthlyPledge) {
    errors.push({ code: "MISSING_PLEDGE", message: "Pledge amount is missing", severity: "error" });
  }

  if (!pabblyRow.region) {
    const postalNote = pabblyRow.postalCode ? ` — postal code: ${pabblyRow.postalCode}` : "";
    errors.push({
      code: "MISSING_REGION",
      message: `Region not provided or unrecognised${postalNote}. Select the correct region from the dropdown.`,
      severity: "warning",
    });
  }

  return errors;
}
