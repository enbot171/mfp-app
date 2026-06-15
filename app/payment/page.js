"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import DropZone from "@/components/DropZone";
import PaymentPreviewTable from "@/components/PaymentPreviewTable";
import { parseAllSheets } from "@/lib/parseFile";
import { parsePaymentFile } from "@/lib/parsePaymentFile";
import { matchPayments } from "@/lib/matchPayments";

const SESSION_KEY       = "mfp_sheet_config";
const PAYMENT_QUEUE_TAB = "_payment_queue_";
const PHASES = { LOADING: "loading", LOG: "log", UPLOAD: "upload", PREVIEW: "preview" };

function getConfig() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "{}"); }
  catch { return {}; }
}

// ── Queue serialization ───────────────────────────────────────────────────────

const QUEUE_HEADERS = ["fingerprint", "sheetName", "mfNumber", "mfAutoCorrected", "amount", "date", "month"];

function serializePaymentQueue(parsedRows) {
  return [
    QUEUE_HEADERS,
    ...parsedRows.map((r) => [
      r.fingerprint   ?? "",
      r.sheetName     ?? "",
      r.mfNumber      ?? "",
      String(r.mfAutoCorrected ?? false),
      String(r.amount ?? 0),
      r.date instanceof Date ? r.date.toISOString() : String(r.date ?? ""),
      r.month         ?? "",
    ]),
  ];
}

function deserializePaymentQueue(rawRows) {
  if (!rawRows || rawRows.length < 2) return null;
  const h   = (rawRows[0] ?? []).map((c) => String(c).trim().toLowerCase());
  const col = (name) => h.indexOf(name);
  return rawRows.slice(1).map((row, i) => ({
    rowIndex:        i,
    fingerprint:     String(row[col("fingerprint")] ?? ""),
    sheetName:       String(row[col("sheetname")]   ?? ""),
    mfNumber:        String(row[col("mfnumber")]    ?? ""),
    mfAutoCorrected: String(row[col("mfautocorrected")] ?? "").toLowerCase() === "true",
    amount:          parseFloat(String(row[col("amount")] ?? "")) || 0,
    date:            row[col("date")] && String(row[col("date")]) ? new Date(String(row[col("date")])) : null,
    month:           String(row[col("month")] ?? ""),
  }));
}

// ── Log history table ─────────────────────────────────────────────────────────

