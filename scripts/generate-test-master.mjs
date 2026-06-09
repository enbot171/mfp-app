import * as XLSX from "xlsx";
import { fileURLToPath } from "url";
import path from "path";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Helper: build one master row. MAR = pledge amount (simulates one paid month).
const r = (mf, name, region, nric, ref, contact, email, service, pledge) =>
  [mf, name, region, nric, ref, contact, email, service, String(pledge) + ".00", pledge, "", "", "", "", ""];

const rows = [
  ["MF number", "Full Name", "Region", "Partial NRIC", "Ref. No.", "Contact Number", "Email", "Service", "Pledge Amount", "MAR", "APR", "MAY", "JUN", "JUL", "AUG"],

  // ─── Clean matches (MF101A–MF135A) ─────────────────────────────────────────
  // Pabbly sends exact same data → Update (no issues)
  r("MF101A", "Alice Tan",      "North",   "101A", "", "90000101", "alice.tan@test.com",      "English",  500),
  r("MF102A", "Benjamin Lim",   "East",    "102A", "", "90000102", "benjamin.lim@test.com",   "Mandarin", 300),
  r("MF103A", "Chloe Wong",     "Central", "103A", "", "90000103", "chloe.wong@test.com",     "English",  200),
  r("MF104A", "David Ng",       "West",    "104A", "", "90000104", "david.ng@test.com",       "Mandarin", 150),
  r("MF105A", "Emily Goh",      "South",   "105A", "", "90000105", "emily.goh@test.com",      "English",  250),
  r("MF106A", "Frank Chua",     "North",   "106A", "", "90000106", "frank.chua@test.com",     "Mandarin", 400),
  r("MF107A", "Grace Koh",      "East",    "107A", "", "90000107", "grace.koh@test.com",      "English",  500),
  r("MF108A", "Henry Teo",      "Central", "108A", "", "90000108", "henry.teo@test.com",      "Mandarin", 600),
  r("MF109A", "Irene Ong",      "West",    "109A", "", "90000109", "irene.ong@test.com",      "English",  800),
  r("MF110A", "Jason Lee",      "South",   "110A", "", "90000110", "jason.lee@test.com",      "Mandarin", 1000),
  r("MF111A", "Karen Sim",      "North",   "111A", "", "90000111", "karen.sim@test.com",      "English",  350),
  r("MF112A", "Lawrence Ho",    "East",    "112A", "", "90000112", "lawrence.ho@test.com",    "Mandarin", 200),
  r("MF113A", "Melissa Chen",   "Central", "113A", "", "90000113", "melissa.chen@test.com",   "English",  300),
  r("MF114A", "Nathan Yeo",     "West",    "114A", "", "90000114", "nathan.yeo@test.com",     "Mandarin", 250),
  r("MF115A", "Olivia Loh",     "South",   "115A", "", "90000115", "olivia.loh@test.com",     "English",  150),
  r("MF116A", "Patrick Tan",    "North",   "116A", "", "90000116", "patrick.tan@test.com",    "Mandarin", 450),
  r("MF117A", "Rachel Ng",      "East",    "117A", "", "90000117", "rachel.ng@test.com",      "English",  500),
  r("MF118A", "Samuel Lim",     "Central", "118A", "", "90000118", "samuel.lim@test.com",     "Mandarin", 600),
  r("MF119A", "Tiffany Wong",   "West",    "119A", "", "90000119", "tiffany.wong@test.com",   "English",  300),
  r("MF120A", "Vincent Goh",    "South",   "120A", "", "90000120", "vincent.goh@test.com",    "Mandarin", 400),
  r("MF121A", "Wendy Koh",      "North",   "121A", "", "90000121", "wendy.koh@test.com",      "English",  200),
  r("MF122A", "Xavier Teo",     "East",    "122A", "", "90000122", "xavier.teo@test.com",     "Mandarin", 350),
  r("MF123A", "Yvonne Ong",     "Central", "123A", "", "90000123", "yvonne.ong@test.com",     "English",  250),
  r("MF124A", "Zachary Lee",    "West",    "124A", "", "90000124", "zachary.lee@test.com",    "Mandarin", 500),
  r("MF125A", "Aaron Sim",      "South",   "125A", "", "90000125", "aaron.sim@test.com",      "English",  300),
  r("MF126A", "Brenda Ho",      "North",   "126A", "", "90000126", "brenda.ho@test.com",      "Mandarin", 150),
  r("MF127A", "Calvin Chen",    "East",    "127A", "", "90000127", "calvin.chen@test.com",    "English",  400),
  r("MF128A", "Diana Yeo",      "Central", "128A", "", "90000128", "diana.yeo@test.com",      "Mandarin", 600),
  r("MF129A", "Edward Loh",     "West",    "129A", "", "90000129", "edward.loh@test.com",     "English",  200),
  r("MF130A", "Felicia Tan",    "South",   "130A", "", "90000130", "felicia.tan@test.com",    "Mandarin", 350),
  r("MF131A", "Gerald Ng",      "North",   "131A", "", "90000131", "gerald.ng@test.com",      "English",  500),
  r("MF132A", "Helen Lim",      "East",    "132A", "", "90000132", "helen.lim@test.com",      "Mandarin", 250),
  r("MF133A", "Ian Wong",       "Central", "133A", "", "90000133", "ian.wong@test.com",       "English",  300),
  r("MF134A", "Joanna Goh",     "West",    "134A", "", "90000134", "joanna.goh@test.com",     "Mandarin", 400),
  r("MF135A", "Kenneth Koh",    "South",   "135A", "", "90000135", "kenneth.koh@test.com",    "English",  450),

  // ─── Name mismatch (MF136A–MF143A) ─────────────────────────────────────────
  // Master has these names; Pabbly will send slightly different spelling → Review
  r("MF136A", "Christina Teo",  "North",   "136A", "", "90000136", "christina.teo@test.com",  "Mandarin", 400),
  r("MF137A", "Douglas Ng",     "East",    "137A", "", "90000137", "douglas.ng@test.com",     "English",  300),
  r("MF138A", "Elizabeth Tan",  "Central", "138A", "", "90000138", "elizabeth.tan@test.com",  "Mandarin", 500),
  r("MF139A", "Francis Lim",    "West",    "139A", "", "90000139", "francis.lim@test.com",    "English",  200),
  r("MF140A", "Georgia Wong",   "South",   "140A", "", "90000140", "georgia.wong@test.com",   "Mandarin", 350),
  r("MF141A", "Herman Goh",     "North",   "141A", "", "90000141", "herman.goh@test.com",     "English",  250),
  r("MF142A", "Ingrid Koh",     "East",    "142A", "", "90000142", "ingrid.koh@test.com",     "Mandarin", 600),
  r("MF143A", "Jason Teo",      "Central", "143A", "", "90000143", "jason.teo@test.com",      "English",  150),

  // ─── Email mismatch (MF144A–MF148A) ─────────────────────────────────────────
  // Master has old emails; Pabbly sends updated addresses → Review
  r("MF144A", "Derek Ong",      "West",    "144A", "", "90000144", "derek.old@test.com",      "Mandarin", 200),
  r("MF145A", "Eleanor Ho",     "South",   "145A", "", "90000145", "eleanor.old@test.com",    "English",  300),
  r("MF146A", "Faron Sim",      "North",   "146A", "", "90000146", "faron.old@test.com",      "Mandarin", 400),
  r("MF147A", "Gina Chen",      "East",    "147A", "", "90000147", "gina.old@test.com",       "English",  500),
  r("MF148A", "Harry Yeo",      "Central", "148A", "", "90000148", "harry.old@test.com",      "Mandarin", 250),

  // ─── Contact mismatch (MF149A–MF152A) ───────────────────────────────────────
  // Master has old numbers; Pabbly sends new numbers → Review
  r("MF149A", "Elaine Yeo",     "West",    "149A", "", "81000149", "elaine.yeo@test.com",     "English",  150),
  r("MF150A", "Freddy Loh",     "South",   "150A", "", "81000150", "freddy.loh@test.com",     "Mandarin", 200),
  r("MF151A", "Gloria Tan",     "North",   "151A", "", "81000151", "gloria.tan@test.com",     "English",  300),
  r("MF152A", "Howard Ng",      "East",    "152A", "", "81000152", "howard.ng@test.com",      "Mandarin", 250),

  // ─── Region mismatch (MF153A–MF155A) ────────────────────────────────────────
  // Pabbly sends different region → Review
  r("MF153A", "Felix Ho",       "North",   "153A", "", "90000153", "felix.ho@test.com",       "English",  250),
  r("MF154A", "Isabella Lim",   "East",    "154A", "", "90000154", "isabella.lim@test.com",   "Mandarin", 350),
  r("MF155A", "Jeremy Wong",    "Central", "155A", "", "90000155", "jeremy.wong@test.com",    "English",  400),

  // ─── NRIC mismatch (MF156A–MF158A) ──────────────────────────────────────────
  // Master has one NRIC; Pabbly sends a different one → Review
  r("MF156A", "Gloria Sim",     "East",    "156A", "", "90000156", "gloria.sim@test.com",     "English",  350),
  r("MF157A", "Harvey Goh",     "West",    "157A", "", "90000157", "harvey.goh@test.com",     "Mandarin", 200),
  r("MF158A", "Irma Koh",       "South",   "158A", "", "90000158", "irma.koh@test.com",       "English",  300),

  // ─── Multiple mismatches (MF159A–MF161A) ────────────────────────────────────
  // 2+ fields differ between Pabbly and master → Review
  r("MF159A", "Harold Chen",    "West",    "159A", "", "90000159", "harold.old@test.com",     "English",  600),
  r("MF160A", "Jennifer Teo",   "North",   "160A", "", "81001600", "jennifer.teo@test.com",   "Mandarin", 400),
  r("MF161A", "Kenneth Ong",    "East",    "161A", "", "90000161", "kenneth.old@test.com",    "English",  300),

  // ─── MF autocorrected (MF162A–MF164A) ───────────────────────────────────────
  // Pabbly sends "162A" without "MF" prefix → auto-corrected → Update (with warning)
  r("MF162A", "Iris Koh",       "North",   "162A", "", "90000162", "iris.koh@test.com",       "Mandarin", 200),
  r("MF163A", "James Sim",      "East",    "163A", "", "90000163", "james.sim@test.com",      "English",  300),
  r("MF164A", "Karen Ho",       "Central", "164A", "", "90000164", "karen.ho@test.com",       "Mandarin", 400),

  // ─── NRIC-only match (MF165A–MF168A) ────────────────────────────────────────
  // Pabbly sends no MF number; matched by NRIC alone → Update
  r("MF165A", "James Loh",      "South",   "165A", "", "90000165", "james.loh@test.com",      "English",  300),
  r("MF166A", "Lily Tan",       "North",   "166A", "", "90000166", "lily.tan@test.com",       "Mandarin", 250),
  r("MF167A", "Michael Ng",     "East",    "167A", "", "90000167", "michael.ng@test.com",     "English",  500),
  r("MF168A", "Nancy Lim",      "Central", "168A", "", "90000168", "nancy.lim@test.com",      "Mandarin", 350),

  // ─── Additional pledge (MF169A–MF172A) ──────────────────────────────────────
  // Pabbly marks as additional; pledge amount stacks on existing → Update
  r("MF169A", "Kelly Ng",       "North",   "169A", "", "90000169", "kelly.ng@test.com",       "English",  800),
  r("MF170A", "Leo Wong",       "East",    "170A", "", "90000170", "leo.wong@test.com",       "Mandarin", 500),
  r("MF171A", "Mia Goh",        "Central", "171A", "", "90000171", "mia.goh@test.com",        "English",  400),
  r("MF172A", "Noah Koh",       "West",    "172A", "", "90000172", "noah.koh@test.com",       "Mandarin", 600),

  // ─── Error scenarios (MF173A–MF177A) ────────────────────────────────────────
  // MF173A: master email is blank; Pabbly also blank → MISSING_EMAIL
  ["MF173A", "Oliver Teo",     "South",   "173A", "", "90000173", "",               "English",  "250.00", 250, "", "", "", "", ""],
  // MF174A: master contact is blank; Pabbly also blank → MISSING_CONTACT
  ["MF174A", "Penny Ong",      "North",   "174A", "", "",         "penny.ong@test.com", "Mandarin", "300.00", 300, "", "", "", "", ""],
  // MF175A: Pabbly sends non-numeric phone → INVALID_PHONE
  r("MF175A", "Quinn Sim",      "East",    "175A", "", "90000175", "quinn.sim@test.com",      "English",  150),
  // MF176A: Pabbly sends 3-digit phone (too short) → INVALID_PHONE
  r("MF176A", "Rose Chen",      "Central", "176A", "", "90000176", "rose.chen@test.com",      "Mandarin", 200),
  // MF177A: Pabbly sends blank pledge → MISSING_PLEDGE
  r("MF177A", "Simon Yeo",      "West",    "177A", "", "90000177", "simon.yeo@test.com",      "English",  400),

  // ─── Extra rows not referenced by Pabbly CSV ────────────────────────────────
  r("MF178A", "Queenie Teo",    "South",   "178A", "", "90000178", "queenie.teo@test.com",    "English",  500),
  r("MF179A", "Ryan Loh",       "North",   "179A", "", "90000179", "ryan.loh@test.com",       "Mandarin", 600),
  r("MF180A", "Susan Tan",      "East",    "180A", "", "90000180", "susan.tan@test.com",      "English",  300),
  r("MF181A", "Tim Ng",         "Central", "181A", "", "90000181", "tim.ng@test.com",         "Mandarin", 400),
  r("MF182A", "Uma Lim",        "West",    "182A", "", "90000182", "uma.lim@test.com",        "English",  250),
  r("MF183A", "Victor Wong",    "South",   "183A", "", "90000183", "victor.wong@test.com",    "Mandarin", 350),
  r("MF184A", "Wendy Goh",      "North",   "184A", "", "90000184", "wendy.goh@test.com",      "English",  500),
  r("MF185A", "Xander Koh",     "East",    "185A", "", "90000185", "xander.koh@test.com",     "Mandarin", 150),
  r("MF186A", "Yolanda Teo",    "Central", "186A", "", "90000186", "yolanda.teo@test.com",    "English",  200),
  r("MF187A", "Zack Ong",       "West",    "187A", "", "90000187", "zack.ong@test.com",       "Mandarin", 300),
  r("MF188A", "Abby Sim",       "South",   "188A", "", "90000188", "abby.sim@test.com",       "English",  450),

  // ─── MF generation conflict tests ───────────────────────────────────────────
  // Both have NRIC 401A — same partial NRIC, which is why a new 401A person hits the same base MF.
  // First-time pledger Denny Foo (NRIC 401A): MF401A taken, MF401AA taken → gets MF401AB (Ref=B).
  r("MF401A",  "Aria Lim",      "North",   "401A", "",  "90000401", "aria.lim@test.com",      "English",  300),
  ["MF401AA", "Berry Tan",     "East",    "401A", "A", "90000402", "berry.tan@test.com",     "Mandarin", "250.00", 250, "", "", "", "", ""],

  // MF402A exists with NRIC 402A. First-time pledger Elsa Tan (NRIC 402A): MF402A taken → gets MF402AA (Ref=A).
  r("MF402A",  "Cara Wong",     "Central", "402A", "",  "90000403", "cara.wong@test.com",     "English",  200),
];

const wb = XLSX.utils.book_new();
const ws = XLSX.utils.aoa_to_sheet(rows);

ws["!cols"] = [
  { wch: 12 }, // MF number
  { wch: 18 }, // Full Name
  { wch: 10 }, // Region
  { wch: 14 }, // Partial NRIC
  { wch: 10 }, // Ref. No.
  { wch: 16 }, // Contact Number
  { wch: 30 }, // Email
  { wch: 10 }, // Service
  { wch: 14 }, // Pledge Amount
  { wch: 8  }, // MAR
  { wch: 8  }, // APR
  { wch: 8  }, // MAY
  { wch: 8  }, // JUN
  { wch: 8  }, // JUL
  { wch: 8  }, // AUG
];

XLSX.utils.book_append_sheet(wb, ws, "Master");

const outPath = path.join(__dirname, "../test-master.xlsx");
XLSX.writeFile(wb, outPath);
console.log(`✓ Written ${rows.length - 1} data rows to ${outPath}`);
