export const runtime = "nodejs";

import { fetchMasterSheet } from "@/lib/googleSheets";
import { NextResponse } from "next/server";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sheetId = searchParams.get("sheetId");
  const tab = searchParams.get("tab");

  if (!sheetId || !tab) {
    return NextResponse.json({ error: "Missing sheetId or tab" }, { status: 400 });
  }

  try {
    const data = await fetchMasterSheet(sheetId, tab);
    return NextResponse.json(data);
  } catch (err) {
    console.error("fetchMasterSheet error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
