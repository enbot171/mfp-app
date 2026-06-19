"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import { MASTER_COLS } from "@/config/columns";
import ErrorBadge from "./ErrorBadge";
import { exportReviewReport, exportAllRegionsSeparate, exportAllRegionsCombined } from "@/lib/exportReviewReport";

// ─── Constants ────────────────────────────────────────────────────────────────

const STATUS_META = {
  update: { label: "Update", rowBg: "",                badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200" },
  review: { label: "Review", rowBg: "bg-amber-50/60",  badgeCls: "bg-amber-50 text-amber-700 border-amber-200" },
  new:    { label: "New",    rowBg: "bg-violet-50/50", badgeCls: "bg-violet-50 text-violet-700 border-violet-200" },
  error:  { label: "Error",  rowBg: "bg-red-50/60",    badgeCls: "bg-red-50 text-red-700 border-red-200" },
};

// Default sort order: update → new → review → error
const STATUS_PRIORITY = { update: 0, new: 1, review: 2, error: 3 };

const STATUS_OPTIONS = [
  { value: "update", label: "Update" },
  { value: "review", label: "Review" },
  { value: "new",    label: "New" },
  { value: "error",  label: "Error" },
];

const REGIONS = [
  "North", "North East", "East", "Central", "South", "West",
  "Victory International Church", "Other Language Group",
];
const REGION_OPTIONS         = REGIONS.map((r) => ({ value: r, label: r }));
const REGION_OVERRIDE_OPTIONS = REGIONS;

const MISMATCH_COL = {
  NAME_MISMATCH:    MASTER_COLS.FULL_NAME,
  NRIC_MISMATCH:    MASTER_COLS.PARTIAL_NRIC,
  CONTACT_MISMATCH: MASTER_COLS.CONTACT_NUMBER,
  EMAIL_MISMATCH:   MASTER_COLS.EMAIL,
  REGION_MISMATCH:  MASTER_COLS.REGION,
};

const MISMATCH_LABEL = {
  NAME_MISMATCH:    "Name",
  NRIC_MISMATCH:    "NRIC",
  CONTACT_MISMATCH: "Contact",
  EMAIL_MISMATCH:   "Email",
  REGION_MISMATCH:  "Region",
};

// ─── Sub-components ───────────────────────────────────────────────────────────

function getMismatchCode(result, colIndex) {
  return Object.entries(MISMATCH_COL).find(
    ([code, col]) => col === colIndex && result.errors.some((e) => e.code === code)
  )?.[0] ?? null;
}

function EndCell({ result, colIndex, mono = false, fieldOverrides, onFieldOverride }) {
  const mismatchCode = getMismatchCode(result, colIndex);
  const endVal    = (result.outputRow?.[colIndex] ?? "").trim();
  const masterVal = result.masterRow ? (result.masterRow[colIndex] ?? "").trim() : null;
  const cls = `px-4 py-3 text-xs${mono ? " font-mono" : ""}`;

  // Missing region: show dropdown so admin can manually assign the correct region
  if (colIndex === MASTER_COLS.REGION && result.errors.some((e) => e.code === "MISSING_REGION")) {
    const selected = (fieldOverrides?.[result.pabblyIndex] ?? {})[colIndex] ?? "";
    const hasValue = selected && selected !== "pabbly";
    return (
      <td className={cls}>
        <div className="relative">
          <select
            value={selected}
            onChange={(e) => onFieldOverride(result.pabblyIndex, colIndex, e.target.value)}
            className={`w-full appearance-none pl-2 pr-6 py-1 text-xs border rounded-lg focus:outline-none focus:ring-1 transition-all cursor-pointer ${
              hasValue
                ? "border-emerald-400 bg-emerald-50 text-emerald-800 focus:ring-emerald-300"
                : "border-amber-300 bg-amber-50 text-amber-700 focus:ring-amber-300"
            }`}
          >
            <option value="">Select region…</option>
            {REGION_OVERRIDE_OPTIONS.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <span className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-[10px] opacity-50">▾</span>
        </div>
        {endVal && !hasValue && (
          <span className="text-[10px] text-black/30 block mt-0.5 truncate">Current: {endVal}</span>
        )}
      </td>
    );
  }

  if (mismatchCode && masterVal !== null) {
    const choice = (fieldOverrides?.[result.pabblyIndex] ?? {})[colIndex] ?? "pabbly";
    return (
      <td className={cls}>
        <div className="flex flex-col gap-1">
          {[
            { key: "master", label: "Current", val: masterVal },
            { key: "pabbly", label: "New",     val: endVal },
          ].map(({ key, label, val }) => (
            <button
              key={key}
              onClick={() => onFieldOverride(result.pabblyIndex, colIndex, key)}
              title={key === "master" ? "Keep value from Google Sheets" : "Use value from Pabbly form"}
              className={`text-left px-2 py-1 rounded-lg border text-xs transition-all ${
                choice === key
                  ? "bg-green-600 text-white border-green-600 font-medium"
                  : "text-black border-black/15 hover:border-black/40"
              }`}
            >
              <span className="text-[10px] opacity-70 block leading-none mb-0.5">{label}</span>
              {val || "—"}
            </button>
          ))}
        </div>
      </td>
    );
  }

  // Plain cell — editable. Typed value becomes a literal override applied on push.
  const override = (fieldOverrides?.[result.pabblyIndex] ?? {})[colIndex];
  const value    = (override !== undefined && override !== "pabbly" && override !== "master") ? override : endVal;
  return (
    <td className={cls}>
      <EditableInput
        value={value}
        mono={mono}
        onChange={(v) => onFieldOverride(result.pabblyIndex, colIndex, v)}
      />
    </td>
  );
}

// Current value for a cell: a literal manual override if present, else the fallback.
function fieldOverrideVal(fieldOverrides, pabblyIndex, colIndex, fallback) {
  const ov = (fieldOverrides?.[pabblyIndex] ?? {})[colIndex];
  return (ov !== undefined && ov !== "pabbly" && ov !== "master") ? ov : (fallback ?? "");
}

// Inline-editable text input styled to look like plain text until hovered/focused.
function EditableInput({ value, onChange, mono = false }) {
  return (
    <input
      type="text"
      value={value ?? ""}
      onChange={(e) => onChange(e.target.value)}
      className={`w-full bg-transparent border border-transparent hover:border-black/15 focus:border-black/40 focus:bg-white rounded-md px-1.5 py-1 text-xs text-black outline-none transition-all ${mono ? "font-mono" : ""}`}
    />
  );
}

function SortBtn({ col, sortCol, sortDir, onSort, children }) {
  const active = sortCol === col;
  return (
    <button
      onClick={() => onSort(col)}
      className="flex items-center gap-1 font-bold text-white uppercase tracking-wider hover:text-white/70 transition-colors text-left w-full text-xs"
    >
      {children}
      <span className={`text-xs ${active ? "text-white" : "text-white/30"}`}>
        {active ? (sortDir === "asc" ? "↑" : "↓") : "↕"}
      </span>
    </button>
  );
}

function FilterInput({ placeholder, value, onChange }) {
  return (
    <input
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1 text-xs border border-white/20 rounded-lg text-black placeholder:text-black/30 focus:outline-none focus:ring-1 focus:ring-white/30 bg-white font-normal normal-case tracking-normal"
    />
  );
}

function CheckboxFilter({ options, selected, onChange, placeholder }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    function onClickOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(value) {
    const next = new Set(selected);
    if (next.has(value)) next.delete(value);
    else next.add(value);
    onChange(next);
  }

  const summary = selected.size === 0
    ? placeholder
    : selected.size === 1
    ? options.find((o) => o.value === [...selected][0])?.label ?? [...selected][0]
    : `${selected.size} selected`;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between gap-1 px-2 py-1 text-xs border border-white/20 rounded-lg bg-white text-black font-normal overflow-hidden"
      >
        <span className={`truncate ${selected.size === 0 ? "text-black/40" : "text-black"}`}>{summary}</span>
        <span className="text-black/40 shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-white border border-black/10 rounded-lg shadow-lg z-30 min-w-32.5">
          {options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-black/5 cursor-pointer select-none">
              <input type="checkbox" checked={selected.has(opt.value)} onChange={() => toggle(opt.value)} className="rounded accent-black" />
              <span className="text-xs text-black">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// Export modal — requires region selection, shows preview before downloading
function ExportModal({ results, onClose }) {
  const [exportRegion, setExportRegion] = useState("");

  // Regions that actually have review rows
  const reviewRegions = useMemo(() => {
    const regions = new Set(
      results
        .filter((r) => r.matchType === "review")
        .map((r) => (r.outputRow[MASTER_COLS.REGION] ?? "").trim())
        .filter(Boolean)
    );
    return [...regions].sort();
  }, [results]);

  // Preview rows for selected region
  const previewRows = useMemo(() => {
    if (!exportRegion) return [];
    return results
      .filter((r) => r.matchType === "review" && (r.outputRow[MASTER_COLS.REGION] ?? "").trim() === exportRegion)
      .flatMap((result) =>
        result.errors
          .filter((e) => e.severity === "warning" && MISMATCH_COL[e.code])
          .map((err) => {
            const colIndex = MISMATCH_COL[err.code];
            return {
              mf:    (result.outputRow[MASTER_COLS.MF_NUMBER] ?? "").trim(),
              ref:   (result.masterRow?.[MASTER_COLS.REF_NO]  ?? "").toString().trim(),
              name:  (result.outputRow[MASTER_COLS.FULL_NAME] ?? "").trim(),
              field: MISMATCH_LABEL[err.code] ?? err.code,
              old:   (result.masterRow?.[colIndex] ?? "").toString().trim(),
              next:  (result.outputRow[colIndex]   ?? "").toString().trim(),
            };
          })
      );
  }, [results, exportRegion]);

  const exportRows = results.filter(
    (r) => r.matchType === "review" && (r.outputRow[MASTER_COLS.REGION] ?? "").trim() === exportRegion
  );

  function handleExport() {
    exportReviewReport(exportRows, exportRegion);
    onClose();
  }

  function handleExportSeparate() {
    exportAllRegionsSeparate(results);
    onClose();
  }

  function handleExportCombined() {
    exportAllRegionsCombined(results);
    onClose();
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div
        className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-black/8">
          <div>
            <h2 className="text-base font-bold text-black">Export Review Report</h2>
            <p className="text-xs text-black/50 mt-0.5">
              Pick a region to preview one report, or export every region at once ({reviewRegions.length} region{reviewRegions.length !== 1 ? "s" : ""} with review rows).
            </p>
          </div>
          <button onClick={onClose} className="text-black/40 hover:text-black transition-colors text-lg leading-none">✕</button>
        </div>

        {/* Bulk export — all regions */}
        {reviewRegions.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 px-6 py-3 bg-black/2 border-b border-black/8">
            <span className="text-xs font-medium text-black/50 mr-1">Export all regions:</span>
            <button
              onClick={handleExportSeparate}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-all"
            >
              Separate files ({reviewRegions.length})
            </button>
            <button
              onClick={handleExportCombined}
              className="px-3 py-1.5 text-xs font-semibold rounded-lg border border-amber-300 text-amber-700 bg-amber-50 hover:bg-amber-100 transition-all"
            >
              One combined file
            </button>
          </div>
        )}

        {/* Region selector */}
        <div className="px-6 py-4 border-b border-black/8">
          <label className="block text-sm font-semibold text-black mb-2">Region</label>
          {reviewRegions.length === 0 ? (
            <p className="text-sm text-black/40">No review rows to export.</p>
          ) : (
            <div className="flex flex-wrap gap-2">
              {reviewRegions.map((r) => (
                <button
                  key={r}
                  onClick={() => setExportRegion(r)}
                  className={`px-4 py-1.5 rounded-lg text-sm font-medium border transition-all ${
                    exportRegion === r
                      ? "bg-black text-white border-black"
                      : "text-black border-black/15 hover:border-black/40"
                  }`}
                >
                  {r}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-auto px-6 py-4">
          {!exportRegion ? (
            <p className="text-sm text-black/30 text-center py-8">Select a region above to preview the report</p>
          ) : previewRows.length === 0 ? (
            <p className="text-sm text-black/30 text-center py-8">No mismatches to export for {exportRegion}</p>
          ) : (
            <>
              <p className="text-xs text-black/50 mb-3">
                <span className="font-semibold text-black">{exportRows.length}</span> people ·{" "}
                <span className="font-semibold text-black">{previewRows.length}</span> mismatch{previewRows.length !== 1 ? "es" : ""} — this is what the reviewer will see:
              </p>
              <div className="rounded-xl border border-black/10 overflow-hidden">
                <table className="w-full text-xs">
                  <thead className="bg-black/5 border-b border-black/8">
                    <tr>
                      {["MF No.", "Ref", "Full Name", "Field", "Current", "New", "Decision"].map((h) => (
                        <th key={h} className="px-3 py-2 text-left font-semibold text-black uppercase tracking-wider text-xs">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-black/5">
                    {previewRows.map((row, i) => (
                      <tr key={i} className="hover:bg-black/2">
                        <td className="px-3 py-2 font-mono text-black">{row.mf}</td>
                        <td className="px-3 py-2 font-mono text-black/50">{row.ref || "—"}</td>
                        <td className="px-3 py-2 text-black">{row.name}</td>
                        <td className="px-3 py-2 text-black/60">{row.field}</td>
                        <td className="px-3 py-2 text-black">{row.old || <span className="text-black/30">—</span>}</td>
                        <td className="px-3 py-2 text-black">{row.next || <span className="text-black/30">—</span>}</td>
                        <td className="px-3 py-2">
                          <span className="text-black/25 italic">Current / New</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <p className="text-xs text-black/40 mt-2">Three hidden columns (_mfNumber, _refNo, _field) are included for re-import. Do not delete rows.</p>
            </>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-black/8">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-black/15 rounded-xl text-black hover:bg-black/5 transition-all">Cancel</button>
          <button
            onClick={handleExport}
            disabled={!exportRegion || previewRows.length === 0}
            className="px-4 py-2 text-sm bg-amber-500 text-white rounded-xl font-semibold hover:bg-amber-600 disabled:opacity-40 transition-all"
          >
            Download {exportRegion ? `${exportRegion} ` : ""}report
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PreviewTable({
  results, selected, onToggle, onSelectAll,
  onPushClean, cleanPushing,
  onRemoveRows, onPushRow, rowPushing,
  fieldOverrides, onFieldOverride,
}) {
  const [filterName,     setFilterName]     = useState("");
  const [filterMF,       setFilterMF]       = useState("");
  const [filterEmail,    setFilterEmail]    = useState("");
  const [filterStatuses, setFilterStatuses] = useState(new Set());
  const [filterRegions,  setFilterRegions]  = useState(new Set());
  const [sortCol,        setSortCol]        = useState(null);
  const [sortDir,        setSortDir]        = useState("asc");
  const [showExportModal, setShowExportModal] = useState(false);

  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  const filtered = useMemo(() => {
    let rows = results;
    if (filterName)              rows = rows.filter((r) => (r.outputRow[MASTER_COLS.FULL_NAME] ?? "").toLowerCase().includes(filterName.toLowerCase()));
    if (filterMF)                rows = rows.filter((r) => (r.outputRow[MASTER_COLS.MF_NUMBER] ?? "").toLowerCase().includes(filterMF.toLowerCase()));
    if (filterEmail)             rows = rows.filter((r) => (r.outputRow[MASTER_COLS.EMAIL] ?? "").toLowerCase().includes(filterEmail.toLowerCase()));
    if (filterStatuses.size > 0) rows = rows.filter((r) => filterStatuses.has(r.matchType));
    if (filterRegions.size > 0)  rows = rows.filter((r) => filterRegions.has(r.outputRow[MASTER_COLS.REGION] ?? ""));

    if (sortCol) {
      rows = [...rows].sort((a, b) => {
        const get = (r) => {
          if (sortCol === "name")   return r.outputRow[MASTER_COLS.FULL_NAME] ?? "";
          if (sortCol === "mf")     return r.outputRow[MASTER_COLS.MF_NUMBER] ?? "";
          if (sortCol === "region") return r.outputRow[MASTER_COLS.REGION] ?? "";
          if (sortCol === "email")   return r.outputRow[MASTER_COLS.EMAIL] ?? "";
          if (sortCol === "service") return r.outputRow[MASTER_COLS.SERVICE] ?? "";
          if (sortCol === "pledge")  return parseFloat(r.outputRow[MASTER_COLS.PLEDGE_AMOUNT]) || 0;
          if (sortCol === "status") return r.matchType ?? "";
          return "";
        };
        const va = get(a), vb = get(b);
        if (typeof va === "number") return sortDir === "asc" ? va - vb : vb - va;
        return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
    } else {
      // Default: sort by region A→Z, then by status priority (update → new → review → error)
      rows = [...rows].sort((a, b) => {
        const ra = a.outputRow[MASTER_COLS.REGION] ?? "";
        const rb = b.outputRow[MASTER_COLS.REGION] ?? "";
        if (ra !== rb) return ra.localeCompare(rb);
        return (STATUS_PRIORITY[a.matchType] ?? 99) - (STATUS_PRIORITY[b.matchType] ?? 99);
      });
    }
    return rows;
  }, [results, filterName, filterMF, filterEmail, filterStatuses, filterRegions, sortCol, sortDir]);

  const counts = {
    update: results.filter((r) => r.matchType === "update").length,
    review: results.filter((r) => r.matchType === "review").length,
    new:    results.filter((r) => r.matchType === "new").length,
    error:  results.filter((r) => r.matchType === "error").length,
  };

  const hasFilters = filterName || filterMF || filterEmail || filterStatuses.size > 0 || filterRegions.size > 0;

  const allFilteredSelected  = filtered.length > 0 && filtered.every((r) => selected.has(r.pabblyIndex));
  const someFilteredSelected = filtered.some((r) => selected.has(r.pabblyIndex)) && !allFilteredSelected;

  function handleSelectAll() {
    onSelectAll(filtered.map((r) => r.pabblyIndex), !allFilteredSelected);
  }

  function clearFilters() {
    setFilterName(""); setFilterMF(""); setFilterEmail("");
    setFilterStatuses(new Set()); setFilterRegions(new Set());
  }

  const filteredCleanUpdate = filtered.filter((r) => r.matchType === "update");
  const filteredCleanNew    = filtered.filter(
    (r) => r.matchType === "new" && !r.hasErrors && !r.errors.some((e) => e.severity === "warning")
  );
  const filteredErrors = filtered.filter((r) => r.matchType === "error");
  const hasReviewRows  = results.some((r) => r.matchType === "review");

  return (
    <>
      {showExportModal && <ExportModal results={results} onClose={() => setShowExportModal(false)} />}

      <div className="flex flex-col h-full">
        {/* Summary bar */}
        <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-black/8 shrink-0">
          {/* Counts */}
          <span className="text-sm font-semibold text-black">{results.length} rows</span>
          <span className="text-black/20">·</span>
          <span className="text-sm text-black"><span className="font-semibold text-emerald-700">{counts.update}</span> clean</span>
          {counts.review > 0 && <span className="text-sm text-black"><span className="font-semibold text-amber-600">{counts.review}</span> review</span>}
          <span className="text-sm text-black"><span className="font-semibold text-violet-700">{counts.new}</span> new</span>
          {counts.error > 0 && <span className="text-sm text-black"><span className="font-semibold text-red-600">{counts.error}</span> errors</span>}
          {hasFilters && (
            <>
              <span className="text-sm text-black/50">— {filtered.length} shown</span>
              <button onClick={clearFilters} className="text-xs text-black underline">Clear</button>
            </>
          )}

          {/* Action buttons */}
          <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
            {/* Dismiss error rows — red fill */}
            {filteredErrors.length > 0 && (
              <button
                onClick={() => onRemoveRows(filteredErrors)}
                className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 shadow-sm hover:shadow transition-all border border-red-700"
              >
                Dismiss {filteredErrors.length} error{filteredErrors.length !== 1 ? "s" : ""}{hasFilters ? " (filtered)" : ""}
              </button>
            )}

            {/* Export review report — amber fill, always visible when review rows exist */}
            {hasReviewRows && (
              <button
                onClick={() => setShowExportModal(true)}
                className="px-3 py-1.5 text-xs bg-amber-500 text-white rounded-lg font-semibold hover:bg-amber-600 shadow-sm hover:shadow transition-all border border-amber-600"
              >
                Export review report
              </button>
            )}

            {/* Add new rows — violet fill */}
            {filteredCleanNew.length > 0 && (
              <button
                onClick={() => onPushClean(filteredCleanNew)}
                disabled={cleanPushing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-violet-600 text-white rounded-lg font-semibold hover:bg-violet-700 disabled:opacity-40 shadow-sm hover:shadow transition-all border border-violet-700"
              >
                {cleanPushing && (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {cleanPushing ? "Adding…" : `Add ${filteredCleanNew.length} new${hasFilters ? " (filtered)" : ""}`}
              </button>
            )}

            {/* Update existing rows with no issues — green fill */}
            {filteredCleanUpdate.length > 0 && (
              <button
                onClick={() => onPushClean(filteredCleanUpdate)}
                disabled={cleanPushing}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-40 shadow-sm hover:shadow transition-all border border-emerald-700"
              >
                {cleanPushing && (
                  <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                  </svg>
                )}
                {cleanPushing ? "Updating…" : `Update ${filteredCleanUpdate.length} clean${hasFilters ? " (filtered)" : ""}`}
              </button>
            )}

            <span className="text-sm text-black pl-1 border-l border-black/10">
              <span className="font-semibold">{selected.size}</span> selected
            </span>
          </div>
        </div>

        {/* Scrollable table */}
        <div className="overflow-auto flex-1 min-h-0">
          <table className="w-full text-xs border-collapse" style={{ minWidth: 1100 }}>
            <thead className="sticky top-0 z-10 bg-black">
              <tr>
                <th className="px-4 py-2 w-10 text-left align-middle">
                  <input
                    type="checkbox"
                    checked={allFilteredSelected}
                    ref={(el) => { if (el) el.indeterminate = someFilteredSelected; }}
                    onChange={handleSelectAll}
                    className="rounded border-white/30 accent-white"
                    title={allFilteredSelected ? "Deselect all" : "Select all"}
                  />
                </th>
                <th className="px-4 py-2 w-28 text-left align-middle"><SortBtn col="status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Status</SortBtn></th>
                <th className="px-4 py-2 w-32 text-left align-middle"><SortBtn col="mf"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>MF No.</SortBtn></th>
                <th className="px-4 py-2 w-44 text-left align-middle"><SortBtn col="name"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Full Name</SortBtn></th>
                <th className="px-4 py-2 w-28 text-left align-middle"><SortBtn col="region" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Region</SortBtn></th>
                <th className="px-4 py-2 w-24 text-left align-middle"><span className="font-bold text-white uppercase tracking-wider text-xs">NRIC</span></th>
                <th className="px-4 py-2 w-28 text-left align-middle"><span className="font-bold text-white uppercase tracking-wider text-xs">Contact</span></th>
                <th className="px-4 py-2 w-52 text-left align-middle"><SortBtn col="email"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Email</SortBtn></th>
                <th className="px-4 py-2 w-28 text-left align-middle"><SortBtn col="service" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Service</SortBtn></th>
                <th className="px-4 py-2 w-28 text-left align-middle"><SortBtn col="pledge" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Pledge</SortBtn></th>
                <th className="px-4 py-2 w-40 text-left align-middle"><span className="font-bold text-white uppercase tracking-wider text-xs">Issues</span></th>
                <th className="px-3 py-2 w-20 text-left align-middle"><span className="font-bold text-white uppercase tracking-wider text-xs">Actions</span></th>
              </tr>
              <tr className="border-b border-white/10">
                <td className="px-4 pb-2"></td>
                <td className="px-4 pb-2"><CheckboxFilter options={STATUS_OPTIONS} selected={filterStatuses} onChange={setFilterStatuses} placeholder="All statuses" /></td>
                <td className="px-4 pb-2"><FilterInput placeholder="Search…" value={filterMF} onChange={setFilterMF} /></td>
                <td className="px-4 pb-2"><FilterInput placeholder="Search…" value={filterName} onChange={setFilterName} /></td>
                <td className="px-4 pb-2"><CheckboxFilter options={REGION_OPTIONS} selected={filterRegions} onChange={setFilterRegions} placeholder="All regions" /></td>
                <td className="px-4 pb-2"></td>
                <td className="px-4 pb-2"></td>
                <td className="px-4 pb-2"><FilterInput placeholder="Search…" value={filterEmail} onChange={setFilterEmail} /></td>
                <td className="px-4 pb-2"></td>
                <td className="px-4 pb-2"></td>
                <td className="px-4 pb-2"></td>
                <td className="px-3 pb-2"></td>
              </tr>
            </thead>

            <tbody className="divide-y divide-black/5">
              {filtered.length === 0 && (
                <tr><td colSpan={12} className="px-4 py-12 text-center text-sm text-black/30">No rows match your filters</td></tr>
              )}
              {filtered.map((result) => {
                const { matchType, errors } = result;
                const isChecked    = selected.has(result.pabblyIndex);
                const meta         = STATUS_META[matchType] ?? STATUS_META.error;
                const pledgeVal    = (result.outputRow[MASTER_COLS.PLEDGE_AMOUNT] ?? "").trim();
                const masterPledge = result.masterRow ? (result.masterRow[MASTER_COLS.PLEDGE_AMOUNT] ?? "").trim() : null;
                const isAdd        = result.pabblyRow.isAdditional;

                return (
                  <tr key={result.pabblyIndex} className={`${meta.rowBg} hover:brightness-95 transition-all`}>
                    <td className="px-4 py-3">
                      <input type="checkbox" checked={isChecked} onChange={() => onToggle(result.pabblyIndex)} className="rounded border-black/20 accent-black" />
                    </td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${meta.badgeCls}`}>{meta.label}</span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-black">
                      <EditableInput
                        mono
                        value={fieldOverrideVal(fieldOverrides, result.pabblyIndex, MASTER_COLS.MF_NUMBER, result.outputRow[MASTER_COLS.MF_NUMBER])}
                        onChange={(v) => onFieldOverride(result.pabblyIndex, MASTER_COLS.MF_NUMBER, v)}
                      />
                    </td>
                    <EndCell result={result} colIndex={MASTER_COLS.FULL_NAME}      fieldOverrides={fieldOverrides} onFieldOverride={onFieldOverride} />
                    <EndCell result={result} colIndex={MASTER_COLS.REGION}         fieldOverrides={fieldOverrides} onFieldOverride={onFieldOverride} />
                    <EndCell result={result} colIndex={MASTER_COLS.PARTIAL_NRIC}   fieldOverrides={fieldOverrides} onFieldOverride={onFieldOverride} mono />
                    <EndCell result={result} colIndex={MASTER_COLS.CONTACT_NUMBER} fieldOverrides={fieldOverrides} onFieldOverride={onFieldOverride} />
                    <EndCell result={result} colIndex={MASTER_COLS.EMAIL}          fieldOverrides={fieldOverrides} onFieldOverride={onFieldOverride} />
                    <td className="px-4 py-3 text-xs">
                      <EditableInput
                        value={fieldOverrideVal(fieldOverrides, result.pabblyIndex, MASTER_COLS.SERVICE, result.outputRow[MASTER_COLS.SERVICE])}
                        onChange={(v) => onFieldOverride(result.pabblyIndex, MASTER_COLS.SERVICE, v)}
                      />
                    </td>
                    <td className="px-4 py-3 font-mono text-xs">
                      {isAdd && masterPledge && (
                        <span className="block leading-none mb-0.5 text-black/30 line-through">{masterPledge}</span>
                      )}
                      <EditableInput
                        mono
                        value={fieldOverrideVal(fieldOverrides, result.pabblyIndex, MASTER_COLS.PLEDGE_AMOUNT, pledgeVal)}
                        onChange={(v) => onFieldOverride(result.pabblyIndex, MASTER_COLS.PLEDGE_AMOUNT, v)}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex flex-col gap-1">
                        {errors.length === 0
                          ? <span className="text-black/30 text-xs">—</span>
                          : errors.map((e, j) => <ErrorBadge key={j} code={e.code} message={e.message} severity={e.severity} />)}
                      </div>
                    </td>
                    <td className="px-3 py-3">
                      <div className="flex items-center gap-1">
                        {/* Push this row */}
                        {matchType !== "error" && (
                          <button
                            onClick={() => onPushRow(result)}
                            disabled={rowPushing || cleanPushing}
                            title={matchType === "new" ? "Add this row to master sheet" : "Update this row in master sheet"}
                            className={`p-1.5 rounded-lg border transition-all disabled:opacity-30 ${
                              matchType === "new"
                                ? "text-violet-600 border-violet-200 hover:bg-violet-50"
                                : matchType === "review"
                                ? "text-amber-600 border-amber-200 hover:bg-amber-50"
                                : "text-emerald-600 border-emerald-200 hover:bg-emerald-50"
                            }`}
                          >
                            <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                            </svg>
                          </button>
                        )}
                        {/* Dismiss this row */}
                        <button
                          onClick={() => onRemoveRows([result])}
                          title="Remove from queue"
                          className="p-1.5 rounded-lg border border-black/10 text-black/30 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
