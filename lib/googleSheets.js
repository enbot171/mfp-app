import { google } from "googleapis";

const QUEUE_TAB = "_pabbly_queue";

function getClient() {
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL,
      private_key: process.env.GOOGLE_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    },
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });
  return google.sheets({ version: "v4", auth });
}

// Returns { headers: string[], rows: string[][], title: string }
export async function fetchMasterSheet(sheetId, tab) {
  const sheets = getClient();

  const [valuesRes, metaRes] = await Promise.all([
    sheets.spreadsheets.values.get({ spreadsheetId: sheetId, range: tab }),
    sheets.spreadsheets.get({ spreadsheetId: sheetId, fields: "properties.title" }),
  ]);

  const [headers, ...rows] = valuesRes.data.values ?? [];
  const title = metaRes.data.properties?.title ?? sheetId;
  return { headers: headers ?? [], rows: rows ?? [], title };
}

// Returns raw rows [[header,...], [row1,...], ...] or null if tab missing / empty
export async function readQueueTab(sheetId) {
  const sheets = getClient();
  try {
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: sheetId,
      range: QUEUE_TAB,
    });
    const values = res.data.values ?? [];
    if (values.length < 2) return null;
    return values;
  } catch {
    return null;
  }
}

// Writes rawRows ([[header,...], [row1,...], ...]) to _pabbly_queue tab.
// Creates the tab if it doesn't exist. Pass [] to clear only.
export async function writeQueueTab(sheetId, rawRows) {
  const sheets = getClient();

  const meta = await sheets.spreadsheets.get({
    spreadsheetId: sheetId,
    fields: "sheets.properties.title",
  });
  const tabExists = meta.data.sheets?.some((s) => s.properties.title === QUEUE_TAB);

  if (!tabExists) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { requests: [{ addSheet: { properties: { title: QUEUE_TAB } } }] },
    });
  } else {
    await sheets.spreadsheets.values.clear({ spreadsheetId: sheetId, range: QUEUE_TAB });
  }

  if (rawRows && rawRows.length > 0) {
    await sheets.spreadsheets.values.update({
      spreadsheetId: sheetId,
      range: `${QUEUE_TAB}!A1`,
      valueInputOption: "RAW",
      requestBody: { values: rawRows },
    });
  }
}

// updates: Array<{ rowIndex: number, values: string[] }>  (rowIndex is 0-based data row)
// appends: Array<string[]>
export async function pushToMasterSheet(sheetId, tab, updates, appends) {
  const sheets = getClient();

  if (updates.length > 0) {
    const data = updates.map(({ rowIndex, values }) => ({
      // +2: convert 0-based data row to 1-based sheet row, then skip header row
      range: `${tab}!A${rowIndex + 2}`,
      values: [values],
    }));
    await sheets.spreadsheets.values.batchUpdate({
      spreadsheetId: sheetId,
      requestBody: { valueInputOption: "USER_ENTERED", data },
    });
  }

  if (appends.length > 0) {
    await sheets.spreadsheets.values.append({
      spreadsheetId: sheetId,
      range: `${tab}!A1`,
      valueInputOption: "USER_ENTERED",
      requestBody: { values: appends },
    });
  }
}