function PaymentLogTable({ rows }) {
  if (rows.length === 0) {
    return <div className="text-center py-16 text-black/30 text-sm">No payments in log</div>;
  }
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-black/8 bg-black/[0.02]">
            {["MF No.", "Month", "Date", "Amount", "Source", "Pushed At"].map((h) => (
              <th key={h} className="text-left px-4 py-3 font-semibold text-black/60 text-xs whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.fingerprint}-${i}`} className="border-b border-black/5 hover:bg-black/[0.02] transition-colors">
              <td className="px-4 py-3 font-mono text-xs text-black font-semibold">{r.mfNo || "—"}</td>
              <td className="px-4 py-3 text-black/70">{r.month || "—"}</td>
              <td className="px-4 py-3 text-black/70 whitespace-nowrap">{r.date || "—"}</td>
              <td className="px-4 py-3 text-black font-medium">{r.amount ? `$${r.amount}` : "—"}</td>
              <td className="px-4 py-3 text-black/50 text-xs">{r.source || "—"}</td>
              <td className="px-4 py-3 text-black/40 text-xs whitespace-nowrap">
                {r.pushedAt ? new Date(r.pushedAt).toLocaleString() : "—"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function PaymentPage() {
  const router = useRouter();

  const [sheetId,    setSheetId]    = useState("");
  const [tabName,    setTabName]    = useState("Sheet1");
  const [sheetTitle, setSheetTitle] = useState("");
  const [phase,      setPhase]      = useState(PHASES.LOADING);

  // Log view
  const [logRows,    setLogRows]    = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError,   setLogError]   = useState(null);

  // Payment preview state
  const [paymentResults,        setPaymentResults]        = useState([]);
  const [paymentParsedRows,     setPaymentParsedRows]     = useState([]);
  const [paymentDupCount,       setPaymentDupCount]       = useState(0);
  const [paymentFormatSummary,  setPaymentFormatSummary]  = useState([]);
  const [paymentSelected,       setPaymentSelected]       = useState(new Set());
  const [paymentStatusMsg,      setPaymentStatusMsg]      = useState("");
  const [paymentPushError,      setPaymentPushError]      = useState(null);
  const [paymentPushMsg,        setPaymentPushMsg]        = useState(null);
  const [paymentPushing,        setPaymentPushing]        = useState(false);
  const [paymentRevertSnapshot, setPaymentRevertSnapshot] = useState(null);
  const [paymentRevertRows,     setPaymentRevertRows]     = useState([]);
  const [paymentReverting,      setPaymentReverting]      = useState(false);
  const [paymentRevertMsg,      setPaymentRevertMsg]      = useState(null);
  const [paymentRevertError,    setPaymentRevertError]    = useState(null);
  const [paymentAddMsg,         setPaymentAddMsg]         = useState(null);
  const [paymentAddSnapshot,    setPaymentAddSnapshot]    = useState(null); // {parsedRows, formatSummary} before last "Add file"
  const [rangeFrom,             setRangeFrom]             = useState(""); // yyyy-mm-dd — only import transactions in range
  const [rangeTo,               setRangeTo]               = useState("");

  const addFileInputRef = useRef(null);
  // Master data + processed fingerprints, kept so inline edits can re-match
  const paymentMatchRef = useRef({ masterRows: [], masterHeaders: [], fingerprints: [] });
  const editSaveTimerRef = useRef(null);

  useEffect(() => {
    const { sheetId: sid, tabName: tab, sheetTitle: title } = getConfig();
    if (!sid) { router.replace("/"); return; }
    setSheetId(sid);
    setTabName(tab ?? "Sheet1");
    setSheetTitle(title ?? sid);
    initPage(sid, tab ?? "Sheet1");
  }, []);

  // ── Page init: auto-resume if queue exists, else load log ────────────────

  async function initPage(sid, tab) {
    setPhase(PHASES.LOADING);
    try {
      const res  = await fetch(`/api/queue?sheetId=${encodeURIComponent(sid)}&queueTab=${encodeURIComponent(PAYMENT_QUEUE_TAB)}`);
      const data = await res.json();
      if (res.ok && data.rows && data.rows.length >= 2) {
        const parsed = deserializePaymentQueue(data.rows);
        if (parsed && parsed.length > 0) {
          loadLog(sid); // background — for "back to history"
          await resumeFromRows(parsed, sid, tab);
          return;
        }
      }
      await loadLog(sid);
    } catch {
      await loadLog(sid);
    }
  }

  // ── Log loading ───────────────────────────────────────────────────────────

  async function loadLog(sid) {
    setLogLoading(true);
    setLogError(null);
    try {
      const res  = await fetch(`/api/payment?sheetId=${encodeURIComponent(sid)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load payment log");
      const rows = data.rows ?? [];
      setLogRows(rows);
      setPhase((p) => p === PHASES.PREVIEW ? p : (rows.length > 0 ? PHASES.LOG : PHASES.UPLOAD));
    } catch (err) {
      setLogError(err.message);
      setPhase((p) => p === PHASES.PREVIEW ? p : PHASES.LOG);
    } finally {
      setLogLoading(false);
    }
  }

  // ── Queue persistence helpers ─────────────────────────────────────────────

  function saveQueueBg(sid, parsedRows) {
    fetch("/api/queue", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetId: sid, queueTab: PAYMENT_QUEUE_TAB, rows: serializePaymentQueue(parsedRows) }),
    }).catch(() => {});
  }

  function deleteQueueBg(sid) {
    fetch("/api/queue", {
      method:  "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetId: sid, queueTab: PAYMENT_QUEUE_TAB }),
    }).catch(() => {});
  }

  // Core resume logic — called on auto-resume (init) and after new file upload
  async function resumeFromRows(parsedRows, sid, tab, formatSummary = []) {
    setPaymentStatusMsg("Loading session…");
    setPhase(PHASES.PREVIEW);
    try {
      const [ledgerRes, sheetRes] = await Promise.all([
        fetch(`/api/payment?sheetId=${encodeURIComponent(sid)}`),
        fetch(`/api/sheet?sheetId=${encodeURIComponent(sid)}&tab=${encodeURIComponent(tab)}`),
      ]);
      const fingerprints = ledgerRes.ok ? ((await ledgerRes.json()).fingerprints ?? []) : [];
      if (!sheetRes.ok) throw new Error((await sheetRes.json()).error ?? "Failed to fetch sheet");
      const sheetData = await sheetRes.json();

      // Re-index so every row has a unique rowIndex (merged/added files would
      // otherwise repeat indices → duplicate React keys and broken selection).
      parsedRows = parsedRows.map((r, i) => ({ ...r, rowIndex: i }));

      // Keep master data so inline edits can re-match without re-fetching
      paymentMatchRef.current = { masterRows: sheetData.rows, masterHeaders: sheetData.headers, fingerprints };

      const results    = matchPayments(parsedRows, sheetData.rows, sheetData.headers, fingerprints);
      const dupCount   = results.filter((r) => r.isDuplicate).length;
      const visible    = results.filter((r) => !r.isDuplicate);
      const autoSelect = new Set(visible.filter((r) => r.matchType === "matched").map((r) => r.rowIndex));

      setPaymentResults(visible);
      setPaymentParsedRows(parsedRows);
      setPaymentDupCount(dupCount);
      setPaymentFormatSummary(formatSummary);
      setPaymentSelected(autoSelect);
      setPaymentStatusMsg("");
    } catch (err) {
      setPaymentStatusMsg(`Error loading session: ${err.message}`);
      setPhase(PHASES.UPLOAD);
    }
  }

  // Discard the entire in-progress file — deletes queue, returns to log or upload
  function handleDiscardFile() {
    if (!window.confirm("Discard this file? All unreviewed rows will be removed and the session cleared.")) return;
    const { sheetId: sid } = getConfig();
    deleteQueueBg(sid);
    setPaymentResults([]);
    setPaymentParsedRows([]);
    setPaymentDupCount(0);
    setPaymentFormatSummary([]);
    setPaymentSelected(new Set());
    setPaymentStatusMsg("");
    setPaymentPushError(null);
    setPaymentPushMsg(null);
    setPaymentRevertSnapshot(null);
    setPaymentRevertRows([]);
    setPaymentAddSnapshot(null);
    setPaymentAddMsg(null);
    setPhase(logRows.length > 0 ? PHASES.LOG : PHASES.UPLOAD);
  }

  // ── File upload ───────────────────────────────────────────────────────────

  async function handlePaymentFile(file) {
    const { sheetId: sid, tabName: tab } = getConfig();

    setPaymentRevertSnapshot(null);
    setPaymentRevertRows([]);
    setPaymentRevertMsg(null);
    setPaymentRevertError(null);
    setPaymentStatusMsg("Parsing file…");

    let sheets;
    try {
      sheets = await parseAllSheets(file);
    } catch (err) {
      setPaymentStatusMsg(`Parse error: ${err.message}`);
      return;
    }

    let parsed;
    try {
      parsed = parsePaymentFile(sheets);
    } catch (err) {
      setPaymentStatusMsg(err.message);
      return;
    }

    // Restrict to the chosen date range (for weekly uploads from a full-year file)
    const total   = parsed.rows.length;
    const inRange = filterByRange(parsed.rows);
    if (inRange.length === 0) {
      setPaymentStatusMsg(
        rangeActive()
          ? "No transactions fall within the selected date range."
          : "No transactions found in this file."
      );
      return;
    }
    const summary = recountSummary(parsed.formatSummary, inRange);

    // Fresh file — clear any previous add snapshot/message
    setPaymentAddSnapshot(null);
    setPaymentAddMsg(rangeActive() ? `Imported ${inRange.length} of ${total} transactions in range` : null);

    // Save to queue tab for session persistence, then resume into preview
    saveQueueBg(sid, inRange);
    await resumeFromRows(inRange, sid, tab, summary);
  }

  // ── Date-range filtering (week-to-week extraction) ──────────────────────────

  function rangeActive() { return Boolean(rangeFrom || rangeTo); }

  function filterByRange(rows) {
    const from = rangeFrom ? new Date(`${rangeFrom}T00:00:00Z`) : null;
    const to   = rangeTo   ? new Date(`${rangeTo}T23:59:59Z`)   : null;
    if (!from && !to) return rows;
    return rows.filter((r) => {
      if (!r.date) return false; // can't place an undated row in a range
      const d = new Date(r.date);
      if (from && d < from) return false;
      if (to && d > to)     return false;
      return true;
    });
  }

  // Re-count per-sheet totals after filtering, dropping sheets with no rows left.
  function recountSummary(summary, rows) {
    const counts = {};
    rows.forEach((r) => { counts[r.sheetName] = (counts[r.sheetName] ?? 0) + 1; });
    return (summary ?? [])
      .map((s) => ({ ...s, count: counts[s.sheetName] ?? 0 }))
      .filter((s) => s.count > 0);
  }

  // ── Add file (merge another bank export into the current session) ───────────

  // Combine two formatSummary lists, summing counts for sheets that repeat.
  function mergeFormatSummaries(a, b) {
    const map = new Map();
    [...(a ?? []), ...(b ?? [])].forEach((s) => {
      const ex = map.get(s.sheetName);
      if (ex) { ex.count += s.count; ex.dateRange = ex.dateRange || s.dateRange; }
      else map.set(s.sheetName, { ...s });
    });
    return [...map.values()];
  }

  async function handleAddMorePayments(file) {
    const { sheetId: sid, tabName: tab } = getConfig();

    setPaymentAddMsg(null);
    setPaymentStatusMsg("Parsing file…");

    let parsed;
    try {
      const sheets = await parseAllSheets(file);
      parsed = parsePaymentFile(sheets);
    } catch (err) {
      setPaymentStatusMsg("");
      setPaymentAddMsg(err.message);
      return;
    }

    // Apply the same date-range restriction to the added file
    const ranged = filterByRange(parsed.rows);

    // Only merge transactions not already in the current preview (dedup by fingerprint)
    const existing     = new Set(paymentParsedRows.map((r) => r.fingerprint));
    const genuinelyNew = ranged.filter((r) => !existing.has(r.fingerprint));
    const skipped      = ranged.length - genuinelyNew.length;
    const outOfRange   = parsed.rows.length - ranged.length;

    if (genuinelyNew.length === 0) {
      setPaymentStatusMsg("");
      setPaymentAddMsg(
        ranged.length === 0 && rangeActive()
          ? "No transactions in the new file fall within the selected date range"
          : `All ${ranged.length} transaction${ranged.length !== 1 ? "s" : ""} already in preview`
      );
      return;
    }

    // Snapshot for undo (only once we know we will merge)
    setPaymentAddSnapshot({ parsedRows: paymentParsedRows, formatSummary: paymentFormatSummary });

    const merged        = [...paymentParsedRows, ...genuinelyNew];
    const mergedSummary = mergeFormatSummaries(paymentFormatSummary, recountSummary(parsed.formatSummary, genuinelyNew));

    saveQueueBg(sid, merged);
    await resumeFromRows(merged, sid, tab, mergedSummary);

    const parts = [`${genuinelyNew.length} transaction${genuinelyNew.length !== 1 ? "s" : ""} added`];
    if (skipped > 0)    parts.push(`${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped`);
    if (outOfRange > 0) parts.push(`${outOfRange} out of range`);
    setPaymentAddMsg(parts.join(" · "));
  }

  // Inline edit of a transaction's amount / month → re-match and persist.
  function handleEditPaymentRow(rowIndex, patch) {
    const { masterRows, masterHeaders, fingerprints } = paymentMatchRef.current;
    const nextParsed = paymentParsedRows.map((r) => (r.rowIndex === rowIndex ? { ...r, ...patch } : r));
    const results    = matchPayments(nextParsed, masterRows, masterHeaders, fingerprints);

    setPaymentParsedRows(nextParsed);
    setPaymentResults(results.filter((r) => !r.isDuplicate));

    // Debounced queue save so a flurry of edits doesn't hammer Sheets
    const { sheetId: sid } = getConfig();
    if (editSaveTimerRef.current) clearTimeout(editSaveTimerRef.current);
    editSaveTimerRef.current = setTimeout(() => saveQueueBg(sid, nextParsed), 600);
  }

  // Dismiss rows from the preview AND from the queue, so they don't reappear on resume.
  function dismissPaymentRows(rows) {
    const ids = new Set(rows.map((r) => r.rowIndex));
    const { sheetId: sid } = getConfig();
    const nextParsed = paymentParsedRows.filter((r) => !ids.has(r.rowIndex));

    setPaymentResults((prev) => prev.filter((r) => !ids.has(r.rowIndex)));
    setPaymentSelected((prev) => { const n = new Set(prev); ids.forEach((i) => n.delete(i)); return n; });
    setPaymentParsedRows(nextParsed);

    if (nextParsed.length === 0) deleteQueueBg(sid);
    else saveQueueBg(sid, nextParsed);
  }

  // Undo the last "Add file" — restores the pre-merge transactions
  async function handleUndoAddPayment() {
    if (!paymentAddSnapshot) return;
    const { sheetId: sid, tabName: tab } = getConfig();
    const { parsedRows, formatSummary } = paymentAddSnapshot;
    setPaymentAddSnapshot(null);
    setPaymentAddMsg(null);
    saveQueueBg(sid, parsedRows);
    await resumeFromRows(parsedRows, sid, tab, formatSummary);
  }

  // ── Push ──────────────────────────────────────────────────────────────────

  async function handlePushPayments(rowsToPush) {
    const { sheetId: sid, tabName: tab } = getConfig();

    if (paymentRevertSnapshot) {
      const ok = window.confirm(
        "You have an unreverted push. Pushing again makes the previous push permanent. Continue?"
      );
      if (!ok) return;
    }

    setPaymentPushing(true);
    setPaymentPushError(null);

    try {
      const logRows = rowsToPush.map((r) => ({
        fingerprint: r.fingerprint,
        mfNo:        r.mfNumber,
        month:       r.month ?? "",
        date:        r.date ? new Date(r.date).toISOString().slice(0, 10) : "",
        amount:      r.amount,
        source:      r.sheetName ?? "",
      }));

      const res = await fetch("/api/payment", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetId: sid, tab,
          updates: rowsToPush.map((r) => ({
            masterRowIndex: r.masterRowIndex,
            monthColIndex:  r.monthColIndex,
            amount:         r.amount,
            pledgeAmount:   r.pledgeAmount,
          })),
          logRows,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Push failed");
      const data = await res.json();

      setPaymentRevertSnapshot({ cells: data.snapshot?.cells ?? [], fingerprints: rowsToPush.map((r) => r.fingerprint) });
      setPaymentRevertRows(rowsToPush);

      const pushedIndices = new Set(rowsToPush.map((r) => r.rowIndex));
      const remaining     = paymentResults.filter((r) => !pushedIndices.has(r.rowIndex));
      setPaymentResults(remaining);
      setPaymentSelected((prev) => { const n = new Set(prev); pushedIndices.forEach((i) => n.delete(i)); return n; });

      // Clean up queue when all rows are pushed
      if (remaining.length === 0) deleteQueueBg(sid);

      const n = rowsToPush.length;
      setPaymentPushMsg(`${n} payment${n !== 1 ? "s" : ""} pushed`);
      setTimeout(() => setPaymentPushMsg(null), 4000);

      // Refresh log in background
      fetch(`/api/payment?sheetId=${encodeURIComponent(sid)}`)
        .then((r) => r.json())
        .then(({ rows }) => setLogRows(rows ?? []))
        .catch(() => {});
    } catch (err) {
      setPaymentPushError(err.message);
    } finally {
      setPaymentPushing(false);
    }
  }

  // ── Revert ────────────────────────────────────────────────────────────────

  async function handleRevert() {
    if (!paymentRevertSnapshot) return;
    const { sheetId: sid, tabName: tab } = getConfig();
    setPaymentReverting(true);
    setPaymentRevertError(null);
    try {
      const res = await fetch("/api/payment/revert", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sheetId: sid, tab, cells: paymentRevertSnapshot.cells, fingerprints: paymentRevertSnapshot.fingerprints }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Revert failed");

      setPaymentResults((prev) => [...prev, ...paymentRevertRows]);
      setPaymentSelected((prev) => {
        const n = new Set(prev);
        paymentRevertRows.filter((r) => r.matchType === "matched").forEach((r) => n.add(r.rowIndex));
        return n;
      });
      setPaymentRevertSnapshot(null);
      setPaymentRevertRows([]);
      setPaymentRevertMsg("Last push reverted");
      setTimeout(() => setPaymentRevertMsg(null), 4000);
    } catch (err) {
      setPaymentRevertError(err.message);
    } finally {
      setPaymentReverting(false);
    }
  }

  // ── Add missing months ────────────────────────────────────────────────────

  async function handleAddMissingMonths(months) {
    const { sheetId: sid, tabName: tab } = getConfig();
    setPaymentStatusMsg(`Adding columns: ${months.join(", ")}…`);
    setPaymentPushError(null);
    try {
      const addRes = await fetch("/api/sheet", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({ sheetId: sid, tab, addMonths: months }),
      });
      if (!addRes.ok) throw new Error((await addRes.json()).error ?? "Failed to add columns");

      const [ledgerRes, sheetRes] = await Promise.all([
        fetch(`/api/payment?sheetId=${encodeURIComponent(sid)}`),
        fetch(`/api/sheet?sheetId=${encodeURIComponent(sid)}&tab=${encodeURIComponent(tab)}`),
      ]);
      const fingerprints = ledgerRes.ok ? ((await ledgerRes.json()).fingerprints ?? []) : [];
      if (!sheetRes.ok) throw new Error((await sheetRes.json()).error ?? "Failed to fetch sheet");
      const sheetData = await sheetRes.json();

      const results    = matchPayments(paymentParsedRows, sheetData.rows, sheetData.headers, fingerprints);
      const dupCount   = results.filter((r) => r.isDuplicate).length;
      const visible    = results.filter((r) => !r.isDuplicate);
      const autoSelect = new Set(visible.filter((r) => r.matchType === "matched").map((r) => r.rowIndex));

      setPaymentResults(visible);
      setPaymentDupCount(dupCount);
      setPaymentSelected(autoSelect);
    } catch (err) {
      setPaymentPushError(`Failed to add columns: ${err.message}`);
    } finally {
      setPaymentStatusMsg("");
    }
  }

  // ── Navigation ────────────────────────────────────────────────────────────

  function resetToLog() {
    setPaymentResults([]);
    setPaymentParsedRows([]);
    setPaymentDupCount(0);
    setPaymentFormatSummary([]);
    setPaymentSelected(new Set());
    setPaymentStatusMsg("");
    setPaymentPushError(null);
    setPaymentPushMsg(null);
    setPaymentPushing(false);
    setPaymentRevertSnapshot(null);
    setPaymentRevertRows([]);
    setPaymentReverting(false);
    setPaymentRevertMsg(null);
    setPaymentRevertError(null);
    setPaymentAddSnapshot(null);
    setPaymentAddMsg(null);
    setPhase(PHASES.LOG);
    loadLog(sheetId);
  }

  // ── Queue resume card (shared between LOG and UPLOAD views) ───────────────

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-black px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <button
            onClick={() => router.push("/")}
            className="w-7 h-7 bg-white/10 hover:bg-white/20 rounded-lg flex items-center justify-center transition-all"
          >
            <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
            </svg>
          </button>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">Payments</h1>
            <p className="text-xs text-white/40">{sheetTitle || sheetId}</p>
          </div>
        </div>
        {phase === PHASES.PREVIEW && (
          <button
            onClick={resetToLog}
            className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-medium border border-white/10 transition-all"
          >
            View Payment History
          </button>
        )}
      </header>

      <main className={`max-w-7xl mx-auto px-6 ${phase === PHASES.PREVIEW ? "py-4" : "py-10"}`}>

        {/* ── LOADING ── */}
        {phase === PHASES.LOADING && (
          <div className="flex items-center justify-center py-20 gap-2 text-black/40">
            <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
            </svg>
            <span className="text-sm">Loading…</span>
          </div>
        )}

        {/* ── LOG VIEW ── */}
        {phase === PHASES.LOG && (
          <div>
            <div className="flex items-start justify-between mb-6">
              <div>
                <h2 className="text-2xl font-bold text-black tracking-tight">Payment History</h2>
                <p className="text-sm text-black/50 mt-1">
                  {logRows.length > 0
                    ? `${logRows.length} transaction${logRows.length !== 1 ? "s" : ""} pushed`
                    : "No payments pushed yet"}
                </p>
              </div>
              <button
                onClick={() => setPhase(PHASES.UPLOAD)}
                className="flex items-center gap-2 px-4 py-2.5 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Upload new batch
              </button>
            </div>

            {logError && (
              <div className="mb-4 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {logError}
              </div>
            )}

            {logLoading ? (
              <div className="bg-white rounded-2xl border border-black/8 shadow-sm p-12 text-center text-black/30 text-sm">Loading…</div>
            ) : (
              <div className="bg-white rounded-2xl border border-black/8 shadow-sm overflow-hidden">
                <PaymentLogTable rows={logRows} />
              </div>
            )}
          </div>
        )}

        {/* ── UPLOAD ── */}
        {phase === PHASES.UPLOAD && (
          <div className="max-w-xl mx-auto">
            <div className="mb-8 flex items-center gap-3">
              <button
                onClick={() => logRows.length > 0 ? setPhase(PHASES.LOG) : router.push("/")}
                className="w-8 h-8 flex items-center justify-center rounded-xl border border-black/15 hover:border-black/30 bg-white shadow-sm hover:shadow transition-all"
              >
                <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                </svg>
              </button>
              <div>
                <h2 className="text-2xl font-bold text-black tracking-tight">Upload Payment File</h2>
                <p className="text-sm text-black/50 mt-1">Drag and drop your bank transaction export.</p>
              </div>
            </div>

            {/* Date-range filter — for weekly uploads from a full-year export */}
            <div className="bg-white rounded-2xl border border-black/8 shadow-sm p-5 mb-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-black">Date range <span className="font-normal text-black/40">(optional)</span></p>
                  <p className="text-xs text-black/50 mt-0.5">Only import transactions dated within this range — handy when the file covers the whole year but you process one week at a time.</p>
                </div>
                {(rangeFrom || rangeTo) && (
                  <button
                    onClick={() => { setRangeFrom(""); setRangeTo(""); }}
                    className="text-xs text-black/40 underline shrink-0 mt-0.5"
                  >
                    Clear
                  </button>
                )}
              </div>
              <div className="flex items-center gap-3 mt-3">
                <label className="flex-1">
                  <span className="block text-xs font-medium text-black/50 mb-1">From</span>
                  <input
                    type="date"
                    value={rangeFrom}
                    max={rangeTo || undefined}
                    onChange={(e) => setRangeFrom(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-xl text-sm text-black focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black/30 transition-all"
                  />
                </label>
                <label className="flex-1">
                  <span className="block text-xs font-medium text-black/50 mb-1">To</span>
                  <input
                    type="date"
                    value={rangeTo}
                    min={rangeFrom || undefined}
                    onChange={(e) => setRangeTo(e.target.value)}
                    className="w-full px-3 py-2 border border-black/15 rounded-xl text-sm text-black focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black/30 transition-all"
                  />
                </label>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-black/8 shadow-sm p-6">
              <DropZone onFile={handlePaymentFile} />
            </div>

            {paymentStatusMsg && (
              <div className="mt-4 flex items-center justify-center gap-2">
                {paymentStatusMsg.endsWith("…") && (
                  <svg className="w-4 h-4 text-black/40 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                <p className="text-sm text-black/50">{paymentStatusMsg}</p>
              </div>
            )}
          </div>
        )}

        {/* ── PREVIEW ── */}
        {phase === PHASES.PREVIEW && (
          <div className="flex flex-col" style={{ height: "calc(100vh - 136px)" }}>
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-black tracking-tight">Review payments</h2>
                <p className="text-sm text-black/50 mt-0.5">Check each row before updating Google Sheets.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative group">
                  <button
                    onClick={() => addFileInputRef.current?.click()}
                    className="px-4 py-2 text-sm bg-white border border-black/20 rounded-xl text-black font-medium shadow-sm hover:shadow hover:border-black/30 transition-all flex items-center gap-2"
                  >
                    <svg className="w-3.5 h-3.5 text-black/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add file
                  </button>
                  <div className="absolute right-0 top-full mt-2 w-72 bg-black text-white text-xs rounded-xl p-3 shadow-xl hidden group-hover:block z-50 leading-relaxed">
                    <p className="font-semibold mb-1">Add another bank export</p>
                    <p className="text-white/60">New transactions are merged into the current preview. Transactions already shown (same fingerprint) are skipped.</p>
                  </div>
                </div>
                <input
                  ref={addFileInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) handleAddMorePayments(f); }}
                />
                {paymentAddSnapshot && (
                  <button
                    onClick={handleUndoAddPayment}
                    className="px-4 py-2 text-sm bg-white border border-amber-200 rounded-xl text-amber-700 font-medium shadow-sm hover:bg-amber-50 hover:border-amber-300 transition-all"
                  >
                    Undo last add
                  </button>
                )}
                <button
                  onClick={handleDiscardFile}
                  className="px-4 py-2 text-sm bg-white border border-black/20 rounded-xl text-black/60 font-medium shadow-sm hover:bg-black/5 hover:border-black/30 transition-all"
                >
                  Discard file
                </button>
              </div>
            </div>

            {paymentAddMsg && (
              <div className="mb-3 flex items-center gap-2 p-3 bg-black/5 border border-black/10 rounded-xl text-sm text-black/60 shrink-0">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {paymentAddMsg}
              </div>
            )}

            {paymentStatusMsg && (
              <div className="mb-3 flex items-center gap-2 p-3 bg-black/5 border border-black/10 rounded-xl text-sm text-black/60 shrink-0">
                <svg className="w-4 h-4 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
                {paymentStatusMsg}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-black/8 shadow-sm overflow-hidden flex-1 min-h-0">
              <PaymentPreviewTable
                results={paymentResults}
                selected={paymentSelected}
                onToggle={(idx) => setPaymentSelected((prev) => {
                  const n = new Set(prev); if (n.has(idx)) n.delete(idx); else n.add(idx); return n;
                })}
                onSelectAll={(indices, selectAll) => setPaymentSelected((prev) => {
                  const n = new Set(prev); indices.forEach((i) => (selectAll ? n.add(i) : n.delete(i))); return n;
                })}
                onPushSelected={handlePushPayments}
                onDismissRow={(row) => dismissPaymentRows([row])}
                onDismissRows={(rows) => dismissPaymentRows(rows)}
                onEditRow={handleEditPaymentRow}
                pushing={paymentPushing}
                pushMsg={paymentPushMsg}
                pushError={paymentPushError}
                duplicateCount={paymentDupCount}
                formatSummary={paymentFormatSummary}
                canRevert={!!paymentRevertSnapshot}
                onRevert={handleRevert}
                reverting={paymentReverting}
                revertMsg={paymentRevertMsg}
                revertError={paymentRevertError}
                onAddMissingMonths={handleAddMissingMonths}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
