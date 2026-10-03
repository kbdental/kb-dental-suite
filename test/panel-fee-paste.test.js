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
// Real rows, as they come off the clinic's rate card: Code, Procedure,
// Classification, Rate.
const card = [
  "DI001\tIntraoral Periapical (IOPA) Radiograph X-ray/RVG(Single Film)\tDental Investigation\t200",
  "DP002\tScaling\tDental Procedure\t1000",
  "DP010\tExtraction - Normal Tooth\tDental Procedure\t400",
  "DP030\tRCT-Single Rooted tooth\tDental Procedure\t2000",
  "DP031\tRCT Multiple root and/ canal tooth\tDental Procedure\t3000",
  "DP069\tComplete Denture - Per Arch\tDental Procedure\t10000",
  "CN001\tConsultation OPD\tConsultation\t350",
].join("\n");

const got = parsePaste(card);
eq("every row on the card is read", got.length, 7);
eq("the code is the panel's own", got.map(r => r.code),
   ["DI001", "DP002", "DP010", "DP030", "DP031", "DP069", "CN001"]);

// The one that protects the money.
eq("the rate is read from every row", got.map(r => r.rate),
   [200, 1000, 400, 2000, 3000, 10000, 350]);

// Numbers inside a procedure name must never be mistaken for the rate.
eq("\"Up to 3 Teeth\" bills 4000, not 3",
   parsePaste("DP062\tRemovable Partial Denture - Cast Metal Up to 3 Teeth\tDental Procedure\t4000")[0].rate, 4000);
eq("\"upto 4 cms\" bills 5000, not 4",
   parsePaste("DP096\tCyst of Maxilla/mandible upto 4 cms under LA\tDental Procedure\t5000")[0].rate, 5000);

eq("the panel's own wording is kept", got[3].procedure, "RCT-Single Rooted tooth");
eq("and the classification with it", got[0].classification, "Dental Investigation");
eq("consultations classify as consultations", got[6].classification, "Consultation");

// A card pasted from a PDF carries headings, page numbers and repeated header
// rows. Those must be skipped rather than imported as rates.
const messy = [
  "CGHS rates for Tier I (X City)",
  "Code\tProcedure\tClassification\tRate",
  "",
  "DP002\tScaling\tDental Procedure\t1000",
  "38",
  "5-16/CGHS(HQ)/HEC/2024(PartI)",
].join("\n");
const m = parsePaste(messy);
eq("headings and page numbers are skipped", m.length, 1);
eq("and the one real row survives", m[0].code, "DP002");

// A rate written with a thousands separator must not become 2.
eq("a comma in a rate is not a decimal point",
   parsePaste("DP091\tOsteoplasty\tDental Procedure\t30,000")[0].rate, 30000);

// Multi-line procedure names wrap in the PDF; the fragment without a code is
// not a rate and must not be imported as one.
const wrapped = [
  "DP013\tMultiple Extraction and Treatment Procedures for Special Children,",
  "Patients with Systemic Diseases Which Requires Admission\tDental Procedure\t6000",
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
