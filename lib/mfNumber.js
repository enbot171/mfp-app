// Canonical MF number = "MF" + exactly 3 digits + 1 letter (optionally a 2nd ref
// letter, e.g. MF102AB). Pulls one out of free text or a field value, handling:
//   • explicit "MF123A" / "MFP 123A"
//   • a full NRIC like "S1234567C"            → last 3 digits + final letter (567C)
//   • a bare or single-letter-prefixed partial "123A" / "S123C"
// while ignoring "3 digits + letter" sequences buried inside long tokens
// (transaction / account numbers), which must NOT be treated as an MF.
export function extractMF(input) {
  const s = (input ?? "").toString().trim();
  if (!s) return { value: "", corrected: false };

  let m;
  // 1. Explicit MF + 3 digits + 1–2 letters
  if ((m = s.match(/MF\s*(\d{3}[A-Za-z]{1,2})(?![A-Za-z0-9])/i)))
    return { value: `MF${m[1].toUpperCase()}`, corrected: false };

  // 2. MFP prefix → corrected
  if ((m = s.match(/MFP\s*(\d{3}[A-Za-z]{1,2})(?![A-Za-z0-9])/i)))
    return { value: `MF${m[1].toUpperCase()}`, corrected: true };

  // 3. Full NRIC (optional prefix letter + 7 digits + letter) → last 3 digits + letter
  if ((m = s.match(/(?:^|[^A-Za-z0-9])[A-Za-z]?\d{4}(\d{3})([A-Za-z])(?![A-Za-z0-9])/)))
    return { value: `MF${(m[1] + m[2]).toUpperCase()}`, corrected: true };

  // 4. Bare / single-letter-prefixed partial: 3 digits + 1 letter, standalone token
  if ((m = s.match(/(?:^|[^A-Za-z0-9])[A-Za-z]?(\d{3})([A-Za-z])(?![A-Za-z0-9])/)))
    return { value: `MF${(m[1] + m[2]).toUpperCase()}`, corrected: true };

  return { value: "", corrected: false };
}

// The bare partial NRIC (no "MF" prefix), e.g. "S1234567C" → "567C", "123A" → "123A".
export function extractPartialNric(input) {
  return extractMF(input).value.replace(/^MF/, "");
}
