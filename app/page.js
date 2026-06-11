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
            <p className="text-xs text-white/40">Pledge &amp; Payment Processor</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {/* Service account — share the master sheet with this email */}
          <button
            onClick={copyEmail}
            title="Share your Google Sheet with this service account (Editor), then copy it here"
            className="hidden sm:flex items-center gap-2 text-xs bg-white/5 hover:bg-white/10 text-white/70 hover:text-white px-3 py-1.5 rounded-lg border border-white/10 hover:border-white/20 transition-all max-w-88"
          >
            <svg className="w-3.5 h-3.5 shrink-0 text-white/40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M16 12a4 4 0 10-8 0 4 4 0 008 0zm0 0v1.5a2.5 2.5 0 005 0V12a9 9 0 10-9 9m4.5-1.206a8.959 8.959 0 01-4.5 1.206" />
            </svg>
            <span className="font-mono truncate">{SERVICE_ACCOUNT_EMAIL}</span>
            <span className="shrink-0 text-white/40">
              {copied ? (
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                </svg>
              ) : (
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                </svg>
              )}
            </span>
          </button>
          <button
            onClick={handleSignOut}
            className="text-xs bg-white/10 hover:bg-white/20 text-white px-3 py-1.5 rounded-lg font-medium border border-white/10 hover:border-white/20 transition-all"
          >
            Sign out
          </button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-6 py-10">

        {/* ── SHEET CONFIG ── */}
        {phase === "sheet_config" && (
          <div className="max-w-md mx-auto">
            <div className="mb-6">
              <h2 className="text-2xl font-bold text-black tracking-tight">Connect your sheet</h2>
              <p className="text-sm text-black/50 mt-1">Paste in the Google Sheet ID and the tab name to get started.</p>
            </div>

            {/* Share-access reminder — the service account needs Editor access first */}
            <div className="mb-6 bg-blue-50 border border-blue-100 rounded-2xl p-5">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-lg bg-blue-100 flex items-center justify-center shrink-0">
                  <svg className="w-4 h-4 text-blue-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                  </svg>
                </div>
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-blue-900">First, share your sheet with the app</p>
                  <p className="text-xs text-blue-800/70 mt-1 leading-relaxed">
                    In Google Sheets, click <span className="font-semibold">Share</span> and give this service account{" "}
                    <span className="font-semibold">Editor</span>{" "}
                    access. Without it, the app can&apos;t read or update your sheet.
                  </p>
                  <button
                    type="button"
                    onClick={copyEmail}
                    className="mt-3 w-full flex items-center justify-between gap-2 bg-white border border-blue-200 rounded-xl px-3 py-2 text-left hover:border-blue-300 transition-all group"
                  >
                    <span className="font-mono text-xs text-blue-900 truncate">{SERVICE_ACCOUNT_EMAIL}</span>
                    <span className={`shrink-0 flex items-center gap-1 text-xs font-semibold ${copied ? "text-emerald-600" : "text-blue-600"}`}>
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

        {/* ── HOME ── */}
        {phase === "home" && (
          <div className="max-w-xl mx-auto">
            <div className="mb-8 flex items-start justify-between">
              <div>
                <h2 className="text-2xl font-bold text-black tracking-tight">What would you like to do?</h2>
                <p className="text-sm text-black/50 mt-1">{sheetTitle || sheetId}</p>
              </div>
              <button
                onClick={handleChangeSheet}
                className="text-xs bg-white text-black/60 hover:text-black border border-black/15 shadow-sm hover:shadow hover:border-black/25 px-3 py-1.5 rounded-lg font-medium transition-all mt-1"
              >
                Change sheet
              </button>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => router.push("/payment")}
                className="bg-white border border-black/8 rounded-2xl p-6 text-left shadow-sm hover:shadow hover:border-black/20 transition-all"
              >
                <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center mb-4">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-black">Payments</p>
                <p className="text-xs text-black/40 mt-1">Upload bank transactions and update monthly payment amounts</p>
              </button>

              <button
                onClick={() => router.push("/pledge")}
                className="bg-white border border-black/8 rounded-2xl p-6 text-left shadow-sm hover:shadow hover:border-black/20 transition-all"
              >
                <div className="w-10 h-10 bg-black rounded-xl flex items-center justify-center mb-4">
                  <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                      d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
                  </svg>
                </div>
                <p className="text-sm font-bold text-black">Pledges</p>
                <p className="text-xs text-black/40 mt-1">Upload Pabbly exports and update the master sheet with new pledges</p>
              </button>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
