"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import DropZone from "@/components/DropZone";
import PreviewTable from "@/components/PreviewTable";
import { parseFile } from "@/lib/parseFile";
import { matchRows } from "@/lib/matchRows";
import { parseReviewResponse } from "@/lib/parseReviewResponse";
import { MASTER_COLS, PABBLY_COLS } from "@/config/columns";

const SESSION_KEY      = "mfp_sheet_config";
const PLEDGE_QUEUE_TAB = "_pledge_queue_";
const PHASES = { LOADING: "loading", LOG: "log", UPLOAD: "upload", PREVIEW: "preview" };

function getConfig() {
  try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) ?? "{}"); }
  catch { return {}; }
}

const FIELD_TO_COL = {
  Name:    MASTER_COLS.FULL_NAME,
  NRIC:    MASTER_COLS.PARTIAL_NRIC,
  Contact: MASTER_COLS.CONTACT_NUMBER,
  Email:   MASTER_COLS.EMAIL,
  Region:  MASTER_COLS.REGION,
};

const MISMATCH_COL_MAP = {
  NAME_MISMATCH:    MASTER_COLS.FULL_NAME,
  NRIC_MISMATCH:    MASTER_COLS.PARTIAL_NRIC,
  CONTACT_MISMATCH: MASTER_COLS.CONTACT_NUMBER,
  EMAIL_MISMATCH:   MASTER_COLS.EMAIL,
  REGION_MISMATCH:  MASTER_COLS.REGION,
};

// ── Pledge log history table ──────────────────────────────────────────────────

