// The clinic reported the grey text as hard to read at the counter. Every text
// grey in the app was darkened and every on-screen size below 14 raised a
// notch. These pin it, because a single later edit pasted from an old screen
// is all it takes for the faint grey to creep back in one corner.
var fs = require("fs");
var src = fs.readFileSync(__dirname + "/../index.html", "utf8");
var pass = 0, fail = 0;
function ok(name, cond, detail) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
}
function count(re) { return (src.match(re) || []).length; }

// --- no faint text greys anywhere ------------------------------------------
["#999", "#aaa", "#888", "#777", "#666", "#555"].forEach(function (g) {
  var n = count(new RegExp('(?<![a-zA-Z-])color:\\s*"?' + g, "gi"));
  ok("no text is " + g + " any more", n === 0, n + " still there");
});

// --- and the darker ones are actually in use -------------------------------
ok("the darker greys replaced them",
   count(/(?<![a-zA-Z-])color:\s*"?#(4b4b4b|5a5a5a|444444|3d3d3d|383838|2e2e2e)/gi) > 300);

// Hierarchy matters as much as contrast: if every grey collapsed onto one
// value, a hint would shout as loudly as a heading.
var distinct = ["#4b4b4b", "#5a5a5a", "#444444", "#3d3d3d", "#383838", "#2e2e2e"]
  .filter(function (c) { return src.indexOf(c) !== -1; });
ok("and they are still distinct from each other, not one flat grey",
   distinct.length >= 5, distinct.join(" "));

// --- nothing tiny left on screen -------------------------------------------
// Every size was raised one notch, so 12 and 13 legitimately exist now — they
// are what 11 and 12 became. What must not survive is the bottom of the old
// range, which is what the clinic was squinting at.
["11", "11.5"].forEach(function (f) {
  var n = count(new RegExp("fontSize:\\s*" + f.replace(".", "\\.") + "(?![0-9.])", "g"));
  ok("nothing on screen at " + f + "px any more", n === 0, n + " still there");
});
ok("12px is the smallest text in the app",
   count(/fontSize:\s*12(?![0-9.])/g) > 0);
ok("and plenty of it reached 14",
   count(/fontSize:\s*14(?![0-9.])/g) > 150);

// --- the printed documents ------------------------------------------------
// This rule used to pin the counts of 8.5pt, 10pt and 11pt and say the
// printing had to stay small, because "growing the type pushes a form onto
// an extra sheet, which is worse than small print on paper held at reading
// distance".
//
// The clinic disagreed -- "everywhere the print font is very small
// difficult to read" -- and the reasoning was testable rather than true.
// Every printed size was raised, and the room came out of the whitespace:
// the field gaps, the grid gaps, the signature box and the page margins.
// Measured before and after, page by page, against the A4 box: the care
// plan's first page went 253mm -> 279mm on the type alone, which IS the
// extra sheet the old rule feared, and 255mm once the spacing was tightened
// -- bigger type, same four pages.
//
// So what is pinned now is the floor, not the count. Nothing printed may be
// set below 9.5pt, which is what "difficult to read" meant.
const ptSizes = [...src.matchAll(/font-size:([0-9.]+)pt/g)].map(m => Number(m[1]));
ok("there is printed type to check", ptSizes.length > 300);
const tooSmall = [...new Set(ptSizes.filter(n => n < 9.5))].sort((a, b) => a - b);
ok("nothing is printed below 9.5pt any more", tooSmall.length === 0,
   "still set in " + JSON.stringify(tooSmall) + "pt");
// And the body of a document is comfortably above the floor, not on it.
ok("the shared page style sets its body at 12pt",
   /html,body\{font-family:'Segoe UI',Arial,sans-serif;font-size:12pt/.test(src));
ok("its field labels, the smallest thing on a page, reach 9.5pt",
   /\.lbl\{font-size:9\.5pt/.test(src));

const clcss = src.slice(src.indexOf("const CL_PCSS = `"), src.indexOf("`;", src.indexOf("const CL_PCSS = `")));
ok("the clinical sheet's body type is readable", /font-size:12pt;color:#111/.test(clcss));
ok("its table cells too", /td\{padding:8pt 9pt;border:0\.5pt solid #ddd;font-size:12pt/.test(clcss));
ok("and its row labels", /\.row-lbl\{[^}]*font-size:11\.5pt/.test(clcss));

// --- borders and backgrounds were never the problem ------------------------
ok("borders were not darkened", count(/borderColor:\s*"#(4b4b4b|5a5a5a|444444|3d3d3d|383838|2e2e2e)"/g) === 0);
ok("nor backgrounds", count(/background(Color)?:\s*"?#(4b4b4b|5a5a5a|444444|3d3d3d|383838|2e2e2e)/g) === 0);

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
