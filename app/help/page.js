"use client";
import { useState, useEffect, useMemo } from "react";
import { useRouter } from "next/navigation";

// ─── Content ──────────────────────────────────────────────────────────────────
// Written for the least-technical person who will use this. One short line per
// step; anything longer lives behind a "Show me more" disclosure.

const TABS = [
  { id: "start",    label: "Start here" },
  { id: "pledges",  label: "Pledges" },
  { id: "payments", label: "Payments" },
  { id: "lookup",   label: "Look something up" },
];

const CONNECT_STEPS = [
  {
    text: <>In Google Sheets, press <B>Share</B> and give the app&apos;s email <strong>Editor</strong> access.</>,
    more: <>The email is on the home screen — click it to copy. Without Editor access the app can&apos;t read your sheet or write to it. This is the cause of almost every &ldquo;could not connect&rdquo; message.</>,
  },
  {
    text: <>Paste your sheet&apos;s link into the app.</>,
    more: <>Paste the whole address from your browser. The app pulls out the part it needs.</>,
  },
  {
    text: <>Type the name of the tab your members are in. It starts as <B>Master</B>.</>,
    more: <>It has to match the tab name exactly, capital letters included. If your tab is called something else, change it here.</>,
  },
  { text: <>Press <B>Connect to sheet</B>, then choose Pledges or Payments.</> },
];

const PLEDGE_STEPS = [
  {
    text: <>Open <B>Pledges</B> and drop in the Pabbly file.</>,
    more: <>A CSV or an Excel file, either is fine. Anyone you&apos;ve already pushed before is left out automatically, so uploading the same file twice does no harm.</>,
  },
  {
    text: <>Look at the coloured label at the start of each row — they&apos;re listed below.</>,
    more: <>Rows are grouped by region and then by label, so the ones needing you tend to sit together. You can also sort by any column, or use the filter row under the headings to show one label at a time.</>,
  },
  {
    text: <>On the amber rows, choose which value is right.</>,
    more: <>Where the form and your sheet disagree you&apos;ll see two small buttons: <B>Current</B> keeps what your sheet says, <B>New</B> takes what the person typed in the form. Where a region is missing, pick one from the dropdown. You can also click into any cell and type a correction yourself.</>,
  },
  {
    text: <>If you&apos;d rather let a region decide, send the amber rows to them.</>,
    optional: true,
    more: <><B>Export review report</B> downloads a spreadsheet of just the disagreements. The coordinator fills in the <strong>Decision</strong> column, sends it back, and you load it with <B>Upload region response</B>. Ask them not to delete any columns or rows — the file needs them to find its way back. Loading their answers still changes nothing until you push.</>,
  },
  {
    text: <>Push the rows you&apos;re happy with.</>,
    more: <>The ↑ button on a row pushes just that person. Or use the buttons along the top: <B>Add N new</B>, <B>Update N clean</B>, or <B>Update N selected</B> for the rows you&apos;ve ticked.</>,
  },
  {
    text: <>Rows disappear as they&apos;re pushed. When the table is empty, you&apos;re done.</>,
  },
];

const PAYMENT_STEPS = [
  {
    text: <>Open <B>Payments</B> and drop in the bank statement.</>,
    more: <>UOB and DBS files are both recognised, PayNow or Bank Online. If the file has several tabs, all of them are read and combined — you don&apos;t need to tidy it up first.</>,
  },
  {
    text: <>Choose which weeks to bring in.</>,
    more: <>If the file covers more than one week you&apos;ll be asked which ones you want. Weeks run Tuesday to the following Monday. Weeks you&apos;ve already done are marked, and only the new ones are ticked for you.</>,
  },
  {
    text: <>Check the <strong>New Total</strong> column — that&apos;s what the person&apos;s month will say afterwards.</>,
    more: <>Payments add up. If someone gives twice in July, the second one is added to the first — it never replaces it. The small figure underneath shows what was in the cell before.</>,
  },
  {
    text: <>Sort out any red rows.</>,
    more: <>Red means the app couldn&apos;t tell who the payment is from, or your sheet has no column for that month. The payer&apos;s name from the bank is shown so you can identify them — type the right MF number into the row and it re-matches. If a month column is missing you&apos;ll be offered a button to add it. Rows you can&apos;t place can be dismissed with ✕ and handled by hand.</>,
  },
  {
    text: <>Push. Use ↑ on one row, or <B>Push N matched</B> for everything that&apos;s ready.</>,
  },
];

