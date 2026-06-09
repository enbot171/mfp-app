export const runtime = "nodejs";

import { revertPaymentUpdates, markLogReverted } from "@/lib/googleSheets";
import { NextResponse } from "next/server";

// POST /api/payment/revert
// Body: { sheetId, tab, cells: [{range, masterRowIndex, monthColIndex, previousValue, pledgeAmount}], fingerprints: string[] }
// Restores master sheet cell values + colours, marks _payment_log_ rows as "reverted".
export async function POST(req) {
  try {
    const { sheetId, tab, cells = [], fingerprints = [] } = await req.json();
    if (!sheetId || !tab) {
      return NextResponse.json({ error: "Missing sheetId or tab" }, { status: 400 });
    }

    await Promise.all([
      revertPaymentUpdates(sheetId, tab, cells),
      markLogReverted(sheetId, fingerprints),
    ]);

    return NextResponse.json({ reverted: cells.length });
  } catch (err) {
    console.error("revertPaymentUpdates error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
