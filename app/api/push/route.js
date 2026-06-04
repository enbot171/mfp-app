export const runtime = "nodejs";

import { pushToMasterSheet } from "@/lib/googleSheets";
import { NextResponse } from "next/server";

export async function POST(req) {
  try {
    const { sheetId, tab, updates, appends } = await req.json();

    if (!sheetId || !tab) {
      return NextResponse.json({ error: "Missing sheetId or tab" }, { status: 400 });
    }

    await pushToMasterSheet(sheetId, tab, updates ?? [], appends ?? []);
    return NextResponse.json({ ok: true, updated: updates?.length ?? 0, appended: appends?.length ?? 0 });
  } catch (err) {
    console.error("pushToMasterSheet error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