// Row labels, shown in full on each workflow tab (not hidden behind a disclosure —
// this is the thing people look at most).
const PLEDGE_LABELS = [
  { tone: "update", term: "Update",
    body: "Found in your sheet and everything matches. Nothing to do — push when you're ready." },
  { tone: "review", term: "Review",
    body: "Found, but the form and your sheet disagree somewhere. The disagreeing cells show two buttons for you to choose between." },
  { tone: "new", term: "New",
    body: "A first-time pledger. They'll be added as a new row at the bottom, with an MF number made from their NRIC." },
  { tone: "error", term: "Error",
    body: "They say they've pledged before, but nobody in your sheet matches — or something required is missing. Correct it in the row, or dismiss it." },
];

const PAYMENT_LABELS = [
  { tone: "matched", term: "Matched",
    body: "The transaction is linked to a person and to a month column. Check the New Total, then push." },
  { tone: "error", term: "Error",
    body: "No usable MF number in the bank reference, nobody matches it, or your sheet has no column for that month yet." },
];

// What people can actually do on each screen. `flow` renders as a numbered
// sub-sequence for the multi-step ones (like the region round trip).
const PLEDGE_ACTIONS = [
  {
    title: "Choose between two values",
    body: <>On a <Badge tone="review">Review</Badge> row, each disagreeing cell shows <B>Current</B> (what your sheet says now) and <B>New</B> (what they typed in the form). Click the one that&apos;s right. Once every disagreement on a row is settled, it turns into <Badge tone="update">Update</Badge>.</>,
  },
  {
    title: "Type a correction yourself",
    body: <>Click into almost any cell and type. Your version is what gets pushed. It doesn&apos;t change the original file. Where a region wasn&apos;t recognised you get a dropdown to pick from instead.</>,
  },
  {
    title: "Send the hard ones to a region, then bring the answers back",
    body: <>When you&apos;d rather a regional coordinator decided, you can hand them a spreadsheet of just the disagreements and load their answers back in.</>,
    flow: [
      <>Press <B>Export review report</B>. Pick one region, or export every region at once — either as <B>separate files</B> or <B>one combined file</B>.</>,
      <>You get an Excel file with one line per disagreement: the person, which detail is in question, the current value and the new one. There&apos;s an Instructions sheet inside it too.</>,
      <>The coordinator puts <B>Current</B> or <B>New</B> in the Decision column and sends it back. They can answer only some of them — blanks are simply left for later.</>,
      <>Press <B>Upload region response</B> and choose their file. Their decisions are filled in for you, and rows with nothing left to settle turn green.</>,
      <>Nothing has touched your sheet yet. Push when you&apos;re happy.</>,
    ],
    footer: <>Ask coordinators not to delete columns or rows — the file carries hidden markers it needs to find its way back.</>,
  },
  {
    title: "Add a second file to the same batch",
    body: <><B>Add new CSV</B> merges another export into the table you&apos;re already working on. Anyone already listed is skipped. If it was the wrong file, <B>Undo last add</B> takes it straight back out.</>,
  },
  {
    title: "Push some now, the rest later",
    body: <>↑ on a row pushes that one person. <B>Add N new</B> does all the clean new people, <B>Update N clean</B> all the clean matches, and <B>Update N selected</B> whatever you&apos;ve ticked. You don&apos;t have to do it all at once.</>,
  },
  {
    title: "Remove rows you don't want",
    body: <>✕ on a row takes it out for good — it won&apos;t reappear when you come back. <B>Dismiss N errors</B> clears all the red ones at once. Nothing dismissed is written anywhere.</>,
  },
  {
    title: "Undo a push",
    body: <><B>Revert last push</B> puts the cells back exactly as they were, removes anyone newly added, and returns those rows to the table. It covers your most recent push only, and only until you refresh or close the page.</>,
  },
];

