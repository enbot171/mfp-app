"use client";
import { useState, useMemo, useRef, useEffect } from "react";
import ErrorBadge from "./ErrorBadge";

const STATUS_META = {
  matched: { label: "Matched", badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200", rowBg: "" },
  error:   { label: "Error",   badgeCls: "bg-red-50 text-red-700 border-red-200",             rowBg: "bg-red-50/60" },
};

const STATUS_PRIORITY = { matched: 0, error: 1 };

const STATUS_OPTIONS = [
  { value: "matched", label: "Matched" },
  { value: "error",   label: "Error" },
];

// Inline input that holds its own text and commits on blur / Enter (so the page
// only re-matches + saves once per edit, not on every keystroke).
function CommitInput({ value, onCommit, mono = false, align = "left" }) {
  const [text, setText] = useState(String(value ?? ""));
  useEffect(() => { setText(String(value ?? "")); }, [value]);
  return (
    <input
      type="text"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={() => { if (text !== String(value ?? "")) onCommit(text); }}
      onKeyDown={(e) => { if (e.key === "Enter") e.target.blur(); }}
      className={`w-full bg-transparent border border-transparent hover:border-line focus:border-ink/25 focus:bg-surface rounded-md px-1.5 py-1 text-xs text-ink outline-none transition-all ${mono ? "font-mono" : ""} ${align === "right" ? "text-right" : ""}`}
    />
  );
}

function formatDate(date) {
  if (!date) return "—";
  return new Date(date).toLocaleDateString("en-SG", {
    day: "numeric", month: "short", year: "numeric", timeZone: "UTC",
  });
}

function AmountCell({ current, next, pledge }) {
  const hasExisting = current > 0;
  const fullPay     = pledge > 0 && next >= pledge;
  return (
    <div className="flex flex-col gap-0.5 font-mono text-xs">
      {hasExisting && (
        <span className="text-faint text-[10px]">Previous {current.toFixed(2)}</span>
      )}
      <span className={fullPay ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
        {next.toFixed(2)}
      </span>
      {pledge > 0 && (
        <span className="text-faint text-[10px]">Pledge {pledge.toFixed(2)} · {fullPay ? "Full" : "Partial"}</span>
      )}
    </div>
  );
}

// ─── Header helpers (shared style with the pledge preview) ─────────────────────

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
      className="w-full px-2 py-1 text-xs border border-white/20 rounded-lg text-ink placeholder:text-faint/70 focus:outline-none focus:ring-1 focus:ring-white/30 bg-surface font-normal normal-case tracking-normal"
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
        className="w-full flex items-center justify-between gap-1 px-2 py-1 text-xs border border-white/20 rounded-lg bg-surface text-ink font-normal overflow-hidden"
      >
        <span className={`truncate ${selected.size === 0 ? "text-faint" : "text-ink"}`}>{summary}</span>
        <span className="text-faint shrink-0">▾</span>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 bg-surface border border-line rounded-lg shadow-lg z-30 min-w-32.5 max-h-60 overflow-auto">
          {options.length === 0 && <div className="px-3 py-1.5 text-xs text-faint/70">None</div>}
          {options.map((opt) => (
            <label key={opt.value} className="flex items-center gap-2 px-3 py-1.5 hover:bg-panel cursor-pointer select-none">
              <input type="checkbox" checked={selected.has(opt.value)} onChange={() => toggle(opt.value)} className="rounded accent-accent" />
              <span className="text-xs text-ink whitespace-nowrap">{opt.label}</span>
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function PaymentPreviewTable({
  results,
  selected,
  onToggle,
  onSelectAll,
  onPushSelected,
  onDismissRow,
  onDismissRows,
  onEditRow,
  pushing,
  pushMsg,
  pushError,
  duplicateCount,
  formatSummary,   // [{ sheetName, formatLabel, count, dateRange }]
  canRevert,
  onRevert,
  reverting,
  revertMsg,
  revertError,
  onAddMissingMonths,
}) {
  const [filterStatuses, setFilterStatuses] = useState(new Set());
  const [filterSources,  setFilterSources]  = useState(new Set());
  const [filterMonths,   setFilterMonths]   = useState(new Set());
  const [filterMF,       setFilterMF]       = useState("");
  const [filterName,     setFilterName]     = useState("");
  const [sortCol,        setSortCol]        = useState(null);
  const [sortDir,        setSortDir]        = useState("asc");

  function handleSort(col) {
    if (sortCol === col) setSortDir((d) => d === "asc" ? "desc" : "asc");
    else { setSortCol(col); setSortDir("asc"); }
  }

  const visible = results.filter((r) => !r.isDuplicate);

  // Filter option lists derived from the data
  const sourceOptions = useMemo(
    () => [...new Set(visible.map((r) => r.sheetName).filter(Boolean))].map((s) => ({ value: s, label: s })),
    [visible]
  );
  const monthOptions = useMemo(
    () => [...new Set(visible.map((r) => r.month).filter(Boolean))].map((m) => ({ value: m, label: m })),
    [visible]
  );

  const filtered = useMemo(() => {
    let rows = visible;
    if (filterStatuses.size > 0) rows = rows.filter((r) => filterStatuses.has(r.matchType));
    if (filterSources.size > 0)  rows = rows.filter((r) => filterSources.has(r.sheetName));
    if (filterMonths.size > 0)   rows = rows.filter((r) => filterMonths.has(r.month));
    if (filterMF)                rows = rows.filter((r) => (r.mfNumber ?? "").toLowerCase().includes(filterMF.toLowerCase()));
    if (filterName)              rows = rows.filter((r) => (r.name ?? "").toLowerCase().includes(filterName.toLowerCase()));

    if (sortCol) {
      rows = [...rows].sort((a, b) => {
        const get = (r) => {
          if (sortCol === "status") return r.matchType ?? "";
          if (sortCol === "source") return r.sheetName ?? "";
          if (sortCol === "mf")     return r.mfNumber ?? "";
          if (sortCol === "name")   return r.name ?? "";
          if (sortCol === "date")   return r.date ? new Date(r.date).getTime() : 0;
          if (sortCol === "month")  return r.month ?? "";
          if (sortCol === "amount") return r.amount ?? 0;
          return "";
        };
        const va = get(a), vb = get(b);
        if (typeof va === "number") return sortDir === "asc" ? va - vb : vb - va;
        return sortDir === "asc" ? String(va).localeCompare(String(vb)) : String(vb).localeCompare(String(va));
      });
    } else {
      // Default: source A→Z, then matched before error
      rows = [...rows].sort((a, b) => {
        const sa = a.sheetName ?? "", sb = b.sheetName ?? "";
        if (sa !== sb) return sa.localeCompare(sb);
        return (STATUS_PRIORITY[a.matchType] ?? 99) - (STATUS_PRIORITY[b.matchType] ?? 99);
      });
    }
    return rows;
  }, [visible, filterStatuses, filterSources, filterMonths, filterMF, filterName, sortCol, sortDir]);

  const matched = visible.filter((r) => r.matchType === "matched");
  const errors  = visible.filter((r) => r.matchType === "error");

  const hasFilters = filterStatuses.size > 0 || filterSources.size > 0 || filterMonths.size > 0 || filterMF || filterName;

  const filteredMatched = filtered.filter((r) => r.matchType === "matched");
  const filteredErrors  = filtered.filter((r) => r.matchType === "error");

  // Select-all targets the matched rows in view (errors aren't selectable)
  const allSelected  = filteredMatched.length > 0 && filteredMatched.every((r) => selected.has(r.rowIndex));
  const someSelected = filteredMatched.some((r) => selected.has(r.rowIndex)) && !allSelected;
  const selectedMatchedCount = [...selected].filter(
    (idx) => results.find((r) => r.rowIndex === idx)?.matchType === "matched"
  ).length;

  // Date range banners — only for sheets that have a dateRange
  const dateRangeBanners = (formatSummary ?? []).filter((f) => f.dateRange);

  // Months that exist in error rows but have no column in the master sheet
  const missingMonths = [...new Set(
    results
      .filter((r) => r.errors?.some((e) => e.code === "NO_MONTH_COL") && r.month)
      .map((r) => r.month)
  )];

  function handleSelectAll() {
    onSelectAll(filteredMatched.map((r) => r.rowIndex), !allSelected);
  }

  function clearFilters() {
    setFilterStatuses(new Set()); setFilterSources(new Set()); setFilterMonths(new Set());
    setFilterMF(""); setFilterName("");
  }

  function dismissRows(rows) {
    if (onDismissRows) onDismissRows(rows);
    else rows.forEach((r) => onDismissRow(r));
  }

  return (
    <div className="flex flex-col h-full">
      {/* Date range banners */}
      {dateRangeBanners.length > 0 && (
        <div className="flex flex-wrap gap-2 px-4 pt-3 pb-1 shrink-0">
          {dateRangeBanners.map((f) => (
            <div key={f.sheetName} className="flex items-center gap-1.5 px-3 py-1 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800">
              <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
              </svg>
              <span className="font-semibold">{f.sheetName}</span>
              <span className="text-amber-600">{f.dateRange}</span>
            </div>
          ))}
        </div>
      )}

      {/* Missing month columns banner */}
      {missingMonths.length > 0 && onAddMissingMonths && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-orange-50 border-b border-orange-200 shrink-0">
          <svg className="w-4 h-4 text-orange-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <p className="text-sm text-orange-800 flex-1">
            Master sheet is missing column{missingMonths.length !== 1 ? "s" : ""}:{" "}
            <span className="font-semibold font-mono">{missingMonths.join(", ")}</span>
            {" "}— these transactions cannot be pushed until the columns exist.
          </p>
          <button
            onClick={() => onAddMissingMonths(missingMonths)}
            className="shrink-0 px-3 py-1.5 text-xs font-semibold bg-orange-500 text-white rounded-lg hover:bg-orange-600 transition-colors"
          >
            Add column{missingMonths.length !== 1 ? "s" : ""} to master sheet
          </button>
        </div>
      )}

      {/* Summary bar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2.5 border-b border-line shrink-0">
        <span className="text-sm font-semibold text-ink">{visible.length} rows</span>
        <span className="text-faint/55">·</span>
        <span className="text-sm text-ink"><span className="font-semibold text-emerald-700">{matched.length}</span> matched</span>
        {errors.length > 0 && (
          <span className="text-sm text-ink"><span className="font-semibold text-red-600">{errors.length}</span> error{errors.length !== 1 ? "s" : ""}</span>
        )}
        {duplicateCount > 0 && (
          <span className="text-sm text-faint">{duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""} skipped</span>
        )}
        {hasFilters && (
          <>
            <span className="text-sm text-muted">— {filtered.length} shown</span>
            <button onClick={clearFilters} className="text-xs text-ink underline">Clear</button>
          </>
        )}

        {/* Action buttons */}
        <div className="ml-auto flex items-center gap-2 flex-wrap justify-end">
          {revertMsg && <span className="text-xs text-blue-600 font-medium">{revertMsg}</span>}
          {pushMsg   && <span className="text-xs text-emerald-700 font-medium">{pushMsg}</span>}

          {/* Dismiss error rows */}
          {filteredErrors.length > 0 && (
            <button
              onClick={() => dismissRows(filteredErrors)}
              className="px-3 py-1.5 text-xs bg-red-600 text-white rounded-lg font-semibold hover:bg-red-700 shadow-sm hover:shadow transition-all border border-red-700"
            >
              Dismiss {filteredErrors.length} error{filteredErrors.length !== 1 ? "s" : ""}{hasFilters ? " (filtered)" : ""}
            </button>
          )}

          {/* Push all matched in view */}
          {filteredMatched.length > 0 && (
            <button
              onClick={() => onPushSelected(filteredMatched)}
              disabled={pushing}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-emerald-600 text-white rounded-lg font-semibold hover:bg-emerald-700 disabled:opacity-40 shadow-sm hover:shadow transition-all border border-emerald-700"
            >
              {pushing && (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              {pushing ? "Pushing…" : `Push ${filteredMatched.length} matched${hasFilters ? " (filtered)" : ""}`}
            </button>
          )}

          {/* Revert last push */}
          {canRevert && (
            <button
              onClick={onRevert}
              disabled={reverting}
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-surface border border-ink/15 rounded-lg text-ink/80 font-medium hover:border-red-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 transition-all"
            >
              {reverting && (
                <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              {reverting ? "Reverting…" : "Revert last push"}
            </button>
          )}

          <span className="text-sm text-ink pl-1 border-l border-line">
            <span className="font-semibold">{selectedMatchedCount}</span> selected
          </span>

          {/* Push selected */}
          <button
            onClick={() => {
              const rows = results.filter((r) => selected.has(r.rowIndex) && r.matchType === "matched");
              onPushSelected(rows);
            }}
            disabled={selectedMatchedCount === 0 || pushing}
            className="flex items-center gap-2 px-4 py-1.5 text-xs bg-ink text-white rounded-lg font-semibold hover:bg-ink/90 disabled:opacity-30 transition-all"
          >
            {pushing ? "Pushing…" : `Push ${selectedMatchedCount} selected`}
          </button>
        </div>
      </div>

      {/* Error banners */}
      {pushError && (
        <div className="mx-4 mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 shrink-0">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {pushError}
        </div>
      )}
      {revertError && (
        <div className="mx-4 mt-3 flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-600 shrink-0">
          <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          {revertError}
        </div>
      )}

      {/* Table */}
      <div className="overflow-auto flex-1 min-h-0">
        <table className="w-full text-xs border-collapse" style={{ minWidth: 1000 }}>
          <thead className="sticky top-0 z-10 bg-shell">
            <tr>
              <th className="px-4 py-2 w-10 text-left align-middle">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={handleSelectAll}
                  className="rounded border-white/30 accent-white"
                  title={allSelected ? "Deselect all" : "Select all matched"}
                />
              </th>
              <th className="px-4 py-2 w-24 text-left align-middle"><SortBtn col="status" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Status</SortBtn></th>
              <th className="px-4 py-2 w-36 text-left align-middle"><SortBtn col="source" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Source</SortBtn></th>
              <th className="px-4 py-2 w-28 text-left align-middle"><SortBtn col="mf"     sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>MF No.</SortBtn></th>
              <th className="px-4 py-2 w-44 text-left align-middle"><SortBtn col="name"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Name</SortBtn></th>
              <th className="px-4 py-2 w-28 text-left align-middle"><SortBtn col="date"   sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Date</SortBtn></th>
              <th className="px-4 py-2 w-16 text-left align-middle"><SortBtn col="month"  sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Month</SortBtn></th>
              <th className="px-4 py-2 w-24 text-left align-middle"><SortBtn col="amount" sortCol={sortCol} sortDir={sortDir} onSort={handleSort}>Amount</SortBtn></th>
              <th className="px-4 py-2 w-36 text-left align-middle"><span className="font-bold text-white uppercase tracking-wider text-xs">New Total</span></th>
              <th className="px-4 py-2 text-left align-middle"><span className="font-bold text-white uppercase tracking-wider text-xs">Issues</span></th>
              <th className="px-3 py-2 w-16 text-left align-middle"><span className="font-bold text-white uppercase tracking-wider text-xs">Actions</span></th>
            </tr>
            <tr className="border-b border-white/10">
              <td className="px-4 pb-2"></td>
              <td className="px-4 pb-2"><CheckboxFilter options={STATUS_OPTIONS} selected={filterStatuses} onChange={setFilterStatuses} placeholder="All" /></td>
              <td className="px-4 pb-2"><CheckboxFilter options={sourceOptions} selected={filterSources} onChange={setFilterSources} placeholder="All sources" /></td>
              <td className="px-4 pb-2"><FilterInput placeholder="Search…" value={filterMF} onChange={setFilterMF} /></td>
              <td className="px-4 pb-2"><FilterInput placeholder="Search…" value={filterName} onChange={setFilterName} /></td>
              <td className="px-4 pb-2"></td>
              <td className="px-4 pb-2"><CheckboxFilter options={monthOptions} selected={filterMonths} onChange={setFilterMonths} placeholder="All" /></td>
              <td className="px-4 pb-2"></td>
              <td className="px-4 pb-2"></td>
              <td className="px-4 pb-2"></td>
              <td className="px-3 pb-2"></td>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-sm text-faint/70">
                  {hasFilters ? "No rows match your filters" : "No rows to show"}
                </td>
              </tr>
            )}
            {filtered.map((result) => {
              const meta          = STATUS_META[result.matchType] ?? STATUS_META.error;
              const isChecked     = selected.has(result.rowIndex);
              const visibleErrors = result.errors.filter((e) => e.severity !== "info");

              return (
                <tr key={result.rowIndex} className={`${meta.rowBg} ${isChecked ? "shadow-[inset_3px_0_0_var(--color-accent)]" : ""} hover:brightness-[0.98] transition-colors`}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggle(result.rowIndex)}
                      disabled={result.matchType !== "matched"}
                      className="rounded border-ink/15 accent-accent disabled:opacity-30"
                    />
                  </td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-md text-xs font-semibold border ${meta.badgeCls}`}>
                      {meta.label}
                    </span>
                    {result.mfAutoCorrected && (
                      <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100">
                        auto
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted text-xs">
                    {result.sheetName || <span className="text-faint/55">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-ink">
                    {result.mfNumber || <span className="text-faint/70">—</span>}
                  </td>
                  <td className="px-4 py-3 text-ink">
                    {result.name
                      ? result.name
                      : result.description
                        ? <span className="text-muted" title={result.description}>{result.description}</span>
                        : <span className="text-faint/70">—</span>}
                  </td>
                  <td className="px-4 py-3 text-ink/80">
                    {formatDate(result.date)}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-ink">
                    <CommitInput
                      mono
                      value={result.month ?? ""}
                      onCommit={(v) => onEditRow(result.rowIndex, { month: v.trim().toUpperCase() })}
                    />
                  </td>
                  <td className="px-4 py-3 font-mono text-ink">
                    <CommitInput
                      mono
                      align="right"
                      value={Number(result.amount).toFixed(2)}
                      onCommit={(v) => onEditRow(result.rowIndex, { amount: parseFloat(v) || 0 })}
                    />
                  </td>
                  <td className="px-4 py-3">
                    {result.matchType === "matched" ? (
                      <AmountCell
                        current={result.currentAmount}
                        next={result.newAmount}
                        pledge={result.pledgeAmount}
                      />
                    ) : (
                      <span className="text-faint/70">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {visibleErrors.length === 0 ? (
                      <span className="text-faint/70">—</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {visibleErrors.map((e, j) => (
                          <ErrorBadge key={j} code={e.code} message={e.message} severity={e.severity} />
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <div className="flex items-center gap-1">
                      {/* Push this row */}
                      {result.matchType === "matched" && (
                        <button
                          onClick={() => onPushSelected([result])}
                          disabled={pushing}
                          title="Push this payment to master sheet"
                          className="p-1.5 rounded-lg border border-emerald-200 text-emerald-600 hover:bg-emerald-50 disabled:opacity-30 transition-all"
                        >
                          <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                          </svg>
                        </button>
                      )}
                      {/* Dismiss this row */}
                      <button
                        onClick={() => onDismissRow(result)}
                        title="Dismiss this row"
                        className="p-1.5 rounded-lg border border-line text-faint/70 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all"
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
  );
}
