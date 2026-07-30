"use client";

// Status line under the upload drop zone.
//
// Progress messages end in "…" and stay quiet — a spinner and grey text.
// Anything else is a failure the user has to act on, so it gets a real alert
// instead of small centred text that's easy to miss.
export default function UploadStatus({ message }) {
  if (message.endsWith("…")) {
    return (
      <div className="mt-4 flex items-center justify-center gap-2">
        <svg className="w-4 h-4 text-faint animate-spin shrink-0" fill="none" viewBox="0 0 24 24">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z" />
        </svg>
        <p className="text-sm text-muted">{message}</p>
      </div>
    );
  }
  return (
    <div role="alert" className="mt-4 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-2xl">
      <svg className="w-5 h-5 text-red-600 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
          d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
      {/* Drop the developer-facing prefix — the message below already says what to do */}
      <p className="text-base text-ink leading-relaxed">{message.replace(/^Error loading session: /, "")}</p>
    </div>
  );
}
