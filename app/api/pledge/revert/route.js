export const runtime = "nodejs";

import { revertPledgeUpdates, markPledgeLogReverted } from "@/lib/googleSheets";
import { NextResponse } from "next/server";

// POST /api/pledge/revert
// Body: { sheetId, snapshot, fingerprints }
// Reverts master sheet changes and marks _pledge_log_ rows as "reverted" in parallel.
export async function POST(req) {
  try {
    const { sheetId, snapshot, fingerprints = [] } = await req.json();
    if (!sheetId || !snapshot) {
      return NextResponse.json({ error: "Missing sheetId or snapshot" }, { status: 400 });
    }
    await Promise.all([
      revertPledgeUpdates(sheetId, snapshot),
      markPledgeLogReverted(sheetId, fingerprints),
    ]);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("revertPledgeUpdates error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