const PAYMENT_ACTIONS = [
  {
    title: "Choose which weeks to bring in",
    body: <>If the statement covers several weeks you&apos;re asked which ones you want. Weeks run Tuesday to the following Monday. Ones you&apos;ve already done are labelled, and only new weeks are ticked. <B>Only new</B>, <B>Select all</B> and <B>Clear</B> set them all at once.</>,
  },
  {
    title: "Fix a payment the app couldn't place",
    body: <>Red rows show the payer&apos;s name or note straight from the bank, so you can work out who it is. Type the right MF number into the row and it re-matches on the spot. You can correct the amount the same way.</>,
  },
  {
    title: "Add a month your sheet doesn't have yet",
    body: <>If a payment falls in a month with no column, a prompt above the table offers to add the missing months for you. It appends them to the end of your header row and leaves everything else alone.</>,
  },
  {
    title: "Add a second statement to the same batch",
    body: <><B>Add file</B> merges another bank export into the table. Transactions already listed are skipped. <B>Undo last add</B> reverses it.</>,
  },
  {
    title: "Push some now, the rest later",
    body: <>↑ on a row posts that one payment. <B>Push N matched</B> does everything currently ready — and if you&apos;ve filtered the table, only what you can see. <B>Push N selected</B> does the ticked ones.</>,
  },
  {
    title: "Undo a push",
    body: <><B>Revert last push</B> restores the month cells to their previous amounts and brings the rows back to the table. Most recent push only, and only until you refresh or close the page.</>,
  },
];

