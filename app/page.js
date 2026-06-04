"use client";
import { useState, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import DropZone from "@/components/DropZone";
import PreviewTable from "@/components/PreviewTable";
import { parseFile } from "@/lib/parseFile";
import { matchRows } from "@/lib/matchRows";
import { parseReviewResponse } from "@/lib/parseReviewResponse";
import { MASTER_COLS, PABBLY_COLS, QUEUE_STATUS_HEADER } from "@/config/columns";

const PHASES = {
  SHEET_CONFIG: "sheet_config",
  UPLOAD:       "upload",
  PREVIEW:      "preview",
  DONE:         "done",
};

const SESSION_KEY = "mfp_sheet_config";

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

// ─── Pure helpers ──────────────────────────────────────────────────────────────

function extractSheetId(value) {
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : value.trim();
}

// Read sheet config from sessionStorage. Returns {} if missing/corrupt.
function getConfig() {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

// ─── Queue status helpers ──────────────────────────────────────────────────────

function getStatusColIdx(allRows) {
  return (allRows[0] ?? []).indexOf(QUEUE_STATUS_HEADER);
}

// Returns header + only pending rows (status not "pushed" or "dismissed").
function getPendingRows(allRows) {
  if (!allRows || allRows.length === 0) return [];
  const statusIdx = getStatusColIdx(allRows);
  return allRows.filter((row, i) => {
    if (i === 0) return true;
    const s = statusIdx !== -1 ? (row[statusIdx] ?? "") : "";
    return s !== "pushed" && s !== "dismissed";
  });
}

// Serialise field overrides → status JSON string. Returns "" when empty.
function buildStatusJson(overrides) {
  if (!overrides || Object.keys(overrides).length === 0) return "";
  return JSON.stringify({ overrides });
}

// Parse a status cell. Returns {} for "pushed", "dismissed", "", or invalid JSON.
function parseStatusJson(status) {
  if (!status || status === "pushed" || status === "dismissed") return {};
  try { return JSON.parse(status); } catch { return {}; }
}

// Rebuild fieldOverrides from the status column of pending rows.
// pabblyIndex i maps to pendingRows[i + 1].
function rehydrateOverrides(allRows, pendingRows) {
  const statusIdx = getStatusColIdx(allRows);
  if (statusIdx === -1) return {};
  const overrides = {};
  pendingRows.slice(1).forEach((row, i) => {
    const parsed = parseStatusJson(row[statusIdx] ?? "");
    if (parsed.overrides && Object.keys(parsed.overrides).length > 0) {
      overrides[i] = parsed.overrides;
    }
  });
  return overrides;
}

// ─── Component ────────────────────────────────────────────────────────────────

export default function HomePage() {
  const [phase,           setPhase]           = useState(PHASES.SHEET_CONFIG);
  const [sheetId,         setSheetId]         = useState("");
  const [tabName,         setTabName]         = useState("Sheet1");
  const [sheetTitle,      setSheetTitle]      = useState("");
  const [connectError,    setConnectError]    = useState(null);
  const [connecting,      setConnecting]      = useState(false);

  const [results,         setResults]         = useState([]);
  const [rawPabblyRows,   setRawPabblyRows]   = useState([]);
  const [selected,        setSelected]        = useState(new Set());
  const [fieldOverrides,  setFieldOverrides]  = useState({});
  const [statusMsg,       setStatusMsg]       = useState("");
  const [pushError,       setPushError]       = useState(null);
  const [cleanPushing,    setCleanPushing]    = useState(false);
  const [rowPushing,      setRowPushing]      = useState(false);
  const [cleanMsg,        setCleanMsg]        = useState(null);
  const [selectedPushing, setSelectedPushing] = useState(false);
  const [pushResult,      setPushResult]      = useState(null);
  const [responseMsg,     setResponseMsg]     = useState(null);
  const [uploadSkipMsg,   setUploadSkipMsg]   = useState(null);
  const [queueInfo,       setQueueInfo]       = useState(null);

  const responseInputRef    = useRef(null);
  const overrideDebounceRef = useRef({});

  // Refs for async callbacks — always see the latest state without stale closures.
  const resultsRef        = useRef(results);
  const rawPabblyRowsRef  = useRef(rawPabblyRows);
  // fieldOverridesRef is updated manually in handleFieldOverride (synchronous)
  // AND via useEffect for external updates (response file, resume, reset).
  const fieldOverridesRef = useRef(fieldOverrides);
  useEffect(() => { resultsRef.current       = results;       }, [results]);
  useEffect(() => { rawPabblyRowsRef.current = rawPabblyRows; }, [rawPabblyRows]);
  useEffect(() => { fieldOverridesRef.current = fieldOverrides; }, [fieldOverrides]);

  const router = useRouter();

  // Restore sheet config from sessionStorage on mount.
  useEffect(() => {
    const { sheetId: sid, tabName: tab, sheetTitle: title } = getConfig();
    if (sid) {
      setSheetId(sid);
      setTabName(tab ?? "Sheet1");
      setSheetTitle(title ?? "");
      setPhase(PHASES.UPLOAD);
    }
  }, []);

  // Check for pending queue whenever the upload phase is entered.
  useEffect(() => {
    if (phase !== PHASES.UPLOAD) return;
    const { sheetId: sid } = getConfig();
    if (!sid) return;
    fetch(`/api/queue?sheetId=${encodeURIComponent(sid)}`)
      .then((r) => r.json())
      .then(({ rows }) => {
        if (!rows) { setQueueInfo(null); return; }
        const pending = getPendingRows(rows);
        setQueueInfo(pending.length > 1 ? { rowCount: pending.length - 1 } : null);
      })
      .catch(() => setQueueInfo(null));
  }, [phase]);

  // ─── Sheet config ────────────────────────────────────────────────────────────

  function handleSheetIdInput(e) {
    setSheetId(extractSheetId(e.target.value));
  }

  async function handleConnect(e) {
    e.preventDefault();
    setConnectError(null);
    setConnecting(true);
    try {
      const sid = extractSheetId(sheetId);
      const tab = tabName.trim();
      const res = await fetch(`/api/sheet?sheetId=${encodeURIComponent(sid)}&tab=${encodeURIComponent(tab)}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Could not connect to sheet");
      const { title } = await res.json();
      setSheetId(sid);
      setSheetTitle(title ?? sid);
      sessionStorage.setItem(SESSION_KEY, JSON.stringify({ sheetId: sid, tabName: tab, sheetTitle: title ?? sid }));
      setPhase(PHASES.UPLOAD);
    } catch (err) {
      setConnectError(err.message);
    } finally {
      setConnecting(false);
    }
  }

  // ─── Queue persistence helpers ───────────────────────────────────────────────

  async function saveQueue(sid, allRows) {
    const res = await fetch("/api/queue", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ sheetId: sid, rows: allRows }),
    });
    if (!res.ok) throw new Error((await res.json()).error ?? "Failed to save queue");
  }

  // Mark rows by Ticket ID. Saves to sheet FIRST, then updates memory.
  // Returns the updated queue array.
  async function markRowsAs(rowsToMark, status) {
    const { sheetId: sid } = getConfig();
    const ticketIds = new Set(rowsToMark.map((r) => r.ticketId).filter(Boolean));
    const allRows   = rawPabblyRowsRef.current;
    const statusIdx = getStatusColIdx(allRows);

    const updated = allRows.map((row, i) => {
      if (i === 0 || statusIdx === -1) return row;
      const tid = (row[PABBLY_COLS.TICKET_ID] ?? "").trim();
      if (!ticketIds.has(tid)) return row;
      const next = [...row];
      next[statusIdx] = status;
      return next;
    });

    await saveQueue(sid, updated);
    setRawPabblyRows(updated);
    rawPabblyRowsRef.current = updated;
    return updated;
  }

  // Revert rows to pending after a failed master-sheet push.
  async function revertRowsStatus(rowsToRevert, markedQueue) {
    const { sheetId: sid } = getConfig();
    const ticketIds = new Set(rowsToRevert.map((r) => r.ticketId).filter(Boolean));
    const statusIdx = getStatusColIdx(markedQueue);

    const reverted = markedQueue.map((row, i) => {
      if (i === 0 || statusIdx === -1) return row;
      const tid = (row[PABBLY_COLS.TICKET_ID] ?? "").trim();
      if (!ticketIds.has(tid)) return row;
      const next = [...row];
      next[statusIdx] = "";
      return next;
    });

    setRawPabblyRows(reverted);
    rawPabblyRowsRef.current = reverted;
    try { await saveQueue(sid, reverted); } catch { /* best-effort */ }
  }

  // Persist field overrides for a single row (called from debounce).
  async function persistRowOverrides(pabblyIndex, overridesForRow) {
    const { sheetId: sid } = getConfig();
    const result = resultsRef.current.find((r) => r.pabblyIndex === pabblyIndex);
    if (!result?.ticketId) return;

    const allRows   = rawPabblyRowsRef.current;
    const statusIdx = getStatusColIdx(allRows);
    if (statusIdx === -1) return;

    const rowIdx = allRows.findIndex(
      (row, i) => i > 0 && (row[PABBLY_COLS.TICKET_ID] ?? "").trim() === result.ticketId
    );
    if (rowIdx === -1) return;

    const updated = allRows.map((row, i) => {
      if (i !== rowIdx) return row;
      const next = [...row];
      next[statusIdx] = buildStatusJson(overridesForRow);
      return next;
    });

    setRawPabblyRows(updated);
    rawPabblyRowsRef.current = updated;
    try { await saveQueue(sid, updated); } catch { /* best-effort */ }
  }

  // Persist overrides for multiple rows at once (after a response file import).
  async function persistBatchOverrides(statusUpdates, snapshotAllRows) {
    const { sheetId: sid } = getConfig();
    const statusIdx = getStatusColIdx(snapshotAllRows);
    if (statusIdx === -1) return;

    const statusByTicketId = {};
    statusUpdates.forEach(({ ticketId, overrides }) => {
      if (!ticketId) return; // skip rows without a ticket ID
      statusByTicketId[ticketId] = buildStatusJson(overrides);
    });

    const updated = snapshotAllRows.map((row, i) => {
      if (i === 0) return row;
      const tid = (row[PABBLY_COLS.TICKET_ID] ?? "").trim();
      if (!Object.prototype.hasOwnProperty.call(statusByTicketId, tid)) return row;
      const next = [...row];
      next[statusIdx] = statusByTicketId[tid];
      return next;
    });

    setRawPabblyRows(updated);
    rawPabblyRowsRef.current = updated;
    try { await saveQueue(sid, updated); } catch { /* best-effort */ }
  }

  // ─── Shared state reset ───────────────────────────────────────────────────────

  function clearPreviewState() {
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
    setPushResult(null);
    setPushError(null);
    setCleanPushing(false);
    setSelectedPushing(false);
    setRowPushing(false);
  }

  // ─── Upload flow ──────────────────────────────────────────────────────────────

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

    setStatusMsg("Checking queue…");
    let existingQueue = [];
    try {
      const { rows } = await fetch(`/api/queue?sheetId=${encodeURIComponent(sid)}`).then((r) => r.json());
      existingQueue = rows ?? [];
    } catch { /* treat as empty */ }

    const knownTicketIds = new Set(
      existingQueue.slice(1)
        .map((row) => (row[PABBLY_COLS.TICKET_ID] ?? "").trim())
        .filter(Boolean)
    );

    const csvDataRows   = newPabblyRawRows.slice(1);
    const genuinelyNew  = csvDataRows.filter((row) => {
      const tid = (row[PABBLY_COLS.TICKET_ID] ?? "").trim();
      return tid && !knownTicketIds.has(tid);
    });
    const skippedCount = csvDataRows.length - genuinelyNew.length;

    if (genuinelyNew.length === 0) {
      setStatusMsg(
        `All ${csvDataRows.length} row${csvDataRows.length !== 1 ? "s" : ""} already queued or processed — nothing new to add.`
      );
      return;
    }

    // Merge: normalise existing queue to have status col, then append new rows.
    let mergedQueue;
    if (existingQueue.length === 0) {
      mergedQueue = [
        [...newPabblyRawRows[0], QUEUE_STATUS_HEADER],
        ...genuinelyNew.map((row) => [...row, ""]),
      ];
    } else {
      const existingStatusIdx = getStatusColIdx(existingQueue);
      const normalized = existingStatusIdx !== -1
        ? existingQueue
        : existingQueue.map((row, i) => i === 0 ? [...row, QUEUE_STATUS_HEADER] : [...row, ""]);
      mergedQueue = [...normalized, ...genuinelyNew.map((row) => [...row, ""])];
    }

    setStatusMsg("Saving to queue…");
    try {
      await saveQueue(sid, mergedQueue);
    } catch (err) {
      setStatusMsg(`Queue error: ${err.message}`);
      return;
    }

    setStatusMsg("Fetching master sheet…");
    let sheetData;
    try {
      const res = await fetch(`/api/sheet?sheetId=${encodeURIComponent(sid)}&tab=${encodeURIComponent(tab)}`);
      if (!res.ok) throw new Error((await res.json()).error ?? "Failed to fetch sheet");
      sheetData = await res.json();
    } catch (err) {
      setStatusMsg(`Sheet fetch error: ${err.message}`);
      return;
    }

    setStatusMsg("Matching rows…");
    const pendingRows      = getPendingRows(mergedQueue);
    const initialOverrides = rehydrateOverrides(mergedQueue, pendingRows);
    const matched = matchRows(pendingRows, sheetData.rows, sheetData.headers);
    const initialSelected = new Set(
      matched
        .filter((r) => r.matchType === "update" ||
          (r.matchType === "new" && !r.hasErrors && !r.errors.some((e) => e.severity === "warning")))
        .map((r) => r.pabblyIndex)
    );

    setRawPabblyRows(mergedQueue);
    rawPabblyRowsRef.current  = mergedQueue;
    fieldOverridesRef.current = initialOverrides;
    setResults(matched);
    setSelected(initialSelected);
    setFieldOverrides(initialOverrides);
    setStatusMsg("");
    if (skippedCount > 0) {
      setUploadSkipMsg(`${skippedCount} row${skippedCount !== 1 ? "s" : ""} already queued or processed — skipped`);
    }
    setPhase(PHASES.PREVIEW);
  }

  // ─── Resume flow ──────────────────────────────────────────────────────────────

  async function resumeFromQueue() {
    const { sheetId: sid, tabName: tab } = getConfig();
    setStatusMsg("Loading queue…");
    try {
      const [queueRes, sheetRes] = await Promise.all([
        fetch(`/api/queue?sheetId=${encodeURIComponent(sid)}`),
        fetch(`/api/sheet?sheetId=${encodeURIComponent(sid)}&tab=${encodeURIComponent(tab)}`),
      ]);
      if (!sheetRes.ok) throw new Error((await sheetRes.json()).error ?? "Failed to fetch sheet");
      const { rows: queueRawRows }        = await queueRes.json();
      const { headers, rows: masterRows } = await sheetRes.json();

      if (!queueRawRows || queueRawRows.length < 2) {
        setQueueInfo(null); setStatusMsg(""); return;
      }
      const pendingRows = getPendingRows(queueRawRows);
      if (pendingRows.length < 2) {
        setQueueInfo(null); setStatusMsg(""); return;
      }

      const initialOverrides = rehydrateOverrides(queueRawRows, pendingRows);
      setStatusMsg("Matching rows…");
      const matched = matchRows(pendingRows, masterRows, headers);
      const initialSelected = new Set(
        matched
          .filter((r) => r.matchType === "update" ||
            (r.matchType === "new" && !r.hasErrors && !r.errors.some((e) => e.severity === "warning")))
          .map((r) => r.pabblyIndex)
      );

      setRawPabblyRows(queueRawRows);
      rawPabblyRowsRef.current  = queueRawRows;
      fieldOverridesRef.current = initialOverrides;
      setResults(matched);
      setSelected(initialSelected);
      setFieldOverrides(initialOverrides);
      setQueueInfo(null);
      setStatusMsg("");
      setPhase(PHASES.PREVIEW);
    } catch (err) {
      setStatusMsg(`Error: ${err.message}`);
    }
  }

  // Dismiss all pending rows — preserves pushed/dismissed history (Option A).
  async function discardQueue() {
    const { sheetId: sid } = getConfig();
    try {
      const { rows } = await fetch(`/api/queue?sheetId=${encodeURIComponent(sid)}`).then((r) => r.json());
      if (!rows || rows.length < 2) { setQueueInfo(null); return; }

      const statusIdx = getStatusColIdx(rows);

      if (statusIdx === -1) {
        // Legacy queue without status column — add it and dismiss all rows.
        const updated = rows.map((row, i) =>
          i === 0 ? [...row, QUEUE_STATUS_HEADER] : [...row, "dismissed"]
        );
        await saveQueue(sid, updated);
      } else {
        const updated = rows.map((row, i) => {
          if (i === 0) return row;
          const s = row[statusIdx] ?? "";
          if (s === "pushed" || s === "dismissed") return row;
          const next = [...row];
          next[statusIdx] = "dismissed";
          return next;
        });
        await saveQueue(sid, updated);
      }
    } catch { /* best-effort */ }
    setQueueInfo(null);
  }

  function handleChangeSheet() {
    sessionStorage.removeItem(SESSION_KEY);
    clearPreviewState();
    setQueueInfo(null);
    setPhase(PHASES.SHEET_CONFIG);
  }

  // ─── Field override with debounced persistence ────────────────────────────────

  function scheduleStatusSave(pabblyIndex, overridesForRow) {
    clearTimeout(overrideDebounceRef.current[pabblyIndex]);
    overrideDebounceRef.current[pabblyIndex] = setTimeout(() => {
      delete overrideDebounceRef.current[pabblyIndex];
      persistRowOverrides(pabblyIndex, overridesForRow);
    }, 800);
  }

  function handleFieldOverride(pabblyIndex, colIndex, choice) {
    // Update the ref synchronously so rapid clicks accumulate correctly.
    const current    = fieldOverridesRef.current[pabblyIndex] ?? {};
    const newForRow  = { ...current, [colIndex]: choice };
    fieldOverridesRef.current = { ...fieldOverridesRef.current, [pabblyIndex]: newForRow };

    setFieldOverrides(fieldOverridesRef.current);
    scheduleStatusSave(pabblyIndex, newForRow);
  }

  function toggleRow(pabblyIndex) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pabblyIndex)) next.delete(pabblyIndex); else next.add(pabblyIndex);
      return next;
    });
  }

  function handleSelectAll(indices, selectAll) {
    setSelected((prev) => {
      const next = new Set(prev);
      indices.forEach((i) => (selectAll ? next.add(i) : next.delete(i)));
      return next;
    });
  }

  // ─── Push to master sheet ─────────────────────────────────────────────────────

  async function pushRows(rowSubset) {
    const { sheetId: sid, tabName: tab } = getConfig();
    const updates = [], appends = [];
    rowSubset.forEach((r) => {
      const rowOverrides = fieldOverridesRef.current[r.pabblyIndex] ?? {};
      const effectiveRow = [...r.outputRow];
      Object.entries(rowOverrides).forEach(([colStr, choice]) => {
        const col = parseInt(colStr);
        if (choice === "master" && r.masterRow?.[col] !== undefined) {
          effectiveRow[col] = r.masterRow[col];
        } else if (choice !== "pabbly" && choice !== "master") {
          effectiveRow[col] = choice;
        }
      });
      if (r.masterRowIndex !== null) updates.push({ rowIndex: r.masterRowIndex, values: effectiveRow });
      else appends.push(effectiveRow);
    });
    const res  = await fetch("/api/push", {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify({ sheetId: sid, tab, updates, appends }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error ?? "Update failed");
    return data;
  }

  // Remove rows from the UI results list only — does NOT touch the queue tab.
  function removeRows(rowSubset) {
    const indices = new Set(rowSubset.map((r) => r.pabblyIndex));
    setResults((prev) => prev.filter((r) => !indices.has(r.pabblyIndex)));
    setSelected((prev) => {
      const next = new Set(prev);
      indices.forEach((i) => next.delete(i));
      return next;
    });
    return indices.size;
  }

  // ─── Push handlers ────────────────────────────────────────────────────────────

  async function handlePushRow(result) {
    if (result.matchType === "new" && !getEffectiveRegion(result)) {
      setPushError("This new row has no region selected — assign a region before pushing.");
      return;
    }
    setRowPushing(true);
    setPushError(null);

    let markedQueue;
    try {
      markedQueue = await markRowsAs([result], "pushed");
    } catch (err) {
      setPushError(err.message);
      setRowPushing(false);
      return;
    }

    try {
      const data = await pushRows([result]);
      const left = results.length - removeRows([result]);
      if (left === 0) { setPushResult(data); setPhase(PHASES.DONE); }
    } catch (err) {
      await revertRowsStatus([result], markedQueue);
      setPushError(err.message);
    } finally {
      setRowPushing(false);
    }
  }

  async function handlePushClean(cleanRows) {
    setCleanPushing(true);
    setCleanMsg(null);
    setPushError(null);

    let markedQueue;
    try {
      markedQueue = await markRowsAs(cleanRows, "pushed");
    } catch (err) {
      setPushError(err.message);
      setCleanPushing(false);
      return;
    }

    try {
      const data = await pushRows(cleanRows);
      removeRows(cleanRows);

      const pendingLeft = getPendingRows(markedQueue).length - 1;
      if (pendingLeft === 0) {
        setPushResult(data);
        setPhase(PHASES.DONE);
      } else {
        const addedCount   = cleanRows.filter((r) => r.matchType === "new").length;
        const updatedCount = cleanRows.length - addedCount;
        const parts = [];
        if (updatedCount > 0) parts.push(`${updatedCount} row${updatedCount !== 1 ? "s" : ""} updated`);
        if (addedCount   > 0) parts.push(`${addedCount} row${addedCount !== 1 ? "s" : ""} added`);
        setCleanMsg(parts.join(", "));
      }
    } catch (err) {
      await revertRowsStatus(cleanRows, markedQueue);
      setPushError(err.message);
    } finally {
      setCleanPushing(false);
    }
  }

  async function handlePushSelected() {
    setSelectedPushing(true);
    setCleanMsg(null);
    setPushError(null);
    const selectedRows = results.filter((r) => selected.has(r.pabblyIndex));

    const newWithNoRegion = selectedRows.filter((r) => r.matchType === "new" && !getEffectiveRegion(r));
    if (newWithNoRegion.length > 0) {
      setPushError(
        `${newWithNoRegion.length} new row${newWithNoRegion.length !== 1 ? "s" : ""} ${newWithNoRegion.length !== 1 ? "have" : "has"} no region selected — assign a region before pushing.`
      );
      setSelectedPushing(false);
      return;
    }

    let markedQueue;
    try {
      markedQueue = await markRowsAs(selectedRows, "pushed");
    } catch (err) {
      setPushError(err.message);
      setSelectedPushing(false);
      return;
    }

    try {
      const data = await pushRows(selectedRows);
      const left = results.length - removeRows(selectedRows);
      if (left === 0) {
        setPushResult(data);
        setPhase(PHASES.DONE);
      } else {
        const addedCount   = selectedRows.filter((r) => r.matchType === "new").length;
        const updatedCount = selectedRows.length - addedCount;
        const parts = [];
        if (updatedCount > 0) parts.push(`${updatedCount} row${updatedCount !== 1 ? "s" : ""} updated`);
        if (addedCount   > 0) parts.push(`${addedCount} row${addedCount !== 1 ? "s" : ""} added`);
        setCleanMsg(parts.join(", "));
      }
    } catch (err) {
      await revertRowsStatus(selectedRows, markedQueue);
      setPushError(err.message);
    } finally {
      setSelectedPushing(false);
    }
  }

  // ─── Dismiss rows ─────────────────────────────────────────────────────────────

  async function handleRemoveRows(rows) {
    removeRows(rows);
    try { await markRowsAs(rows, "dismissed"); } catch { /* best-effort */ }
  }

  // ─── Response file ────────────────────────────────────────────────────────────

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
      setResponseMsg("Failed to read response file — make sure it's an unmodified export");
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
    const statusUpdates     = [];
    const newFieldOverrides = { ...fieldOverridesRef.current };

    resultsRef.current.forEach((result) => {
      if (result.matchType !== "review") { newResults.push(result); return; }

      const mf          = (result.outputRow[MASTER_COLS.MF_NUMBER] ?? "").trim().toUpperCase();
      const mfDecisions = byKey[mf];
      if (!mfDecisions) { newResults.push(result); return; }

      const newOutputRow = [...result.outputRow];
      const resolvedCols = new Set();
      const rowOverrides = { ...(fieldOverridesRef.current[result.pabblyIndex] ?? {}) };

      Object.entries(mfDecisions).forEach(([field, choice]) => {
        const col = FIELD_TO_COL[field];
        if (col === undefined) return;
        resolvedCols.add(col);
        rowOverrides[col] = choice;
        if (choice === "master" && result.masterRow?.[col] !== undefined) {
          newOutputRow[col] = result.masterRow[col];
        }
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
      statusUpdates.push({ pabblyIndex: result.pabblyIndex, ticketId: result.ticketId, overrides: rowOverrides });
      newResults.push({ ...result, outputRow: newOutputRow, errors: remainingErrors, matchType: newMatchType, hasErrors });
    });

    fieldOverridesRef.current = newFieldOverrides;
    setResults(newResults);
    setFieldOverrides(newFieldOverrides);

    if (statusUpdates.length > 0) {
      persistBatchOverrides(statusUpdates, rawPabblyRowsRef.current);
    }
  }

  // ─── Misc ─────────────────────────────────────────────────────────────────────

  function getEffectiveRegion(result) {
    const override = (fieldOverridesRef.current[result.pabblyIndex] ?? {})[MASTER_COLS.REGION];
    if (override && override !== "pabbly" && override !== "master") return override;
    return (result.outputRow[MASTER_COLS.REGION] ?? "").trim();
  }

  function reset() {
    clearPreviewState();
    setQueueInfo(null);
    setPhase(PHASES.UPLOAD);
    // Queue persists in the sheet — pending rows will appear as resume banner.
  }

  async function handleSignOut() {
    sessionStorage.removeItem(SESSION_KEY);
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  // ─── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-[#f5f5f5]">
      <header className="bg-black px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-7 h-7 bg-white rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4 h-4 text-black" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-bold text-white tracking-tight">MFP App</h1>
            <p className="text-xs text-white/40">Pledge CSV Processor</p>
          </div>
        </div>
        <button
          onClick={handleSignOut}
          className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-medium border border-white/10 hover:border-white/20 transition-all"
        >
          Sign out
        </button>
      </header>

      <main className={`max-w-7xl mx-auto px-6 ${phase === PHASES.PREVIEW ? "py-4" : "py-10"}`}>

        {/* ── SHEET CONFIG ── */}
        {phase === PHASES.SHEET_CONFIG && (
          <div className="max-w-md mx-auto">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-black tracking-tight">Connect your sheet</h2>
              <p className="text-sm text-black/50 mt-1">Paste in the Google Sheet ID and the tab name to get started.</p>
            </div>
            <div className="bg-white rounded-2xl border border-black/8 shadow-sm p-8">
              <form onSubmit={handleConnect} className="space-y-5">
                <div>
                  <label className="block text-sm font-semibold text-black mb-1.5">Sheet ID or URL</label>
                  <input
                    type="text"
                    value={sheetId}
                    onChange={handleSheetIdInput}
                    placeholder="Paste the Sheet ID or the full Google Sheets URL"
                    className="w-full px-3.5 py-2.5 border border-black/15 rounded-xl text-sm font-mono text-black placeholder:text-black/25 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black/30 transition-all"
                    required
                  />
                  <p className="mt-1.5 text-xs text-black/40">You can paste the full URL — the ID will be extracted automatically.</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-black mb-1.5">Tab name</label>
                  <input
                    type="text"
                    value={tabName}
                    onChange={(e) => setTabName(e.target.value)}
                    placeholder="Sheet1"
                    className="w-full px-3.5 py-2.5 border border-black/15 rounded-xl text-sm text-black placeholder:text-black/25 focus:outline-none focus:ring-2 focus:ring-black/20 focus:border-black/30 transition-all"
                    required
                  />
                </div>
                {connectError && (
                  <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl">
                    <svg className="w-4 h-4 text-red-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-sm text-red-600">{connectError}</p>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={connecting}
                  className="w-full bg-black text-white py-2.5 rounded-xl text-sm font-semibold hover:bg-black/80 disabled:opacity-40 transition-all"
                >
                  {connecting ? "Connecting…" : "Connect to sheet"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── UPLOAD ── */}
        {phase === PHASES.UPLOAD && (
          <div className="max-w-xl mx-auto">
            <div className="mb-8">
              <h2 className="text-2xl font-bold text-black tracking-tight">Upload Pabbly file</h2>
              <p className="text-sm text-black/50 mt-1">Drag and drop your CSV or XLSX export from Pabbly.</p>
            </div>

            <div className="bg-white rounded-2xl border border-black/8 shadow-sm p-4 mb-4 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-9 h-9 bg-emerald-50 border border-emerald-100 rounded-xl flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-emerald-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 17V7m0 10a2 2 0 01-2 2H5a2 2 0 01-2-2V7a2 2 0 012-2h2a2 2 0 012 2m0 10a2 2 0 002 2h2a2 2 0 002-2M9 7a2 2 0 012-2h2a2 2 0 012 2m0 10V7m0 10a2 2 0 002 2h2a2 2 0 002-2V7a2 2 0 00-2-2h-2a2 2 0 00-2 2" />
                  </svg>
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                    <p className="text-sm font-semibold text-black">{sheetTitle || sheetId}</p>
                  </div>
                  <p className="text-xs text-black/40 mt-0.5">Tab: <span className="font-medium text-black/60">{tabName}</span></p>
                </div>
              </div>
              <button
                onClick={handleChangeSheet}
                className="text-xs bg-white text-black/60 hover:text-black border border-black/15 shadow-sm hover:shadow hover:border-black/25 px-3 py-1.5 rounded-lg font-medium transition-all"
              >
                Change
              </button>
            </div>

            {queueInfo && (
              <div className="mb-4">
                <button
                  onClick={resumeFromQueue}
                  className="w-full bg-black hover:bg-black/85 rounded-2xl p-5 text-left transition-all group shadow-sm hover:shadow-md"
                >
                  <div className="flex items-center justify-between gap-4">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 bg-white/10 rounded-xl flex items-center justify-center shrink-0">
                        <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14.752 11.168l-3.197-2.132A1 1 0 0010 9.87v4.263a1 1 0 001.555.832l3.197-2.132a1 1 0 000-1.664z" />
                          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        </svg>
                      </div>
                      <div>
                        <p className="text-sm font-bold text-white">Continue where you left off</p>
                        <p className="text-xs text-white/50 mt-0.5">
                          {queueInfo.rowCount} row{queueInfo.rowCount !== 1 ? "s" : ""} still need to be processed
                        </p>
                      </div>
                    </div>
                    <svg className="w-4 h-4 text-white/40 group-hover:text-white/70 transition-colors shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                    </svg>
                  </div>
                </button>
                <button
                  onClick={discardQueue}
                  className="mt-2 w-full text-xs text-black/35 hover:text-black/60 transition-colors py-1 text-center"
                >
                  Dismiss all pending and start fresh
                </button>
              </div>
            )}

            <div className="bg-white rounded-2xl border border-black/8 shadow-sm p-6">
              <DropZone onFile={handleFile} />
            </div>

            {statusMsg && (
              <div className="mt-4 flex items-center justify-center gap-2">
                {/* Spinner only for loading messages (they end with "…") */}
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
                <h2 className="text-xl font-bold text-black tracking-tight">Review changes</h2>
                <p className="text-sm text-black mt-0.5">Check each row before updating Google Sheets.</p>
              </div>
              <div className="flex items-center gap-3">
                <button
                  onClick={reset}
                  className="px-4 py-2 text-sm bg-white border border-black/20 rounded-xl text-black font-medium shadow-sm hover:shadow hover:border-black/30 transition-all"
                >
                  Upload another file
                </button>
                <button
                  onClick={() => responseInputRef.current?.click()}
                  className="px-4 py-2 text-sm bg-white border border-black/20 rounded-xl text-black font-medium shadow-sm hover:shadow hover:border-black/30 transition-all"
                >
                  Upload region response
                </button>
                <input ref={responseInputRef} type="file" accept=".xlsx,.xls" className="hidden" onChange={handleResponseFile} />
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

        {/* ── DONE ── */}
        {phase === PHASES.DONE && (
          <div className="max-w-sm mx-auto text-center py-20">
            <div className="w-16 h-16 bg-black rounded-2xl flex items-center justify-center mx-auto mb-6">
              <svg className="w-8 h-8 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <h2 className="text-2xl font-bold text-black tracking-tight mb-2">All done!</h2>
            <p className="text-sm text-black/50 mb-8">
              <span className="font-semibold text-black">{pushResult?.updated ?? 0}</span> row{pushResult?.updated !== 1 ? "s" : ""} updated
              {" · "}
              <span className="font-semibold text-black">{pushResult?.appended ?? 0}</span> new row{pushResult?.appended !== 1 ? "s" : ""} added
            </p>
            <button
              onClick={reset}
              className="px-6 py-2.5 bg-black text-white rounded-xl text-sm font-semibold hover:bg-black/80 transition-all"
            >
              Process another file
            </button>
          </div>
        )}
      </main>
    </div>
  );
}
