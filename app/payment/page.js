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

// ── Week grouping (Tue → following Mon) for the upload week-picker ────────────
const MONS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

// Statement weeks run Tuesday → the following Monday (e.g. 19 May → 25 May).
function weekStartUTC(date) {
  const d   = new Date(date);
  const u   = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const dow = (u.getUTCDay() - 2 + 7) % 7; // Tuesday = 0
  u.setUTCDate(u.getUTCDate() - dow);
  return u;
}
const weekKeyUTC = (date) => weekStartUTC(date).toISOString().slice(0, 10);

function weekLabel(start) {
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), start.getUTCDate() + 6));
  return start.getUTCMonth() === end.getUTCMonth()
    ? `${start.getUTCDate()}–${end.getUTCDate()} ${MONS[end.getUTCMonth()]}`
    : `${start.getUTCDate()} ${MONS[start.getUTCMonth()]} – ${end.getUTCDate()} ${MONS[end.getUTCMonth()]}`;
}

// Group parsed transactions into weeks, marking new vs already-pushed.
function groupIntoWeeks(rows, pushedSet) {
  const map = new Map();
  const noDate = [];
  rows.forEach((r) => {
    if (!r.date) { noDate.push(r); return; }
    const key = weekKeyUTC(r.date);
    if (!map.has(key)) map.set(key, { key, start: weekStartUTC(r.date), rows: [] });
    map.get(key).rows.push(r);
  });
  const weeks = [...map.values()]
    .map((w) => ({ ...w, total: w.rows.length, newCount: w.rows.filter((r) => !pushedSet.has(r.fingerprint)).length, label: weekLabel(w.start), year: w.start.getUTCFullYear() }))
    .sort((a, b) => b.start - a.start); // newest first
  if (noDate.length) {
    weeks.push({ key: "__nodate__", start: null, rows: noDate, total: noDate.length, newCount: noDate.filter((r) => !pushedSet.has(r.fingerprint)).length, label: "No date", year: "" });
  }
  return weeks;
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
  // Week picker (shown after upload when a file spans multiple weeks)
  const [pendingParse,  setPendingParse]  = useState(null); // { rows, formatSummary } awaiting week selection
  const [weekBuckets,   setWeekBuckets]   = useState([]);
  const [selectedWeeks, setSelectedWeeks] = useState(new Set());
  const [weekLoading,   setWeekLoading]   = useState(false); // blocking overlay while a file is parsed/grouped

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
    setPendingParse(null);
    setWeekBuckets([]);
    setSelectedWeeks(new Set());
    setPhase(logRows.length > 0 ? PHASES.LOG : PHASES.UPLOAD);
  }

  // ── File upload ───────────────────────────────────────────────────────────

  async function handlePaymentFile(file) {
    const { sheetId: sid, tabName: tab } = getConfig();

    setPaymentRevertSnapshot(null);
    setPaymentRevertRows([]);
    setPaymentRevertMsg(null);
    setPaymentRevertError(null);
    setWeekLoading(true);                            // block interaction while parsing
    await new Promise((r) => setTimeout(r, 0));      // let the overlay paint first

    try {
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
      if (parsed.rows.length === 0) {
        setPaymentStatusMsg("No transactions found in this file.");
        return;
      }

      // Fetch already-pushed fingerprints so the week picker can mark new vs pushed
      let pushedSet = new Set();
      try {
        const res = await fetch(`/api/payment?sheetId=${encodeURIComponent(sid)}`);
        if (res.ok) pushedSet = new Set((await res.json()).fingerprints ?? []);
      } catch { /* best-effort */ }

      const weeks = groupIntoWeeks(parsed.rows, pushedSet);
      setPaymentAddSnapshot(null);
      setPaymentAddMsg(null);
      setPaymentStatusMsg("");

      // A single week → no need to choose; import everything straight away
      if (weeks.length <= 1) {
        await importParsedRows(parsed.rows, parsed.formatSummary);
        return;
      }

      // Multiple weeks → open the picker modal (new weeks pre-selected)
      setPendingParse({ ...parsed, mode: "fresh" });
      setWeekBuckets(weeks);
      setSelectedWeeks(new Set(weeks.filter((w) => w.newCount > 0).map((w) => w.key)));
    } finally {
      setWeekLoading(false);
    }
  }

  // Import a set of parsed rows: persist to the queue and open the preview.
  async function importParsedRows(rows, formatSummary) {
    const { sheetId: sid, tabName: tab } = getConfig();
    saveQueueBg(sid, rows);
    await resumeFromRows(rows, sid, tab, recountSummary(formatSummary, rows));
  }

  // Import only the weeks the user ticked. "fresh" replaces the session; "add"
  // merges the picked weeks into whatever is already in the preview.
  async function handleImportWeeks() {
    if (!pendingParse) return;
    const { rows, formatSummary, mode } = pendingParse;
    const picked = rows.filter((r) => selectedWeeks.has(r.date ? weekKeyUTC(r.date) : "__nodate__"));
    if (picked.length === 0) return;
    setPendingParse(null);
    setWeekBuckets([]);
    if (mode === "add") await mergeWeeks(picked, formatSummary);
    else                await importParsedRows(picked, formatSummary);
  }

  function cancelWeekPicker() {
    setPendingParse(null);
    setWeekBuckets([]);
    setSelectedWeeks(new Set());
    setPaymentStatusMsg("");
  }

  // Merge a set of picked rows into the current preview (dedup by fingerprint).
  async function mergeWeeks(rows, formatSummary) {
    const { sheetId: sid, tabName: tab } = getConfig();
    const existing     = new Set(paymentParsedRows.map((r) => r.fingerprint));
    const genuinelyNew = rows.filter((r) => !existing.has(r.fingerprint));
    const skipped      = rows.length - genuinelyNew.length;

    if (genuinelyNew.length === 0) {
      setPaymentAddMsg(`All ${rows.length} transaction${rows.length !== 1 ? "s" : ""} already in preview`);
      setPhase(PHASES.PREVIEW);
      return;
    }

    setPaymentAddSnapshot({ parsedRows: paymentParsedRows, formatSummary: paymentFormatSummary });
    const merged        = [...paymentParsedRows, ...genuinelyNew];
    const mergedSummary = mergeFormatSummaries(paymentFormatSummary, recountSummary(formatSummary, genuinelyNew));
    saveQueueBg(sid, merged);
    await resumeFromRows(merged, sid, tab, mergedSummary);

    const parts = [`${genuinelyNew.length} transaction${genuinelyNew.length !== 1 ? "s" : ""} added`];
    if (skipped > 0) parts.push(`${skipped} duplicate${skipped !== 1 ? "s" : ""} skipped`);
    setPaymentAddMsg(parts.join(" · "));
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
    const { sheetId: sid } = getConfig();

    setPaymentAddMsg(null);
    setWeekLoading(true);                            // block interaction while parsing
    await new Promise((r) => setTimeout(r, 0));      // let the overlay paint first

    try {
      let parsed;
      try {
        const sheets = await parseAllSheets(file);
        parsed = parsePaymentFile(sheets);
      } catch (err) {
        setPaymentAddMsg(err.message);
        return;
      }
      if (parsed.rows.length === 0) {
        setPaymentAddMsg("No transactions found in this file.");
        return;
      }

      // Mark a week "new" only if it's not already in the preview OR the pushed log
      const presentSet = new Set(paymentParsedRows.map((r) => r.fingerprint));
      try {
        const res = await fetch(`/api/payment?sheetId=${encodeURIComponent(sid)}`);
        if (res.ok) (await res.json()).fingerprints?.forEach((fp) => presentSet.add(fp));
      } catch { /* best-effort */ }

      const weeks = groupIntoWeeks(parsed.rows, presentSet);

      // Single week → no need to choose; merge straight into the preview
      if (weeks.length <= 1) {
        await mergeWeeks(parsed.rows, parsed.formatSummary);
        return;
      }

      // Multiple weeks → open the picker modal over the preview
      setPendingParse({ ...parsed, mode: "add" });
      setWeekBuckets(weeks);
      setSelectedWeeks(new Set(weeks.filter((w) => w.newCount > 0).map((w) => w.key)));
    } finally {
      setWeekLoading(false);
    }
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
    setPendingParse(null);
    setWeekBuckets([]);
    setSelectedWeeks(new Set());
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
                <p className="text-sm text-black/50 mt-1">Drag and drop your bank export — you'll pick which week(s) to import next.</p>
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

        {/* ── BLOCKING LOADER (while a file is parsed/grouped into weeks) ── */}
        {weekLoading && (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
            <div className="bg-white rounded-2xl shadow-2xl px-6 py-5 flex items-center gap-3">
              <svg className="w-5 h-5 text-black/60 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
              <div>
                <p className="text-sm font-semibold text-black">Reading file…</p>
                <p className="text-xs text-black/50">Grouping transactions by week — please wait.</p>
              </div>
            </div>
          </div>
        )}

        {/* ── WEEK PICKER MODAL ── */}
        {weekBuckets.length > 0 && (
          <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={cancelWeekPicker}>
            <div
              className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[85vh] flex flex-col"
              onClick={(e) => e.stopPropagation()}
            >
              {/* Header */}
              <div className="flex items-start justify-between px-6 py-4 border-b border-black/8">
                <div>
                  <h2 className="text-base font-bold text-black">
                    {pendingParse?.mode === "add" ? "Choose weeks to add" : "Choose weeks to import"}
                  </h2>
                  <p className="text-xs text-black/50 mt-0.5">
                    This file has {weekBuckets.length} week{weekBuckets.length !== 1 ? "s" : ""} of transactions.
                    {pendingParse?.mode === "add" ? " Selected weeks are added to the preview." : ""} New weeks are pre-selected.
                  </p>
                </div>
                <button onClick={cancelWeekPicker} className="text-black/40 hover:text-black transition-colors text-lg leading-none shrink-0">✕</button>
              </div>

              {/* Quick toggles */}
              <div className="flex items-center gap-2 px-6 py-2.5 border-b border-black/8 bg-black/2">
                <button onClick={() => setSelectedWeeks(new Set(weekBuckets.map((w) => w.key)))} className="text-xs font-medium text-black/60 hover:text-black underline">Select all</button>
                <span className="text-black/20">·</span>
                <button onClick={() => setSelectedWeeks(new Set(weekBuckets.filter((w) => w.newCount > 0).map((w) => w.key)))} className="text-xs font-medium text-black/60 hover:text-black underline">Only new</button>
                <span className="text-black/20">·</span>
                <button onClick={() => setSelectedWeeks(new Set())} className="text-xs font-medium text-black/60 hover:text-black underline">Clear</button>
              </div>

              {/* Week rows */}
              <div className="flex-1 overflow-auto divide-y divide-black/5">
                {weekBuckets.map((w) => {
                  const checked = selectedWeeks.has(w.key);
                  const present = w.total - w.newCount;
                  const seen    = pendingParse?.mode === "add" ? "already added" : "already pushed";
                  const tag = w.newCount === w.total ? "all new"
                    : w.newCount === 0 ? `all ${seen}`
                    : `${w.newCount} new · ${present} ${pendingParse?.mode === "add" ? "in preview" : "pushed"}`;
                  return (
                    <label key={w.key} className="flex items-center gap-3 px-6 py-3 hover:bg-black/2 cursor-pointer select-none">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => setSelectedWeeks((prev) => {
                          const n = new Set(prev);
                          if (n.has(w.key)) n.delete(w.key); else n.add(w.key);
                          return n;
                        })}
                        className="rounded border-black/25 accent-black"
                      />
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-semibold text-black">
                          {w.label}{w.year ? <span className="font-normal text-black/40"> {w.year}</span> : null}
                        </div>
                        <div className="text-xs text-black/45">{w.total} transaction{w.total !== 1 ? "s" : ""}</div>
                      </div>
                      <span className={`text-xs font-medium shrink-0 ${w.newCount === 0 ? "text-black/30" : "text-emerald-700"}`}>{tag}</span>
                    </label>
                  );
                })}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-black/8">
                <p className="text-sm text-black/50">
                  {(() => {
                    const rows = weekBuckets.filter((w) => selectedWeeks.has(w.key)).reduce((n, w) => n + w.total, 0);
                    return `${selectedWeeks.size} week${selectedWeeks.size !== 1 ? "s" : ""} · ${rows} transaction${rows !== 1 ? "s" : ""}`;
                  })()}
                </p>
                <div className="flex items-center gap-2">
                  <button onClick={cancelWeekPicker} className="px-4 py-2 text-sm border border-black/15 rounded-xl text-black hover:bg-black/5 transition-all">Cancel</button>
                  <button
                    onClick={handleImportWeeks}
                    disabled={selectedWeeks.size === 0}
                    className="px-5 py-2 text-sm bg-black text-white rounded-xl font-semibold hover:bg-black/80 disabled:opacity-30 transition-all"
                  >
                    {pendingParse?.mode === "add" ? "Add selected →" : "Import selected →"}
                  </button>
                </div>
              </div>
            </div>
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