// One flat, searchable list — replaces four separate reference tables.
const LOOKUP = [
  { cat: "Row labels", term: "Update",  badge: "update",
    body: "Pledges. This person is in your sheet and everything matches. Safe to push." },
  { cat: "Row labels", term: "Review",  badge: "review",
    body: "Pledges. This person is in your sheet, but some details don't match what they typed in the form. Choose Current or New on each highlighted field." },
  { cat: "Row labels", term: "New",     badge: "new",
    body: "Pledges. A first-time pledger. They'll be added to the bottom of your sheet with a new MF number." },
  { cat: "Row labels", term: "Error",   badge: "error",
    body: "The row can't be used as it stands. For pledges: they say they've pledged before but aren't in your sheet. For payments: no usable MF number, or the month has no column yet." },
  { cat: "Row labels", term: "Matched", badge: "matched",
    body: "Payments. The transaction is linked to a person and a month column. Check the New Total, then push." },

  { cat: "Problems", term: "MF autocorrected",
    body: "The MF number was missing its “MF” at the front, so it was added for you. Worth a quick glance to make sure it's the right person." },
  { cat: "Problems", term: "MF not found",
    body: "That MF number isn't in your sheet. Check for a typo, or the person may genuinely be new." },
  { cat: "Problems", term: "Name / NRIC / Contact / Email / Region mismatch",
    body: "The form and your sheet say different things. Pick which one is right using the Current and New buttons on that cell." },
  { cat: "Problems", term: "Missing region",
    body: "The region on the form wasn't one the app recognises. Choose the right one from the dropdown before you push." },
  { cat: "Problems", term: "Missing contact / email / pledge amount",
    body: "Something required is blank in both the form and your sheet. Type it in yourself, or dismiss the row." },
  { cat: "Problems", term: "Invalid email / phone",
    body: "The value doesn't look like a real email address or phone number. Correct it in the cell." },
  { cat: "Problems", term: "Month column not found",
    body: "Your sheet has no column for that payment's month. Use the Add missing months button that appears above the table." },

  { cat: "Buttons", term: "Add new CSV / Add file",
    body: "Adds a second file into the batch you're already working on. Anything already in the table is skipped. Undo last add reverses it." },
  { cat: "Buttons", term: "Discard file",
    body: "Throws away the whole batch and starts over. It asks you to confirm first. Nothing that's already been pushed is affected." },
  { cat: "Buttons", term: "Revert last push",
    body: "Undoes your most recent push — puts the cells back as they were and returns the rows to the table. Only the last push, and only until you refresh or close the page." },
  { cat: "Buttons", term: "Export review report",
    body: "Downloads the disagreements for one region as a spreadsheet, so a coordinator can decide. They fill in the Decision column and send it back." },
  { cat: "Buttons", term: "Upload region response",
    body: "Loads a coordinator's filled-in spreadsheet and applies their decisions to the table. Still writes nothing to your sheet until you push." },
  { cat: "Buttons", term: "View Pledge / Payment History",
    body: "Everything ever pushed, with the date and time. It's permanent — reverted items stay listed, marked as reverted." },
  { cat: "Buttons", term: "Reset columns",
    body: "Puts the table's column widths back to normal, if you've dragged them somewhere unhelpful." },
  { cat: "Buttons", term: "✕ on a row",
    body: "Removes the row from the table. It won't come back when you reopen the page, and it isn't written anywhere." },

  { cat: "Questions", term: "Someone gave twice in one month — will the second payment wipe the first?",
    body: "No. Payments add together. The New Total column shows you the result before you push." },
  { cat: "Questions", term: "I uploaded the same file twice.",
    body: "Nothing happens. Anything already pushed is recognised and left out, so no one is charged twice." },
  { cat: "Questions", term: "I pushed the wrong rows.",
    body: "Press Revert last push straight away. If you've already refreshed the page that option is gone — the History view will tell you exactly what was written so you can correct it in the sheet." },
  { cat: "Questions", term: "Will this overwrite anything I've typed in by hand?",
    body: "The Service column and the monthly payment columns are never touched by the pledge side. And a blank in the form never clears something that already has a value in your sheet." },
  { cat: "Questions", term: "Text in a column is cut off.",
    body: "Drag the right-hand edge of the column heading to widen it. Your widths are remembered next time." },
  { cat: "Questions", term: "Do I have to finish in one sitting?",
    body: "No. Close the browser whenever you like. Your rows, your corrections and anything you dismissed are all waiting when you come back." },
  { cat: "Questions", term: "A tab in my bank file was ignored.",
    body: "Only tabs that look like transactions are read. Notes and summary tabs are skipped on purpose." },
  { cat: "Questions", term: "What are the tabs starting with an underscore in my sheet?",
    body: "The app's own working tabs — they hold your unfinished batch and the permanent record of what's been pushed. Please leave them alone." },
];

const LOOKUP_CATS = ["Row labels", "Problems", "Buttons", "Questions"];

// ─── Pieces ───────────────────────────────────────────────────────────────────

// A button name exactly as it appears in the app
function B({ children }) {
  return <span className="font-semibold text-ink whitespace-nowrap">{children}</span>;
}

function Badge({ tone, children }) {
  const tones = {
    update:  "bg-emerald-50 text-emerald-700 border-emerald-200",
    review:  "bg-amber-50 text-amber-700 border-amber-200",
    new:     "bg-violet-50 text-violet-700 border-violet-200",
    error:   "bg-red-50 text-red-700 border-red-200",
    matched: "bg-emerald-50 text-emerald-700 border-emerald-200",
  };
  return <span className={`inline-block px-2 py-0.5 rounded-lg text-xs font-semibold border ${tones[tone]}`}>{children}</span>;
}

