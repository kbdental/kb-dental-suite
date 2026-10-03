// The paste importer reads a CGHS rate card straight off the PDF. It is the
// part of this feature that touches money: a misread column underclaims every
// row, and a misread code is a rejected claim. So it is tested against real
// lines from the actual card rather than invented ones.
//
// CGHS publishes three rate columns — Non-NABH, NABH, Super Speciality. K.B.
// Dental bills at NABH, the MIDDLE one. Taking the first number would
// underclaim on every single row and nobody would notice for months.
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/../index.html", "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
};
const eq = (name, got, want) =>
  ok(name, JSON.stringify(got) === JSON.stringify(want),
     "got " + JSON.stringify(got) + ", want " + JSON.stringify(want));

const a = src.indexOf("  const parsePaste = (text) => {");
const b = src.indexOf("\n  };", a) + 4;
const parsePaste = new Function(src.slice(a, b).replace("  const parsePaste = (text) =>", "return (text) =>"))();

// Real rows, as they come off the card: Sr No, Code, Procedure, Non-NABH,
// NABH, Super Speciality, Classification.
const card = [
  "741\tDI001\tIntraoral Periapical (IOPA) Radiograph X-ray/RVG(Single Film)\t170\t200\t200\tDental Investigation",
  "747\tDP002\tScaling\t850\t1000\t1000\tDental Procedure",
  "755\tDP010\tExtraction - Normal Tooth\t340\t400\t400\tDental Procedure",
  "775\tDP030\tRCT-Single Rooted tooth\t1700\t2000\t2000\tDental Procedure",
  "776\tDP031\tRCT Multiple root and/ canal tooth\t2550\t3000\t3000\tDental Procedure",
  "814\tDP069\tComplete Denture - Per Arch\t8500\t10000\t10000\tDental Procedure",
  "1\tCN001\tConsultation OPD\t350\t350\t350\tConsultation",
].join("\n");

const got = parsePaste(card);
eq("every row on the card is read", got.length, 7);
eq("the code is the panel's own", got.map(r => r.code),
   ["DI001", "DP002", "DP010", "DP030", "DP031", "DP069", "CN001"]);

// The one that protects the money.
eq("the NABH rate is taken, not the Non-NABH one", got.map(r => r.rate),
   [200, 1000, 400, 2000, 3000, 10000, 350]);
ok("so a scaling claims 1000, not 850", got[1].rate === 1000, String(got[1].rate));

eq("the panel's own wording is kept", got[3].procedure, "RCT-Single Rooted tooth");
eq("and the classification with it", got[0].classification, "Dental Investigation");
eq("consultations classify as consultations", got[6].classification, "Consultation");

// A card pasted from a PDF carries headings, page numbers and repeated header
// rows. Those must be skipped rather than imported as rates.
const messy = [
  "CGHS rates for Tier I (X City)",
  "Sr. No\tCGHS Code\tCGHS TREATMENT PROCEDURE/INVESTIGATION LIST\tNon-NABH\tNABH\tSuper Speciality",
  "",
  "747\tDP002\tScaling\t850\t1000\t1000\tDental Procedure",
  "38",
  "5-16/CGHS(HQ)/HEC/2024(PartI)",
].join("\n");
const m = parsePaste(messy);
eq("headings and page numbers are skipped", m.length, 1);
eq("and the one real row survives", m[0].code, "DP002");

// A rate written with a thousands separator must not become 2.
eq("a comma in a rate is not a decimal point",
   parsePaste("836\tDP091\tOsteoplasty\t25,500\t30,000\t30,000\tDental Procedure")[0].rate, 30000);

// A card that publishes one rate rather than three.
eq("a single-rate card takes that rate",
   parsePaste("12\tXX001\tSome procedure\t1450\tDental Procedure")[0].rate, 1450);

// Multi-line procedure names wrap in the PDF; the fragment without a code is
// not a rate and must not be imported as one.
const wrapped = [
  "758\tDP013\tMultiple Extraction and Treatment Procedures for Special Children,",
  "Patients with Systemic Diseases Which Requires Admission\t5100\t6000\t6000\tDental Procedure",
].join("\n");
const w = parsePaste(wrapped);
eq("a wrapped row is kept, not silently dropped", w.length, 1);
eq("with its code", w[0].code, "DP013");
eq("and the rate from the line it wrapped onto", w[0].rate, 6000);
ok("and both halves of the name joined up",
   /Multiple Extraction/.test(w[0].procedure) && /Requires Admission/.test(w[0].procedure),
   w[0].procedure);

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
