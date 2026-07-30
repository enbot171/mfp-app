// Google's Sheets API errors are written for developers ("The caller does not
// have permission"). The people using this app are volunteers, so every error
// that can reach the screen is translated into what went wrong and what to do
// about it. Anything unrecognised falls through with its original text.

const SERVICE_ACCOUNT = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? "the app's service account";

export function friendlySheetError(err, { tab } = {}) {
  const status = err?.code ?? err?.status ?? err?.response?.status;
  const raw    = String(err?.message ?? "");
  const text   = raw.toLowerCase();

  // Not shared with the service account — by far the most common failure.
  if (status === 403 || text.includes("does not have permission") || text.includes("permission_denied")) {
    return `This sheet isn't shared with the app. Open it in Google Sheets, click Share, and give ${SERVICE_ACCOUNT} Editor access — then try again.`;
  }

  // Wrong ID, or the file was deleted / is in someone else's Drive.
  if (status === 404 || text.includes("requested entity was not found") || text.includes("notfound")) {
    return "No sheet was found at that link. Check you copied the right one — the sheet may have been deleted or moved.";
  }

  // Sheets reports a missing tab as a range-parse failure.
  if (text.includes("unable to parse range")) {
    return tab
      ? `This sheet has no tab called "${tab}". Check the tab name at the bottom of Google Sheets — capital letters matter — and reconnect.`
      : "That tab name doesn't exist in this sheet. Check the tab name and reconnect.";
  }

  // Service-account key problems — the admin has to fix these, not the user.
  if (status === 401 || text.includes("invalid_grant") || text.includes("invalid jwt") || text.includes("unauthorized_client")) {
    return "The app's Google credentials aren't working. Ask whoever set the app up to check its service-account key.";
  }

  if (status === 429 || text.includes("quota") || text.includes("rate limit")) {
    return "Google is rate-limiting us right now. Wait a minute and try again.";
  }

  if (status === 503 || status === 500 || text.includes("backend error") || text.includes("try again")) {
    return "Google Sheets didn't respond. Wait a moment and try again.";
  }

  return raw || "Something went wrong talking to Google Sheets.";
}
