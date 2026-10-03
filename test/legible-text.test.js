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

// --- the printed forms are deliberately untouched --------------------------
// Those are page layouts. Growing the type pushes a consent form onto an extra
// sheet, which is a worse problem than small print on paper the patient holds
// in their hand at reading distance.
ok("the printed forms keep their 8.5pt", count(/font-size:8\.5pt/g) === 30);
ok("and their 10pt", count(/font-size:10pt/g) === 45);
ok("and their 11pt", count(/font-size:11pt/g) === 14);

// --- borders and backgrounds were never the problem ------------------------
ok("borders were not darkened", count(/borderColor:\s*"#(4b4b4b|5a5a5a|444444|3d3d3d|383838|2e2e2e)"/g) === 0);
ok("nor backgrounds", count(/background(Color)?:\s*"?#(4b4b4b|5a5a5a|444444|3d3d3d|383838|2e2e2e)/g) === 0);

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
