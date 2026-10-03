// Apps Script refuses a request outright now and then — while a deployment is
// being updated, or when enough executions overlap for one user. Nothing has
// run; it is a 404 or a 5xx and the next attempt usually succeeds. The clinic
// saw it as "Could not load blocked slots … Please retry", which is a
// receptionist doing the computer's job in front of a patient.
//
// Reads retry themselves. Writes deliberately do not: a save that reached the
// sheet before the connection broke would be applied twice, and a duplicate
// payment is far worse than an error message. This runs the real apiDirect
// against a fake fetch to hold that line.
const fs = require("fs");
const src = fs.readFileSync(__dirname + "/../index.html", "utf8");
let pass = 0, fail = 0;
const ok = (name, cond, detail) => {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name + (detail ? "\n          " + detail : "")); }
};

const a = src.indexOf("async function apiDirect(action");
const b = src.indexOf("\n}", src.indexOf("console.error(\"API:\"", a)) + 2;
const code = src.slice(a, b) + "\nreturn apiDirect;";

function build(responder) {
  const calls = [];
  const fetch = url => {
    calls.push(url);
    const r = responder(calls.length);
    return r instanceof Error ? Promise.reject(r)
      : Promise.resolve({ ok: r === 200, status: r, json: () => Promise.resolve({ success: true, n: calls.length }) });
  };
  const fn = new Function("fetch", "SCRIPT_URL", "getSessionToken", "handleAuthFailure",
                          "URLSearchParams", "console", code)(
    fetch, "https://script.example/exec", () => "tok", r => r, URLSearchParams,
    { error: () => {} });
  return { fn, calls };
}

const chain = [];

chain.push(async () => {
  const { fn, calls } = build(n => (n < 3 ? 404 : 200));
  const res = await fn("getBlockedSlots", { date: "2026-10-03" });
  ok("a read that 404s twice still succeeds", res.success === true, JSON.stringify(res));
  ok("after exactly three attempts", calls.length === 3, calls.length);
});

chain.push(async () => {
  const { fn, calls } = build(() => 500);
  const res = await fn("getAllPatients");
  ok("a read that never recovers gives up", res.success === false);
  ok("reporting the real status, not a guess", /HTTP 500/.test(res.error), res.error);
  ok("and does not retry forever", calls.length === 3, calls.length);
});

chain.push(async () => {
  const { fn, calls } = build(n => (n < 2 ? new Error("network down") : 200));
  const res = await fn("batch", { actions: '["getA"]' });
  ok("a dropped connection on a batch is retried too", res.success === true);
  ok("and the batch is one of the retryable actions", calls.length === 2, calls.length);
});

// The one that matters most.
chain.push(async () => {
  const { fn, calls } = build(() => 404);
  const res = await fn("saveRegistration", { uhid: "AL1001" });
  ok("a WRITE is never retried", calls.length === 1, calls.length);
  ok("and the failure is reported honestly", res.success === false && /HTTP 404/.test(res.error), res.error);
});

chain.push(async () => {
  const { fn, calls } = build(() => 500);
  await fn("savePayment", { amount: "500" });
  ok("a payment is never sent twice", calls.length === 1, calls.length);
});

chain.push(async () => {
  const { fn, calls } = build(() => 200);
  await fn("getAllPatients");
  ok("a read that works first time makes one request", calls.length === 1, calls.length);
});

(async () => {
  for (const t of chain) await t();
  console.log("==============================================================================");
  console.log("  " + pass + " passed, " + fail + " failed");
  console.log("==============================================================================");
  process.exit(fail ? 1 : 0);
})();