// One numbered step. Detail is closed by default and opened only on demand.
function Step({ n, text, more, optional }) {
  return (
    <li className="flex gap-4">
      <span
        aria-hidden="true"
        className="shrink-0 w-7 h-7 rounded-full bg-ink text-white text-sm font-semibold flex items-center justify-center mt-px tabular-nums"
      >
        {n}
      </span>
      <div className="min-w-0 flex-1 pb-1">
        <p className="text-lg text-ink leading-snug">
          {text}
          {optional && <span className="ml-2 text-sm text-faint font-medium">optional</span>}
        </p>
        {more && (
          <details className="group mt-2">
            <summary className="inline-flex items-center gap-1.5 cursor-pointer list-none text-base text-accent hover:text-accent-hover font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md">
              <svg className="w-3.5 h-3.5 transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
              </svg>
              <span className="group-open:hidden">Show me more</span>
              <span className="hidden group-open:inline">Hide</span>
            </summary>
            <div className="mt-2 text-base text-muted leading-relaxed max-w-prose">{more}</div>
          </details>
        )}
      </div>
    </li>
  );
}

function StepList({ steps }) {
  return (
    <ol className="space-y-6">
      {steps.map((s, i) => <Step key={i} n={i + 1} {...s} />)}
    </ol>
  );
}

// Row-label reference, shown in full on the workflow tabs.
function LabelList({ items }) {
  return (
    <dl className="divide-y divide-line border-y border-line">
      {items.map((l) => (
        <div key={l.term} className="py-4 sm:flex sm:gap-5">
          <dt className="sm:w-32 sm:shrink-0 mb-1.5 sm:mb-0">
            <Badge tone={l.tone}>{l.term}</Badge>
          </dt>
          <dd className="text-base text-muted leading-relaxed max-w-prose">{l.body}</dd>
        </div>
      ))}
    </dl>
  );
}

// One thing you can do, with an optional numbered sub-sequence for the
// multi-step ones. Detail stays closed until asked for.
function Action({ title, body, flow, footer }) {
  return (
    <details className="group border-b border-line last:border-b-0">
      <summary className="flex items-center gap-3 py-4 cursor-pointer list-none text-lg text-ink font-medium hover:text-accent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 rounded-md">
        <svg
          className="w-4 h-4 shrink-0 text-faint transition-transform duration-200 ease-out group-open:rotate-90 motion-reduce:transition-none"
          fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M9 5l7 7-7 7" />
        </svg>
        {title}
      </summary>
      <div className="pb-5 pl-7 space-y-3">
        <p className="text-base text-muted leading-relaxed max-w-prose">{body}</p>
        {flow && (
          <ol className="space-y-2.5 border-l border-line pl-5 ml-1">
            {flow.map((f, i) => (
              <li key={i} className="text-base text-muted leading-relaxed max-w-prose relative">
                <span className="absolute -left-6.75 top-0.5 w-4 h-4 rounded-full bg-panel border border-line text-[10px] font-semibold text-ink flex items-center justify-center tabular-nums">
                  {i + 1}
                </span>
                {f}
              </li>
            ))}
          </ol>
        )}
        {footer && (
          <p className="text-base text-ink/75 leading-relaxed max-w-prose bg-amber-50 border border-amber-200 rounded-xl px-4 py-3">
            {footer}
          </p>
        )}
      </div>
    </details>
  );
}

function Heading({ children, note }) {
  return (
    <div>
      <h3 className="text-xl font-bold text-ink tracking-tight">{children}</h3>
      {note && <p className="text-base text-muted mt-1 leading-relaxed max-w-prose">{note}</p>}
    </div>
  );
}

