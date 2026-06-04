// Header label used for the status column appended to every queue row.
export const QUEUE_STATUS_HEADER = "status";

// Column indices for the Pabbly CSV (0-based). Row 0 is the header — data starts at row 1.
export const PABBLY_COLS = {
  PLEDGE_TYPE: 0,    // "I have made a pledge before..." or blank
  NRIC_1: 1,         // Partial NRIC (first occurrence, often empty)
  MF_NUMBER: 2,      // MFP number e.g. "MF123C"
  NRIC_2: 3,         // Partial NRIC (second occurrence, used when no MF)
  FULL_NAME: 4,
  REGION: 5,         // "North Region", "East Region", etc.
  SELECT_COL: 6,     // dropdown value, ignored
  POSTAL_CODE: 7,    // often empty
  CONTACT_NUMBER: 8,
  EMAIL: 9,
  MONTHLY_PLEDGE: 10, // "$1,000.00" or "100.00"
  ADDITIONAL: 11,    // "Additional Pledge" string, or empty
  ENTRY_DATE: 12,
  TICKET_ID: 13,
  ENTRY_IP: 14,
  POINT_OF_CONTACT: 15,
};

// Column indices for the Master Google Sheet (0-based, after headers row)
export const MASTER_COLS = {
  MF_NUMBER: 0,
  FULL_NAME: 1,
  REGION: 2,
  PARTIAL_NRIC: 3,
  REF_NO: 4,         // blank for most records; auto-assigned (1, 2, …) when multiple people share the same MF number
  CONTACT_NUMBER: 5,
  EMAIL: 6,
  SERVICE: 7,        // preserved from master, not overwritten
  PLEDGE_AMOUNT: 8,
  // Monthly columns (MAR, APR, MAY…) are managed by the payment processor (Phase 2), not touched here
};
