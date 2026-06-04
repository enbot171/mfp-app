const HUMAN_LABELS = {
  MF_AUTOCORRECTED:     "MF prefix added",
  MF_NOT_FOUND:         "MF not found",
  MF_GENERATION_FAILED: "MF generation failed",
  MISSING_REGION:       "Missing region",
  NAME_MISMATCH:     "Name changed",
  NRIC_MISMATCH:     "NRIC changed",
  CONTACT_MISMATCH:  "Contact changed",
  EMAIL_MISMATCH:    "Email changed",
  REGION_MISMATCH:   "Region changed",
  MISSING_CONTACT:   "Missing contact",
  MISSING_EMAIL:     "Missing email",
  MISSING_PLEDGE:    "Missing pledge amount",
  INVALID_PHONE:     "Invalid phone number",
  INVALID_EMAIL:     "Invalid email address",
};

export default function ErrorBadge({ code, message, severity }) {
  const styles = {
    error:   "bg-red-50 text-red-600 border-red-200",
    warning: "bg-amber-50 text-amber-700 border-amber-200",
  };
  const cls   = styles[severity] ?? styles.warning;
  const label = HUMAN_LABELS[code] ?? code;

  return (
    <span
      title={message}
      className={`inline-flex items-center px-2 py-0.5 rounded-md text-xs font-medium border cursor-default whitespace-nowrap ${cls}`}
    >
      {label}
    </span>
  );
}
