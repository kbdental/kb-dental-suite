// Builds trial/index.html from index.html.
//
// The trial is the same app with no patients in it: a second Google
// spreadsheet of its own, master lists filled in, patient and money tabs
// empty. It is given out on its own link.
//
// Why a generated copy rather than a ?clinic=trial on the clinic's own
// page: today the URL is the only thing standing between a stranger and
// the live patient list -- only Master and Reports ask for a password --
// so a trial link that differs from the clinic's by one query parameter
// hands over the clinic's address too. This page carries ONE instance and
// does not know the clinic's /exec URL at all, so there is no way back to
// the real book from it.
//
// It differs from index.html in exactly three places, each asserted below,
// and a test regenerates it and compares byte for byte -- so the two can
// never drift, and nothing here is a second copy of the app to maintain.
const fs = require("fs");
const path = require("path");

const REPO = path.resolve(__dirname, "..");
const SRC = path.join(REPO, "index.html");
const OUT_DIR = path.join(REPO, "trial");
const OUT = path.join(OUT_DIR, "index.html");

// The one instance this page has. Its backend URL is NOT written in here:
// it is read from trial/config.js, so pointing the trial at a new copy of
// the spreadsheet is a three-line file to edit rather than a 3 MB one to
// rebuild.
const TRIAL_INSTANCES = `window.KB_INSTANCES = {
  // The only instance this page has. The clinic's own books are not listed
  // here and their /exec URLs appear nowhere in this file, so this page
  // cannot reach them however the query string is edited.
  trial: {
    label: "Trial \\u2014 sample clinic",
    badge: "TRIAL",
    badgeColor: "#B45309",
    // Set in trial/config.js. Empty until the trial spreadsheet has been
    // copied and deployed, and an instance with no backend refuses to run
    // rather than falling through to another book.
    scriptUrl: (typeof window.KB_TRIAL_SCRIPT_URL === "string" && window.KB_TRIAL_SCRIPT_URL) || "",
    clinic: window.KB_LETTERHEAD
  }
};`;

const CONFIG_TAG = '<script src="./config.js"></script>\n';

function build() {
  const src = fs.readFileSync(SRC, "utf8");
  let out = src;

  const apply = (what, find, replace) => {
    const n = out.split(find).length - 1;
    if (n !== 1) throw new Error(what + ": expected 1 occurrence in index.html, found " + n);
    out = out.replace(find, replace);
  };

  // 1. One instance instead of two.
  const a = out.indexOf("window.KB_INSTANCES = {");
  const b = out.indexOf("\n};", a);
  if (a < 0 || b < 0) throw new Error("the instance list is not where it was");
  out = out.slice(0, a) + TRIAL_INSTANCES + out.slice(b + "\n};".length);

  // 2 and 3. No query string means the trial, the way no query string means
  // the main clinic on the clinic's own page. "main" is not an instance
  // here, so a page that still defaulted to it would refuse to open.
  apply("the default instance", 'var id = "main";', 'var id = "trial";');
  apply("the query-string fallback", '.get("clinic") || "main";', '.get("clinic") || "trial";');

  // The backend URL, loaded before anything reads it.
  apply("the config script", "<script>\n// ── Instances ─", CONFIG_TAG + "<script>\n// ── Instances ─");

  // Nothing of the clinic's own backend may survive into this file.
  const leaked = [...src.matchAll(/AKfycb[A-Za-z0-9_-]+/g)].map(m => m[0])
    .filter(u => out.indexOf(u) >= 0);
  if (leaked.length) throw new Error("the clinic's own /exec URL reached the trial page: " + leaked.join(", "));

  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(OUT, out);
  return out;
}

if (require.main === module) {
  build();
  console.log("trial/index.html written, " + fs.statSync(OUT).size + " bytes");
}
module.exports = { build, TRIAL_INSTANCES, OUT, SRC };