function Reassurance({ children }) {
  return (
    <p className="text-lg text-ink leading-relaxed bg-accent-soft border border-accent/15 rounded-2xl px-5 py-4">
      {children}
    </p>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function HelpPage() {
  const router = useRouter();
  const [tab,   setTab]   = useState("start");
  const [query, setQuery] = useState("");
  const [cat,   setCat]   = useState(null);

  // Deep links: /help#payments opens that tab straight away. Read after mount —
  // the hash isn't available during SSR, so reading it earlier would make the
  // first client render disagree with the server's.
  useEffect(() => {
    const fromHash = window.location.hash.replace("#", "");
    if (!TABS.some((t) => t.id === fromHash)) return;
    // eslint-disable-next-line react-hooks/set-state-in-effect -- syncing from the URL on mount
    setTab(fromHash);
  }, []);

  function openTab(id) {
    setTab(id);
    history.replaceState(null, "", `#${id}`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    return LOOKUP.filter((e) =>
      (!cat || e.cat === cat) &&
      (!q || e.term.toLowerCase().includes(q) || e.body.toLowerCase().includes(q))
    );
  }, [query, cat]);

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-shell px-6 py-4 flex items-center gap-3">
        <button
          onClick={() => router.push("/")}
          className="w-7 h-7 bg-surface/10 hover:bg-surface/20 rounded-lg flex items-center justify-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50"
          aria-label="Back to home"
        >
          <svg className="w-3.5 h-3.5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
          </svg>
        </button>
        <h1 className="text-sm font-bold text-white tracking-tight">How to use this app</h1>
      </header>

      {/* Tabs */}
      <div className="bg-surface border-b border-line sticky top-0 z-20">
        <div className="max-w-3xl mx-auto px-6 flex gap-1 overflow-x-auto" role="tablist" aria-label="Help sections">
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                aria-selected={active}
                onClick={() => openTab(t.id)}
                className={`shrink-0 px-4 py-3.5 text-base font-medium border-b-2 -mb-px transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/40 ${
                  active
                    ? "border-accent text-ink"
                    : "border-transparent text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>

      <main className="max-w-3xl mx-auto px-6 py-10 pb-28">

        {/* ── Start here ── */}
        {tab === "start" && (
          <div className="space-y-10">
            <div>
              <h2 className="text-2xl font-bold text-ink tracking-tight text-balance">What this app is for</h2>
              <p className="text-lg text-muted mt-2 leading-relaxed max-w-prose">
                You give it a file — a pledge form export or a bank statement — and it fills in your
                Master sheet for you, after you&apos;ve checked it.
              </p>
            </div>

            <Reassurance>
              <strong className="font-semibold">Nothing is saved to your sheet until you press a push button.</strong>{" "}
              Uploading, correcting and removing rows all happen on screen only. And the last push can always be undone.
            </Reassurance>

            <div>
              <h3 className="text-xl font-bold text-ink tracking-tight">Which one do you need?</h3>
              <div className="mt-4 space-y-3">
                <button
                  onClick={() => openTab("pledges")}
                  className="w-full text-left bg-surface border border-line rounded-2xl p-5 shadow-card hover:border-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <p className="text-lg font-semibold text-ink">Pledges</p>
                  <p className="text-base text-muted mt-1 leading-relaxed">
                    Every few months, when a new pledge round opens. Updates people&apos;s details and
                    what they&apos;ve promised to give.
                  </p>
                </button>
                <button
                  onClick={() => openTab("payments")}
                  className="w-full text-left bg-surface border border-line rounded-2xl p-5 shadow-card hover:border-accent/40 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
                >
                  <p className="text-lg font-semibold text-ink">Payments</p>
                  <p className="text-base text-muted mt-1 leading-relaxed">
                    Every week, from the bank statement. Records what each person actually gave,
                    in the right month.
                  </p>
                </button>
              </div>
            </div>

            <div>
              <h3 className="text-xl font-bold text-ink tracking-tight">Setting up your sheet</h3>
              <p className="text-base text-muted mt-1.5 mb-5 leading-relaxed max-w-prose">
                Once at the start of each session. If someone has already connected the sheet for you,
                skip this.
              </p>
              <StepList steps={CONNECT_STEPS} />
            </div>
          </div>
        )}

        {/* ── Pledges ── */}
        {tab === "pledges" && (
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-ink tracking-tight">Pledges</h2>
              <p className="text-lg text-muted mt-2 leading-relaxed max-w-prose">
                Upload the form export, sort out anything that doesn&apos;t match, push.
              </p>
            </div>
            <StepList steps={PLEDGE_STEPS} />

            <div className="space-y-4 pt-2">
              <Heading note="Every row carries one of these. It tells you whether you need to do anything.">
                The labels you&apos;ll see
              </Heading>
              <LabelList items={PLEDGE_LABELS} />
            </div>

            <div className="space-y-1 pt-2">
              <Heading note="Open any of these for the detail.">What you can do</Heading>
              <div className="pt-2">
                {PLEDGE_ACTIONS.map((a) => <Action key={a.title} {...a} />)}
              </div>
            </div>

            <Reassurance>
              The pledge side never touches the <strong className="font-semibold">Service</strong> column
              or any of the monthly payment amounts.
            </Reassurance>
          </div>
        )}

        {/* ── Payments ── */}
        {tab === "payments" && (
          <div className="space-y-8">
            <div>
              <h2 className="text-2xl font-bold text-ink tracking-tight">Payments</h2>
              <p className="text-lg text-muted mt-2 leading-relaxed max-w-prose">
                Upload the bank statement, check who each payment belongs to, push.
              </p>
            </div>
            <StepList steps={PAYMENT_STEPS} />

            <div className="space-y-4 pt-2">
              <Heading note="Only two here — a payment either landed on someone, or it didn't.">
                The labels you&apos;ll see
              </Heading>
              <LabelList items={PAYMENT_LABELS} />
              <p className="text-base text-muted leading-relaxed max-w-prose">
                You may also see a quiet note saying some transactions were skipped as duplicates. Those are
                ones you&apos;ve already pushed before — they&apos;re left out of the table on purpose.
              </p>
            </div>

            <div className="space-y-1 pt-2">
              <Heading note="Open any of these for the detail.">What you can do</Heading>
              <div className="pt-2">
                {PAYMENT_ACTIONS.map((a) => <Action key={a.title} {...a} />)}
              </div>
            </div>

            <Reassurance>
              Uploading last week&apos;s file again is safe. Anything already pushed is recognised and
              left out, so nobody is credited twice.
            </Reassurance>
          </div>
        )}

        {/* ── Look up ── */}
        {tab === "lookup" && (
          <div>
            <h2 className="text-2xl font-bold text-ink tracking-tight">Look something up</h2>
            <p className="text-lg text-muted mt-2 leading-relaxed max-w-prose">
              A label, a button, or something that went wrong.
            </p>

            <div className="mt-6 sticky top-14 bg-canvas pt-1 pb-3 z-10">
              <label htmlFor="help-search" className="sr-only">Search help</label>
              <input
                id="help-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Type what you're looking at, e.g. “amber” or “revert”"
                className="w-full px-4 py-3 bg-surface border border-line rounded-xl text-base text-ink placeholder:text-faint focus:outline-none focus:border-accent focus:ring-2 focus:ring-accent/30 transition-colors"
              />
              <div className="flex flex-wrap gap-2 mt-3">
                {LOOKUP_CATS.map((c) => {
                  const on = cat === c;
                  return (
                    <button
                      key={c}
                      onClick={() => setCat(on ? null : c)}
                      aria-pressed={on}
                      className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/40 ${
                        on
                          ? "bg-ink text-white border-ink"
                          : "bg-surface text-muted border-line hover:text-ink hover:border-ink/25"
                      }`}
                    >
                      {c}
                    </button>
                  );
                })}
              </div>
            </div>

            {results.length === 0 ? (
              <p className="text-base text-muted py-12 text-center">
                Nothing matches &ldquo;{query}&rdquo;. Try a shorter word, or clear the filters above.
              </p>
            ) : (
              <dl className="divide-y divide-line border-t border-line">
                {results.map((e, i) => (
                  <div key={i} className="py-5">
                    <dt className="text-base font-semibold text-ink flex items-center gap-2 flex-wrap">
                      {e.badge ? <Badge tone={e.badge}>{e.term}</Badge> : e.term}
                    </dt>
                    <dd className="text-base text-muted mt-1.5 leading-relaxed max-w-prose">{e.body}</dd>
                  </div>
                ))}
              </dl>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
