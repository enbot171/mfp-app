"use client";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

const SESSION_KEY = "mfp_sheet_config";
const SERVICE_ACCOUNT_EMAIL = "mfp-app-service@mfp-app-498015.iam.gserviceaccount.com";

function extractSheetId(value) {
  const match = value.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  return match ? match[1] : value.trim();
}

function getConfig() {
  try {
    const s = sessionStorage.getItem(SESSION_KEY);
    return s ? JSON.parse(s) : {};
  } catch { return {}; }
}

export default function HomePage() {
  const [phase,        setPhase]        = useState("sheet_config"); // "sheet_config" | "home"
  const [sheetId,      setSheetId]      = useState("");
  const [tabName,      setTabName]      = useState("Sheet1");
  const [sheetTitle,   setSheetTitle]   = useState("");
  const [connectError, setConnectError] = useState(null);
  const [connecting,   setConnecting]   = useState(false);
  const [copied,       setCopied]       = useState(false);

  const router = useRouter();

  async function copyEmail() {
    try {
      await navigator.clipboard.writeText(SERVICE_ACCOUNT_EMAIL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable — user can still select the text */ }
  }

  useEffect(() => {
    const { sheetId: sid, tabName: tab, sheetTitle: title } = getConfig();
    if (sid) {
      setSheetId(sid);
      setTabName(tab ?? "Sheet1");
      setSheetTitle(title ?? "");
      setPhase("home");
    }
  }, []);

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
      setPhase("home");
    } catch (err) {
      setConnectError(err.message);
    } finally {
      setConnecting(false);
    }
  }

  function handleChangeSheet() {
    sessionStorage.removeItem(SESSION_KEY);
    setPhase("sheet_config");
  }

  async function handleSignOut() {
    sessionStorage.removeItem(SESSION_KEY);
    await fetch("/api/auth", { method: "DELETE" });
    router.push("/login");
  }

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-shell px-6 py-3.5 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 bg-white/95 rounded-lg flex items-center justify-center shrink-0">
            <svg className="w-4.5 h-4.5 text-shell" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
          </div>
          <div>
            <h1 className="text-sm font-semibold text-white tracking-tight">MFP App</h1>
            <p className="text-xs text-white/50">Pledge &amp; Payment Processor</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Service account — share the master sheet with this email */}
          <button
            onClick={copyEmail}
            title="Share your Google Sheet with this service account (Editor), then copy it here"
            className="hidden sm:flex items-center gap-2 text-xs bg-white/8 hover:bg-white/14 text-white/75 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 transition-colors max-w-88"
          >
            <svg className="w-3.5 h-3.5 shrink-0 text-white/45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.206" />
            </svg>
            <span className="font-mono truncate">{SERVICE_ACCOUNT_EMAIL}</span>
            <span className="shrink-0">
              {copied ? (
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5 text-white/45" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </span>
          </button>
          <button
            onClick={handleSignOut}
            className="text-xs bg-white/10 hover:bg-white/16 text-white px-3 py-1.5 rounded-lg font-medium border border-white/10 hover:border-white/20 transition-colors"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-12">

        {/* ── SHEET CONFIG ── */}
        {phase === "sheet_config" && (
          <div className="max-w-md mx-auto">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-ink tracking-tight text-balance">Connect your sheet</h2>
              <p className="text-base text-muted mt-1.5">Paste in the Google Sheet ID and tab name to get started.</p>
            </div>

            {/* Share-access reminder — the service account needs Editor access first */}
            <div className="mb-5 bg-accent-soft border border-accent/15 rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-accent/12 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-base font-semibold text-ink">First, share your sheet with the app</p>
                  <p className="text-sm text-muted mt-1 leading-relaxed">
                    In Google Sheets, click <span className="font-medium text-ink">Share</span> and give this service account{" "}
                    <span className="font-medium text-ink">Editor</span>{" "}
                    access — otherwise the app can&apos;t read or update your sheet.
                  </p>
                  <button
                    type="button"
                    onClick={copyEmail}
                    className="mt-3 w-full flex items-center justify-between gap-2 bg-surface border border-accent/20 rounded-xl px-3 py-2 text-left hover:border-accent/40 transition-colors"
                  >
                    <span className="font-mono text-sm text-ink truncate">{SERVICE_ACCOUNT_EMAIL}</span>
                    <span className={`shrink-0 flex items-center gap-1 text-xs font-semibold ${copied ? "text-success" : "text-accent"}`}>
                      {copied ? (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                          </svg>
                          Copied
                        </>
                      ) : (
                        <>
                          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                              d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                          Copy
                        </>
                      )}
                    </span>
                  </button>
                </div>
              </div>
            </div>

            <div className="bg-surface rounded-2xl border border-line shadow-card p-8">
              <form onSubmit={handleConnect} className="space-y-5">
                <div>
                  <label className="block text-base font-medium text-ink mb-1.5">Sheet ID or URL</label>
                  <input
                    type="text"
                    value={sheetId}
                    onChange={handleSheetIdInput}
                    placeholder="Paste the Sheet ID or the full Google Sheets URL"
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-xl text-base font-mono text-ink placeholder:text-faint/60 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-all"
                    required
                  />
                  <p className="mt-1.5 text-sm text-faint">Paste the full URL — the ID is extracted automatically.</p>
                </div>
                <div>
                  <label className="block text-base font-medium text-ink mb-1.5">Tab name</label>
                  <input
                    type="text"
                    value={tabName}
                    onChange={(e) => setTabName(e.target.value)}
                    placeholder="Sheet1"
                    className="w-full px-4 py-2.5 bg-surface border border-line rounded-xl text-base text-ink placeholder:text-faint/60 focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-all"
                    required
                  />
                </div>
                {connectError && (
                  <div className="flex items-start gap-2 p-3 bg-danger/8 border border-danger/15 rounded-xl">
                    <svg className="w-4 h-4 text-danger mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                    </svg>
                    <p className="text-base text-danger">{connectError}</p>
                  </div>
                )}
                <button
                  type="submit"
                  disabled={connecting}
                  className="w-full bg-ink text-white py-2.5 rounded-xl text-base font-medium hover:bg-ink/90 disabled:opacity-40 transition-colors"
                >
                  {connecting ? "Connecting…" : "Connect to sheet"}
                </button>
              </form>
            </div>
          </div>
        )}

        {/* ── HOME ── */}
        {phase === "home" && (
          <div className="max-w-2xl mx-auto">
            <div className="mb-8 flex items-start justify-between gap-4">
              <div className="min-w-0">
                <h2 className="text-2xl font-bold text-ink tracking-tight">What would you like to do?</h2>
                <p className="text-base text-muted mt-1.5 truncate">Connected to <span className="text-ink font-medium">{sheetTitle || sheetId}</span></p>
              </div>
              <button
                onClick={handleChangeSheet}
                className="shrink-0 text-sm bg-surface text-muted hover:text-ink border border-line hover:border-ink/20 shadow-card px-3.5 py-2 rounded-lg font-medium transition-colors mt-0.5"
              >
                Change sheet
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-4">
              <button
                onClick={() => router.push("/payment")}
                className="group bg-surface border border-line rounded-2xl p-6 text-left shadow-card hover:border-accent/40 hover:shadow-pop transition-all"
              >
                <div className="w-11 h-11 bg-accent-soft rounded-xl flex items-center justify-center mb-4 group-hover:bg-accent/15 transition-colors">
                  <svg className="w-5.5 h-5.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-md font-semibold text-ink">Payments</p>
                  <svg className="w-4 h-4 text-faint -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                <p className="text-sm text-muted mt-1.5 leading-relaxed">Upload bank statements and post payments into the monthly columns.</p>
              </button>

              <button
                onClick={() => router.push("/pledge")}
                className="group bg-surface border border-line rounded-2xl p-6 text-left shadow-card hover:border-accent/40 hover:shadow-pop transition-all"
              >
                <div className="w-11 h-11 bg-accent-soft rounded-xl flex items-center justify-center mb-4 group-hover:bg-accent/15 transition-colors">
                  <svg className="w-5.5 h-5.5 text-accent" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <div className="flex items-center gap-1.5">
                  <p className="text-md font-semibold text-ink">Pledges</p>
                  <svg className="w-4 h-4 text-faint -translate-x-1 opacity-0 group-hover:translate-x-0 group-hover:opacity-100 transition-all" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                  </svg>
                </div>
                <p className="text-sm text-muted mt-1.5 leading-relaxed">Upload Pabbly exports and update the master sheet with new pledges.</p>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
