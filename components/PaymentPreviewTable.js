"use client";
import { useState } from "react";
import ErrorBadge from "./ErrorBadge";

const STATUS_META = {
  matched: { label: "Matched", badgeCls: "bg-emerald-50 text-emerald-700 border-emerald-200", rowBg: "" },
  error:   { label: "Error",   badgeCls: "bg-red-50 text-red-700 border-red-200",             rowBg: "bg-red-50/60" },
};

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
        <span className="text-black/30 line-through">{current.toFixed(2)}</span>
      )}
      <span className={fullPay ? "text-emerald-700 font-semibold" : "text-amber-700 font-semibold"}>
        {next.toFixed(2)}
      </span>
      {pledge > 0 && (
        <span className="text-black/30 text-[10px]">pledge {pledge.toFixed(2)}</span>
      )}
    </div>
  );
}

export default function PaymentPreviewTable({
  results,
  selected,
  onToggle,
  onSelectAll,
  onPushSelected,
  onDismissRow,
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
  const [filterStatus, setFilterStatus] = useState("all"); // "all" | "matched" | "error"

  const visible  = results.filter((r) => !r.isDuplicate);
  const matched  = visible.filter((r) => r.matchType === "matched");
  const errors   = visible.filter((r) => r.matchType === "error");
  const filtered = filterStatus === "matched" ? matched : filterStatus === "error" ? errors : visible;

  const allSelected  = filtered.length > 0 && filtered.every((r) => selected.has(r.rowIndex));
  const someSelected = filtered.some((r) => selected.has(r.rowIndex)) && !allSelected;
  const selectedMatchedCount = [...selected].filter(
    (idx) => results.find((r) => r.rowIndex === idx)?.matchType === "matched"
  ).length;

  // Date range banners — only for sheets that have a dateRange (fix 3)
  const dateRangeBanners = (formatSummary ?? []).filter((f) => f.dateRange);

  // Months that exist in error rows but have no column in the master sheet
  const missingMonths = [...new Set(
    results
      .filter((r) => r.errors?.some((e) => e.code === "NO_MONTH_COL") && r.month)
      .map((r) => r.month)
  )];

  function handleSelectAll() {
    onSelectAll(filtered.map((r) => r.rowIndex), !allSelected);
  }

  return (
    <div className="flex flex-col h-full">
      {/* Date range banners (fix 3) */}
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
      <div className="flex flex-wrap items-center gap-3 px-4 py-2.5 border-b border-black/8 shrink-0">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold text-black">{visible.length} rows</span>
          <span className="text-black/20">·</span>
          <button
            onClick={() => setFilterStatus(filterStatus === "matched" ? "all" : "matched")}
            className={`font-semibold transition-colors ${filterStatus === "matched" ? "text-emerald-700 underline" : "text-emerald-700"}`}
          >
            {matched.length} matched
          </button>
          {errors.length > 0 && (
            <>
              <span className="text-black/20">·</span>
              <button
                onClick={() => setFilterStatus(filterStatus === "error" ? "all" : "error")}
                className={`font-semibold transition-colors ${filterStatus === "error" ? "text-red-600 underline" : "text-red-600"}`}
              >
                {errors.length} error{errors.length !== 1 ? "s" : ""}
              </button>
            </>
          )}
          {duplicateCount > 0 && (
            <>
              <span className="text-black/20">·</span>
              <span className="text-black/40">{duplicateCount} duplicate{duplicateCount !== 1 ? "s" : ""} skipped</span>
            </>
          )}
          {filterStatus !== "all" && (
            <button onClick={() => setFilterStatus("all")} className="text-xs text-black/40 underline">
              Show all
            </button>
          )}
        </div>

        {/* Sheet badges */}
        {(formatSummary ?? []).length > 0 && (
          <div className="flex flex-wrap gap-1">
            {formatSummary.map((f) => (
              <span key={f.sheetName} className="text-xs text-black/40 border border-black/10 rounded-lg px-2 py-0.5">
                {f.sheetName} ({f.count})
              </span>
            ))}
          </div>
        )}

        <div className="ml-auto flex items-center gap-2">
          {revertMsg && <span className="text-xs text-blue-600 font-medium">{revertMsg}</span>}
          {pushMsg   && <span className="text-xs text-emerald-700 font-medium">{pushMsg}</span>}

          {/* Revert last push button */}
          {canRevert && (
            <button
              onClick={onRevert}
              disabled={reverting}
              className="flex items-center gap-1.5 px-3 py-2 text-sm bg-white border border-black/20 rounded-xl text-black/70 font-medium hover:border-red-300 hover:text-red-600 hover:bg-red-50 disabled:opacity-30 transition-all"
            >
              {reverting && (
                <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
                </svg>
              )}
              {reverting ? "Reverting…" : "Revert last push"}
            </button>
          )}

          <button
            onClick={() => {
              const rows = results.filter((r) => selected.has(r.rowIndex) && r.matchType === "matched");
              onPushSelected(rows);
            }}
            disabled={selectedMatchedCount === 0 || pushing}
            className="flex items-center gap-2 px-4 py-2 text-sm bg-black text-white rounded-xl font-semibold hover:bg-black/80 disabled:opacity-30 transition-all"
          >
            {pushing && (
              <svg className="w-3.5 h-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
              </svg>
            )}
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
          <thead className="sticky top-0 z-10 bg-black">
            <tr>
              <th className="px-4 py-2 w-10 text-left align-middle">
                <input
                  type="checkbox"
                  checked={allSelected}
                  ref={(el) => { if (el) el.indeterminate = someSelected; }}
                  onChange={handleSelectAll}
                  className="rounded border-white/30 accent-white"
                />
              </th>
              <th className="px-4 py-2 w-24 text-left align-middle">
                <span className="font-bold text-white uppercase tracking-wider text-xs">Status</span>
              </th>
              <th className="px-4 py-2 w-36 text-left align-middle">
                <span className="font-bold text-white uppercase tracking-wider text-xs">Source</span>
              </th>
              <th className="px-4 py-2 w-28 text-left align-middle">
                <span className="font-bold text-white uppercase tracking-wider text-xs">MF No.</span>
              </th>
              <th className="px-4 py-2 w-44 text-left align-middle">
                <span className="font-bold text-white uppercase tracking-wider text-xs">Name</span>
              </th>
              <th className="px-4 py-2 w-32 text-left align-middle">
                <span className="font-bold text-white uppercase tracking-wider text-xs">Date</span>
              </th>
              <th className="px-4 py-2 w-16 text-left align-middle">
                <span className="font-bold text-white uppercase tracking-wider text-xs">Month</span>
              </th>
              <th className="px-4 py-2 w-24 text-left align-middle">
                <span className="font-bold text-white uppercase tracking-wider text-xs">Amount</span>
              </th>
              <th className="px-4 py-2 w-36 text-left align-middle">
                <span className="font-bold text-white uppercase tracking-wider text-xs">New Total</span>
              </th>
              <th className="px-4 py-2 text-left align-middle">
                <span className="font-bold text-white uppercase tracking-wider text-xs">Issues</span>
              </th>
              <th className="px-3 py-2 w-16 text-left align-middle">
                <span className="font-bold text-white uppercase tracking-wider text-xs">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody className="divide-y divide-black/5">
            {filtered.length === 0 && (
              <tr>
                <td colSpan={11} className="px-4 py-12 text-center text-sm text-black/30">
                  No rows to show
                </td>
              </tr>
            )}
            {filtered.map((result) => {
              const meta          = STATUS_META[result.matchType] ?? STATUS_META.error;
              const isChecked     = selected.has(result.rowIndex);
              const visibleErrors = result.errors.filter((e) => e.severity !== "info");

              return (
                <tr key={result.rowIndex} className={`${meta.rowBg} hover:brightness-95 transition-all`}>
                  <td className="px-4 py-3">
                    <input
                      type="checkbox"
                      checked={isChecked}
                      onChange={() => onToggle(result.rowIndex)}
                      disabled={result.matchType !== "matched"}
                      className="rounded border-black/20 accent-black disabled:opacity-30"
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
                  <td className="px-4 py-3 text-black/50 text-xs">
                    {result.sheetName || <span className="text-black/20">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-black">
                    {result.mfNumber || <span className="text-black/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-black">
                    {result.name || <span className="text-black/30">—</span>}
                  </td>
                  <td className="px-4 py-3 text-black/70">
                    {formatDate(result.date)}
                  </td>
                  <td className="px-4 py-3 font-mono font-semibold text-black">
                    {result.month || <span className="text-black/30">—</span>}
                  </td>
                  <td className="px-4 py-3 font-mono text-black">
                    {result.amount.toFixed(2)}
                  </td>
                  <td className="px-4 py-3">
                    {result.matchType === "matched" ? (
                      <AmountCell
                        current={result.currentAmount}
                        next={result.newAmount}
                        pledge={result.pledgeAmount}
                      />
                    ) : (
                      <span className="text-black/30">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    {visibleErrors.length === 0 ? (
                      <span className="text-black/30">—</span>
                    ) : (
                      <div className="flex flex-col gap-1">
                        {visibleErrors.map((e, j) => (
                          <ErrorBadge key={j} code={e.code} message={e.message} severity={e.severity} />
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="px-3 py-3">
                    <button
                      onClick={() => onDismissRow(result)}
                      title="Dismiss this row"
                      className="p-1.5 rounded-lg border border-black/10 text-black/30 hover:text-red-500 hover:border-red-200 hover:bg-red-50 transition-all"
                    >
                      <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
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
