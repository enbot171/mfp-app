export const runtime = "nodejs";

import { fetchMasterSheet, addMonthColumns } from "@/lib/googleSheets";
import { NextResponse } from "next/server";

export async function GET(req) {
  const { searchParams } = new URL(req.url);
  const sheetId = searchParams.get("sheetId");
  const tab     = searchParams.get("tab");
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

// POST /api/sheet
// Body: { sheetId, tab, addMonths: string[] }
// Appends missing month headers to the master sheet header row.
export async function POST(req) {
  try {
    const { sheetId, tab, addMonths } = await req.json();
    if (!sheetId || !tab || !Array.isArray(addMonths)) {
      return NextResponse.json({ error: "Missing sheetId, tab, or addMonths" }, { status: 400 });
    }
    const added = await addMonthColumns(sheetId, tab, addMonths);
    return NextResponse.json({ added });
  } catch (err) {
    console.error("addMonthColumns error:", err);
    return NextResponse.json({ error: err.message }, { status: 500 });
  }
}
