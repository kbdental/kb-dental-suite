// A merge conflict resolved with "git add -A" instead of by hand commits the
// markers themselves. That happened in this repo: conflict markers reached a
// pushed commit, and the only reason it was caught was that the file they
// landed in happened to be a test that then crashed.
//
// A marker in index.html or Code.gs would not crash a test. It would ship —
// to the clinic's live app, or into a Code.gs the clinic pastes and deploys.
// So every file is swept, every run.
const fs = require("fs");
const path = require("path");
const REPO = path.resolve(__dirname, "..");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
};

const SKIP = new Set(["node_modules", ".git", "dist", "build"]);
const EXT = /\.(js|gs|html|md|json|css|txt)$/i;

function walk(dir, out) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (EXT.test(e.name)) out.push(full);
  }
  return out;
}

const files = walk(REPO, []);
ok("there are files to check", files.length > 50, String(files.length));

// Anchored to the start of a line, which is where git writes them. A string
// containing "=======" mid-line is ordinary content, not a conflict.
const MARKER = /^(<{7} |={7}$|>{7} )/m;
const dirty = [];
files.forEach(f => {
  let text;
  try { text = fs.readFileSync(f, "utf8"); } catch (e) { return; }
  // This file names the markers in order to look for them.
  if (path.basename(f) === "no-conflict-markers.test.js") return;
  if (MARKER.test(text)) {
    const line = text.split(/\n/).findIndex(l => /^(<{7} |={7}$|>{7} )/.test(l)) + 1;
    dirty.push(path.relative(REPO, f) + ":" + line);
  }
});

ok("no file carries an unresolved merge conflict", dirty.length === 0, dirty.join("\n          "));

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