function PledgeLogTable({ rows }) {
  if (rows.length === 0) {
    return <div className="text-center py-16 text-black/30 text-sm">No pledges in log</div>;
  }
  return (
    <div className="overflow-auto">
      <table className="w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-black/8 bg-black/2">
            {["MF No.", "Full Name", "Pledge Amount", "Service", "Entry Date", "Pushed At"].map((h) => (
              <th key={h} className="text-left px-4 py-3 font-semibold text-black/60 text-xs whitespace-nowrap">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={`${r.fingerprint}-${i}`} className="border-b border-black/5 hover:bg-black/2 transition-colors">
              <td className="px-4 py-3 font-mono text-xs text-black font-semibold">{r.mfNo || "—"}</td>
              <td className="px-4 py-3 text-black/70">{r.fullName || "—"}</td>
              <td className="px-4 py-3 text-black font-medium">{r.pledgeAmount || "—"}</td>
              <td className="px-4 py-3 text-black/50 text-xs">{r.service || "—"}</td>
              <td className="px-4 py-3 text-black/70 whitespace-nowrap">{r.entryDate || "—"}</td>
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

export default function PledgePage() {
  const router = useRouter();

  const [sheetId,    setSheetId]    = useState("");
  const [tabName,    setTabName]    = useState("Sheet1");
  const [sheetTitle, setSheetTitle] = useState("");
  const [phase,      setPhase]      = useState(PHASES.LOADING);

  // Log view
  const [logRows,    setLogRows]    = useState([]);
  const [logLoading, setLogLoading] = useState(false);
  const [logError,   setLogError]   = useState(null);

  // Pending queue (in-progress session saved to Sheets)
  const [queueRawRows, setQueueRawRows] = useState(null); // null=not checked, []=none, [...]= has pending

  // Pledge preview state
  const [results,        setResults]        = useState([]);
  const [rawPabblyRows,  setRawPabblyRows]  = useState([]);
  const [selected,       setSelected]       = useState(new Set());
  const [fieldOverrides, setFieldOverrides] = useState({});
  const [statusMsg,      setStatusMsg]      = useState("");
  const [pushError,      setPushError]      = useState(null);
  const [cleanPushing,   setCleanPushing]   = useState(false);
  const [rowPushing,     setRowPushing]     = useState(false);
  const [cleanMsg,       setCleanMsg]       = useState(null);
  const [selectedPushing, setSelectedPushing] = useState(false);
  const [uploadSkipMsg,    setUploadSkipMsg]    = useState(null);
  const [responseMsg,      setResponseMsg]      = useState(null);
  const [isResumedSession, setIsResumedSession] = useState(false);
  const [addMoreSnapshot,  setAddMoreSnapshot]  = useState(null); // rawRows before last "Add new CSV"

  // Revert state
  const [pledgeRevertSnapshot, setPledgeRevertSnapshot] = useState(null);
  const [pledgeRevertRows,     setPledgeRevertRows]     = useState([]);
  const [pledgeReverting,      setPledgeReverting]      = useState(false);
  const [pledgeRevertMsg,      setPledgeRevertMsg]      = useState(null);
  const [pledgeRevertError,    setPledgeRevertError]    = useState(null);

  const responseInputRef  = useRef(null);
  const addRowsInputRef   = useRef(null);
  const resultsRef        = useRef(results);
  const rawPabblyRowsRef  = useRef(rawPabblyRows);
  const fieldOverridesRef = useRef(fieldOverrides);
  useEffect(() => { resultsRef.current        = results;       }, [results]);
  useEffect(() => { rawPabblyRowsRef.current  = rawPabblyRows; }, [rawPabblyRows]);
  useEffect(() => { fieldOverridesRef.current = fieldOverrides; }, [fieldOverrides]);

  useEffect(() => {
    const { sheetId: sid, tabName: tab, sheetTitle: title } = getConfig();
    if (!sid) { router.replace("/"); return; }
    setSheetId(sid);
    setTabName(tab ?? "Sheet1");
    setSheetTitle(title ?? sid);
    initPage(sid, tab ?? "Sheet1");
  }, []);

  async function loadLog(sid) {
    setLogLoading(true);
    setLogError(null);
    try {
      const res  = await fetch(`/api/pledge?sheetId=${encodeURIComponent(sid)}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error ?? "Failed to load pledge log");
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

  // ── Page init: auto-resume if queue exists, else load log ────────────────────

  async function initPage(sid, tab) {
    setPhase(PHASES.LOADING);
    try {
      const res  = await fetch(`/api/queue?sheetId=${encodeURIComponent(sid)}&queueTab=${encodeURIComponent(PLEDGE_QUEUE_TAB)}`);
      const data = await res.json();
      if (res.ok && data.rows && data.rows.length >= 2) {
        setQueueRawRows(data.rows);
        loadLog(sid); // background — for "back to history"
        await resumeFromRows(data.rows, sid, tab);
      } else {
        setQueueRawRows([]);
        await loadLog(sid);
      }
    } catch {
      setQueueRawRows([]);
      await loadLog(sid);
    }
  }

  // ── Queue persistence helpers ─────────────────────────────────────────────────

  function saveQueueBg(sid, rawRows) {
    fetch("/api/queue", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetId: sid, queueTab: PLEDGE_QUEUE_TAB, rows: rawRows }),
    }).catch(() => {});
  }

  function deleteQueueBg(sid) {
    fetch("/api/queue", {
      method:  "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sheetId: sid, queueTab: PLEDGE_QUEUE_TAB }),
    }).catch(() => {});
  }

  // Core resume logic — called on auto-resume (init) and after new file upload
  async function resumeFromRows(rawRows, sid, tab) {
    setStatusMsg("Loading session…");
    setPhase(PHASES.PREVIEW);
    try {
      const [pledgeRes, sheetRes] = await Promise.all([
        fetch(`/api/pledge?sheetId=${encodeURIComponent(sid)}`),
        fetch(`/api/sheet?sheetId=${encodeURIComponent(sid)}&tab=${encodeURIComponent(tab)}`),
      ]);
      const processedFingerprints = pledgeRes.ok ? ((await pledgeRes.json()).fingerprints ?? []) : [];
      if (!sheetRes.ok) throw new Error((await sheetRes.json()).error ?? "Failed to fetch sheet");
      const sheetData = await sheetRes.json();

      const matched         = matchRows(rawRows, sheetData.rows, sheetData.headers);
      const alreadyPushed   = new Set(processedFingerprints);
      const filtered        = matched.filter((r) => !alreadyPushed.has(r.ticketId));
      const initialSelected = new Set(
        filtered
          .filter((r) => r.matchType === "update" ||
            (r.matchType === "new" && !r.hasErrors && !r.errors.some((e) => e.severity === "warning")))
          .map((r) => r.pabblyIndex)
      );

      setIsResumedSession(true);
      setRawPabblyRows(rawRows);
      rawPabblyRowsRef.current  = rawRows;
      setResults(filtered);
      setSelected(initialSelected);
      setFieldOverrides({});
      fieldOverridesRef.current = {};
      setStatusMsg("");
    } catch (err) {
      setStatusMsg(`Error loading session: ${err.message}`);
      setPhase(PHASES.UPLOAD);
    }
  }

  // Discard the entire in-progress file — deletes queue, returns to log or upload
  async function handleDiscardFile() {
    if (!window.confirm("Discard this file? All unreviewed rows will be removed and the session cleared.")) return;
    const { sheetId: sid } = getConfig();
    deleteQueueBg(sid);
    setQueueRawRows([]);
    setResults([]);
    setRawPabblyRows([]);
    rawPabblyRowsRef.current  = [];
    fieldOverridesRef.current = {};
    setSelected(new Set());
    setFieldOverrides({});
    setStatusMsg("");
    setCleanMsg(null);
    setPushError(null);
    setPledgeRevertSnapshot(null);
    setPledgeRevertRows([]);
    setIsResumedSession(false);
    setAddMoreSnapshot(null);
    setPhase(logRows.length > 0 ? PHASES.LOG : PHASES.UPLOAD);
  }

  // ── File upload ──────────────────────────────────────────────────────────────

  async function handleFile(file) {
    const { sheetId: sid, tabName: tab } = getConfig();

    setStatusMsg("Parsing file…");
    let newPabblyRawRows;
    try {
      newPabblyRawRows = await parseFile(file);
    } catch (err) {
      setStatusMsg(`Parse error: ${err.message}`);
      return;
    }

    // Save to queue tab for session persistence, then resume into preview
    setIsResumedSession(false);
    setAddMoreSnapshot(null);
    saveQueueBg(sid, newPabblyRawRows);
    setQueueRawRows(newPabblyRawRows);
    await resumeFromRows(newPabblyRawRows, sid, tab);
  }

  async function handleAddMoreRows(file) {
    const { sheetId: sid, tabName: tab } = getConfig();

    setStatusMsg("Parsing file…");
    let newRows;
    try {
      newRows = await parseFile(file);
    } catch (err) {
      setStatusMsg(`Parse error: ${err.message}`);
      return;
    }

    const allRows = rawPabblyRowsRef.current;
    const knownTicketIds = new Set(
      allRows.slice(1).map((row) => (row[PABBLY_COLS.TICKET_ID] ?? "").trim()).filter(Boolean)
    );

    const genuinelyNew  = newRows.slice(1).filter((row) => {
      const tid = (row[PABBLY_COLS.TICKET_ID] ?? "").trim();
      return tid && !knownTicketIds.has(tid);
    });
    const skippedCount = newRows.slice(1).length - genuinelyNew.length;

    if (genuinelyNew.length === 0) {
      setUploadSkipMsg(`All ${newRows.slice(1).length} row${newRows.slice(1).length !== 1 ? "s" : ""} already in preview`);
      return;
    }

    // Save snapshot now (only if we will actually merge) so user can undo this add
    setAddMoreSnapshot({ rawRows: allRows });

    const merged = [...allRows, ...genuinelyNew];

    setStatusMsg("Fetching master sheet…");
    let sheetData;
    try {
      const res = await fetch(`/api/sheet?sheetId=${encodeURIComponent(sid)}&tab=${encodeURIComponent(tab)}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to fetch sheet");
      sheetData = await res.json();
    } catch (err) {
      setStatusMsg(`Error: ${err.message}`);
      return;
    }

    setStatusMsg("Matching rows…");
    const matched        = matchRows(merged, sheetData.rows, sheetData.headers);
    const newTicketIds   = new Set(genuinelyNew.map((row) => (row[PABBLY_COLS.TICKET_ID] ?? "").trim()));
    const additionalSel  = new Set(
      matched
        .filter((r) =>
          newTicketIds.has(r.ticketId) &&
          (r.matchType === "update" ||
            (r.matchType === "new" && !r.hasErrors && !r.errors.some((e) => e.severity === "warning")))
        )
        .map((r) => r.pabblyIndex)
    );

    // Update queue with merged rows
    saveQueueBg(sid, merged);
    setQueueRawRows(merged);

    setRawPabblyRows(merged);
    rawPabblyRowsRef.current = merged;
    setResults(matched);
    setSelected((prev) => { const n = new Set(prev); additionalSel.forEach((i) => n.add(i)); return n; });
    setStatusMsg("");
    const existingCount = allRows.slice(1).length;
    const parts = [`${genuinelyNew.length} row${genuinelyNew.length !== 1 ? "s" : ""} added from new file`];
    if (isResumedSession) parts.push(`merged with ${existingCount} row${existingCount !== 1 ? "s" : ""} from previous session`);
    if (skippedCount > 0) parts.push(`${skippedCount} duplicate${skippedCount !== 1 ? "s" : ""} skipped`);
    setUploadSkipMsg(parts.join(" · "));
  }

  // Undo the last "Add new CSV" — restores pre-merge rows and re-runs matching
  async function handleUndoAddMore() {
    if (!addMoreSnapshot) return;
    const { sheetId: sid, tabName: tab } = getConfig();
    const prevRows = addMoreSnapshot.rawRows;
    setAddMoreSnapshot(null);
    setUploadSkipMsg(null);
    saveQueueBg(sid, prevRows);
    setQueueRawRows(prevRows);
    await resumeFromRows(prevRows, sid, tab);
  }

  // ── Push helpers ─────────────────────────────────────────────────────────────

  function getEffectiveRegion(result) {
    const override = (fieldOverridesRef.current[result.pabblyIndex] ?? {})[MASTER_COLS.REGION];
    if (override && override !== "pabbly" && override !== "master") return override;
    return (result.outputRow[MASTER_COLS.REGION] ?? "").trim();
  }

  function removeRows(rowSubset) {
    const indices = new Set(rowSubset.map((r) => r.pabblyIndex));
    setResults((prev) => prev.filter((r) => !indices.has(r.pabblyIndex)));
    setSelected((prev) => { const n = new Set(prev); indices.forEach((i) => n.delete(i)); return n; });
    return indices.size;
  }

  async function pushRows(rowSubset) {
    const { sheetId: sid, tabName: tab } = getConfig();
    const updates = [], appends = [], logRows = [];

    rowSubset.forEach((r) => {
      const rowOverrides = fieldOverridesRef.current[r.pabblyIndex] ?? {};
      const effectiveRow = [...r.outputRow];
      Object.entries(rowOverrides).forEach(([colStr, choice]) => {
        const col = parseInt(colStr);
        if (choice === "master" && r.masterRow?.[col] !== undefined) effectiveRow[col] = r.masterRow[col];
        else if (choice !== "pabbly" && choice !== "master") effectiveRow[col] = choice;
      });
      if (r.masterRowIndex !== null) updates.push({ rowIndex: r.masterRowIndex, values: effectiveRow });
      else appends.push(effectiveRow);

      const rawRow = rawPabblyRowsRef.current.find(
        (row, i) => i > 0 && (row[PABBLY_COLS.TICKET_ID] ?? "").trim() === r.ticketId
      ) ?? [];
      logRows.push({
        fingerprint:  r.ticketId ?? "",
        mfNo:         effectiveRow[MASTER_COLS.MF_NUMBER]    ?? "",
        fullName:     effectiveRow[MASTER_COLS.FULL_NAME]     ?? "",
        pledgeAmount: effectiveRow[MASTER_COLS.PLEDGE_AMOUNT] ?? "",
        service:      effectiveRow[MASTER_COLS.SERVICE]       ?? "",
        entryDate:    rawRow[PABBLY_COLS.ENTRY_DATE]          ?? "",
      });
    });

    const res  = await fetch("/api/pledge", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ sheetId: sid, tab, updates, appends, logRows }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Push failed");
    return data; // { updated, appended, snapshot }
  }

  function storeRevertSnapshot(data, rowSubset) {
    if (pledgeRevertSnapshot) {
      // Previous snapshot is overwritten — warn user before push (handled at call site)
    }
    setPledgeRevertSnapshot({ snapshot: data.snapshot, fingerprints: rowSubset.map((r) => r.ticketId).filter(Boolean) });
    setPledgeRevertRows(rowSubset);
  }

  // ── Push handlers ─────────────────────────────────────────────────────────────

  async function handlePushRow(result) {
    if (result.matchType === "new" && !getEffectiveRegion(result)) {
      setPushError("This new row has no region selected — assign a region before pushing.");
      return;
    }
    if (pledgeRevertSnapshot) {
      const ok = window.confirm("You have an unreverted push. Pushing again makes the previous push permanent. Continue?");
      if (!ok) return;
    }
    setRowPushing(true);
    setPushError(null);
    try {
      const data = await pushRows([result]);
      storeRevertSnapshot(data, [result]);
      const afterCount = resultsRef.current.filter((r) => r.pabblyIndex !== result.pabblyIndex).length;
      removeRows([result]);
      if (afterCount === 0) { const { sheetId: sid } = getConfig(); deleteQueueBg(sid); setQueueRawRows([]); }
    } catch (err) {
      setPushError(err.message);
    } finally {
      setRowPushing(false);
    }
  }

  async function handlePushClean(cleanRows) {
    if (pledgeRevertSnapshot) {
      const ok = window.confirm("You have an unreverted push. Pushing again makes the previous push permanent. Continue?");
      if (!ok) return;
    }
    setCleanPushing(true);
    setCleanMsg(null);
    setPushError(null);
    try {
      const data = await pushRows(cleanRows);
      storeRevertSnapshot(data, cleanRows);
      const cleanIndices  = new Set(cleanRows.map((r) => r.pabblyIndex));
      const afterCount    = resultsRef.current.filter((r) => !cleanIndices.has(r.pabblyIndex)).length;
      removeRows(cleanRows);
      if (afterCount === 0) { const { sheetId: sid } = getConfig(); deleteQueueBg(sid); setQueueRawRows([]); }
      const addedCount   = cleanRows.filter((r) => r.matchType === "new").length;
      const updatedCount = cleanRows.length - addedCount;
      const parts = [];
      if (updatedCount > 0) parts.push(`${updatedCount} row${updatedCount !== 1 ? "s" : ""} updated`);
      if (addedCount   > 0) parts.push(`${addedCount} row${addedCount !== 1 ? "s" : ""} added`);
      setCleanMsg(parts.join(", "));
    } catch (err) {
      setPushError(err.message);
    } finally {
      setCleanPushing(false);
    }
  }

  async function handlePushSelected() {
    const selectedRows = resultsRef.current.filter((r) => selected.has(r.pabblyIndex));
    const newWithNoRegion = selectedRows.filter((r) => r.matchType === "new" && !getEffectiveRegion(r));
    if (newWithNoRegion.length > 0) {
      setPushError(
        `${newWithNoRegion.length} new row${newWithNoRegion.length !== 1 ? "s" : ""} ${newWithNoRegion.length !== 1 ? "have" : "has"} no region — assign before pushing.`
      );
      return;
    }
    if (pledgeRevertSnapshot) {
      const ok = window.confirm("You have an unreverted push. Pushing again makes the previous push permanent. Continue?");
      if (!ok) return;
    }
    setSelectedPushing(true);
    setCleanMsg(null);
    setPushError(null);
    try {
      const data = await pushRows(selectedRows);
      storeRevertSnapshot(data, selectedRows);
      const selIndices = new Set(selectedRows.map((r) => r.pabblyIndex));
      const afterCount = resultsRef.current.filter((r) => !selIndices.has(r.pabblyIndex)).length;
      removeRows(selectedRows);
      if (afterCount === 0) { const { sheetId: sid } = getConfig(); deleteQueueBg(sid); setQueueRawRows([]); }
      const addedCount   = selectedRows.filter((r) => r.matchType === "new").length;
      const updatedCount = selectedRows.length - addedCount;
      const parts = [];
      if (updatedCount > 0) parts.push(`${updatedCount} row${updatedCount !== 1 ? "s" : ""} updated`);
      if (addedCount   > 0) parts.push(`${addedCount} row${addedCount !== 1 ? "s" : ""} added`);
      setCleanMsg(parts.join(", "));
    } catch (err) {
      setPushError(err.message);
    } finally {
      setSelectedPushing(false);
    }
  }

  async function handleRemoveRows(rows) {
    removeRows(rows);
  }

  // ── Revert ────────────────────────────────────────────────────────────────────

  async function handleRevert() {
    if (!pledgeRevertSnapshot) return;
    const { sheetId: sid } = getConfig();
    setPledgeReverting(true);
    setPledgeRevertError(null);
    try {
      const res = await fetch("/api/pledge/revert", {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sheetId:      sid,
          snapshot:     pledgeRevertSnapshot.snapshot,
          fingerprints: pledgeRevertSnapshot.fingerprints,
        }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "Revert failed");

      setResults((prev) => [...prev, ...pledgeRevertRows]);
      setSelected((prev) => {
        const n = new Set(prev);
        pledgeRevertRows.filter((r) => r.matchType === "update").forEach((r) => n.add(r.pabblyIndex));
        return n;
      });
      setPledgeRevertSnapshot(null);
      setPledgeRevertRows([]);
      setPledgeRevertMsg("Last push reverted");
      setTimeout(() => setPledgeRevertMsg(null), 4000);
    } catch (err) {
      setPledgeRevertError(err.message);
    } finally {
      setPledgeReverting(false);
    }
  }

  // ── Field overrides ───────────────────────────────────────────────────────────

  function handleFieldOverride(pabblyIndex, colIndex, choice) {
    const current   = fieldOverridesRef.current[pabblyIndex] ?? {};
    const newForRow = { ...current, [colIndex]: choice };
    fieldOverridesRef.current = { ...fieldOverridesRef.current, [pabblyIndex]: newForRow };
    setFieldOverrides(fieldOverridesRef.current);
  }

  function toggleRow(pabblyIndex) {
    setSelected((prev) => { const n = new Set(prev); if (n.has(pabblyIndex)) n.delete(pabblyIndex); else n.add(pabblyIndex); return n; });
  }

  function handleSelectAll(indices, selectAll) {
    setSelected((prev) => { const n = new Set(prev); indices.forEach((i) => (selectAll ? n.add(i) : n.delete(i))); return n; });
  }

  // ── Response file ─────────────────────────────────────────────────────────────

  async function handleResponseFile(e) {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    try {
      const { decisions, matched } = await parseReviewResponse(file);
      applyResponseDecisions(decisions);
      setResponseMsg(`${matched} decision${matched !== 1 ? "s" : ""} imported`);
      setTimeout(() => setResponseMsg(null), 5000);
    } catch {
      setResponseMsg("Failed to read response file");
      setTimeout(() => setResponseMsg(null), 5000);
    }
  }

  function applyResponseDecisions(decisions) {
    const byKey = {};
    decisions.forEach(({ mfNumber, field, decision }) => {
      const key = mfNumber.toUpperCase();
      if (!byKey[key]) byKey[key] = {};
      byKey[key][field] = decision;
    });

    const newResults        = [];
    const newFieldOverrides = { ...fieldOverridesRef.current };

    resultsRef.current.forEach((result) => {
      if (result.matchType !== "review") { newResults.push(result); return; }
      const mf          = (result.outputRow[MASTER_COLS.MF_NUMBER] ?? "").trim().toUpperCase();
      const mfDecisions = byKey[mf];
      if (!mfDecisions) { newResults.push(result); return; }

      const newOutputRow  = [...result.outputRow];
      const resolvedCols  = new Set();
      const rowOverrides  = { ...(fieldOverridesRef.current[result.pabblyIndex] ?? {}) };

      Object.entries(mfDecisions).forEach(([field, choice]) => {
        const col = FIELD_TO_COL[field];
        if (col === undefined) return;
        resolvedCols.add(col);
        rowOverrides[col] = choice;
        if (choice === "master" && result.masterRow?.[col] !== undefined) newOutputRow[col] = result.masterRow[col];
      });

      const remainingErrors = result.errors.filter((e) => {
        if (e.severity !== "warning") return true;
        const col = MISMATCH_COL_MAP[e.code];
        return col === undefined || !resolvedCols.has(col);
      });

      const hasWarnings  = remainingErrors.some((e) => e.severity === "warning");
      const hasErrors    = remainingErrors.some((e) => e.severity === "error");
      const newMatchType = hasErrors || hasWarnings ? "review" : "update";

      newFieldOverrides[result.pabblyIndex] = rowOverrides;
      newResults.push({ ...result, outputRow: newOutputRow, errors: remainingErrors, matchType: newMatchType, hasErrors });
    });

    fieldOverridesRef.current = newFieldOverrides;
    setResults(newResults);
    setFieldOverrides(newFieldOverrides);
  }

  // ── Navigation ────────────────────────────────────────────────────────────────

  function resetToLog() {
    setResults([]);
    setRawPabblyRows([]);
    rawPabblyRowsRef.current  = [];
    fieldOverridesRef.current = {};
    setSelected(new Set());
    setFieldOverrides({});
    setStatusMsg("");
    setCleanMsg(null);
    setResponseMsg(null);
    setUploadSkipMsg(null);
    setPushError(null);
    setPledgeRevertSnapshot(null);
    setPledgeRevertRows([]);
    setPledgeRevertMsg(null);
    setPledgeRevertError(null);
    setAddMoreSnapshot(null);
    setPhase(PHASES.LOG);
    loadLog(sheetId);
  }

  // ── Render ────────────────────────────────────────────────────────────────────

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
            <h1 className="text-sm font-bold text-white tracking-tight">Pledges</h1>
            <p className="text-xs text-white/40">{sheetTitle || sheetId}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {phase === PHASES.PREVIEW && (
            <button
              onClick={resetToLog}
              className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-medium border border-white/10 transition-all"
            >
              Back to history
            </button>
          )}
        </div>
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
                <h2 className="text-2xl font-bold text-black tracking-tight">Pledge History</h2>
                <p className="text-sm text-black/50 mt-1">
                  {logRows.length > 0
                    ? `${logRows.length} pledge${logRows.length !== 1 ? "s" : ""} pushed`
                    : "No pledges pushed yet"}
                </p>
              </div>
              <button
                onClick={() => setPhase(PHASES.UPLOAD)}
                className="flex items-center gap-2 px-4 py-2.5 bg-black text-white text-sm font-semibold rounded-xl hover:bg-black/80 transition-all"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Upload new file
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

            {pledgeRevertMsg && (
              <div className="mb-4 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-700">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {pledgeRevertMsg}
              </div>
            )}

            {logLoading ? (
              <div className="bg-white rounded-2xl border border-black/8 shadow-sm p-12 text-center text-black/30 text-sm">Loading…</div>
            ) : (
              <div className="bg-white rounded-2xl border border-black/8 shadow-sm overflow-hidden">
                <PledgeLogTable rows={logRows} />
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
                <h2 className="text-2xl font-bold text-black tracking-tight">Upload Pledge File</h2>
                <p className="text-sm text-black/50 mt-1">Drag and drop your CSV or XLSX export from Pabbly.</p>
              </div>
            </div>

            <div className="bg-white rounded-2xl border border-black/8 shadow-sm p-6">
              <DropZone onFile={handleFile} />
            </div>

            {statusMsg && (
              <div className="mt-4 flex items-center justify-center gap-2">
                {statusMsg.endsWith("…") && (
                  <svg className="w-4 h-4 text-black/40 animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                <p className="text-sm text-black/50">{statusMsg}</p>
              </div>
            )}
          </div>
        )}

        {/* ── PREVIEW ── */}
        {phase === PHASES.PREVIEW && (
          <div className="flex flex-col" style={{ height: "calc(100vh - 136px)" }}>
            <div className="flex items-center justify-between mb-4 shrink-0">
              <div>
                <h2 className="text-xl font-bold text-black tracking-tight">Review pledges</h2>
                <p className="text-sm text-black mt-0.5">Check each row before updating Google Sheets.</p>
              </div>
              <div className="flex items-center gap-3">
                <div className="relative group">
                  <button
                    onClick={() => addRowsInputRef.current?.click()}
                    className="px-4 py-2 text-sm bg-white border border-black/20 rounded-xl text-black font-medium shadow-sm hover:shadow hover:border-black/30 transition-all flex items-center gap-2"
                  >
                    <svg className="w-3.5 h-3.5 text-black/50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                    </svg>
                    Add new CSV
                  </button>
                  <div className="absolute right-0 top-full mt-2 w-72 bg-black text-white text-xs rounded-xl p-3 shadow-xl hidden group-hover:block z-50 leading-relaxed">
                    <p className="font-semibold mb-1">Add rows from another Pabbly export</p>
                    <p className="text-white/60">
                      New rows are merged into the current preview. Duplicate Ticket IDs are skipped.
                      {isResumedSession ? " Current preview was loaded from a previous session — adding a file will combine both." : ""}
                    </p>
                  </div>
                </div>
                <input
                  ref={addRowsInputRef}
                  type="file"
                  accept=".csv,.xlsx,.xls"
                  className="hidden"
                  onChange={(e) => { const f = e.target.files[0]; e.target.value = ""; if (f) handleAddMoreRows(f); }}
                />
                <button
                  onClick={() => responseInputRef.current?.click()}
                  className="px-4 py-2 text-sm bg-white border border-black/20 rounded-xl text-black font-medium shadow-sm hover:shadow hover:border-black/30 transition-all"
                >
                  Upload region response
                </button>
                <input ref={responseInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleResponseFile} />
                {addMoreSnapshot && (
                  <button
                    onClick={handleUndoAddMore}
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
                {pledgeRevertSnapshot && (
                  <button
                    onClick={handleRevert}
                    disabled={pledgeReverting}
                    className="px-4 py-2 text-sm bg-white border border-red-200 rounded-xl text-red-600 font-medium shadow-sm hover:bg-red-50 hover:border-red-300 disabled:opacity-30 transition-all flex items-center gap-2"
                  >
                    {pledgeReverting && (
                      <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                      </svg>
                    )}
                    {pledgeReverting ? "Reverting…" : "Revert last push"}
                  </button>
                )}
                <button
                  onClick={handlePushSelected}
                  disabled={selected.size === 0 || selectedPushing || cleanPushing}
                  className="px-4 py-2 text-sm bg-black text-white rounded-xl font-semibold hover:bg-black/80 disabled:opacity-30 transition-all flex items-center gap-2"
                >
                  {selectedPushing && (
                    <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                    </svg>
                  )}
                  {selectedPushing ? "Updating…" : `Update ${selected.size} selected`}
                </button>
              </div>
            </div>

            {uploadSkipMsg && (
              <div className="mb-3 flex items-center gap-2 p-3 bg-black/5 border border-black/10 rounded-xl text-sm text-black/60 shrink-0">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {uploadSkipMsg}
              </div>
            )}
            {responseMsg && (
              <div className="mb-3 flex items-center gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-sm text-blue-700 shrink-0">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {responseMsg}
              </div>
            )}
            {cleanMsg && (
              <div className="mb-3 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-700 shrink-0">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {cleanMsg}
              </div>
            )}
            {pledgeRevertMsg && (
              <div className="mb-3 flex items-center gap-2 p-3 bg-emerald-50 border border-emerald-100 rounded-xl text-sm text-emerald-700 shrink-0">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
                {pledgeRevertMsg}
              </div>
            )}
            {pledgeRevertError && (
              <div className="mb-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 shrink-0">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {pledgeRevertError}
              </div>
            )}
            {pushError && (
              <div className="mb-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 shrink-0">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                {pushError}
              </div>
            )}

            <div className="bg-white rounded-2xl border border-black/8 shadow-sm overflow-hidden flex-1 min-h-0">
              <PreviewTable
                results={results}
                selected={selected}
                onToggle={toggleRow}
                onSelectAll={handleSelectAll}
                onPushClean={handlePushClean}
                cleanPushing={cleanPushing}
                onRemoveRows={handleRemoveRows}
                onPushRow={handlePushRow}
                rowPushing={rowPushing}
                fieldOverrides={fieldOverrides}
                onFieldOverride={handleFieldOverride}
              />
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
