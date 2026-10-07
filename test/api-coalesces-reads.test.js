// A refresh used to make one HTTPS request per list. Apps Script charges about
// a second of start-up for each and caps how many run at once for one user, so
// a screen asking for a dozen lists spent its time queueing, not fetching.
//
// Batching was added once, for the Master page, and left the other 150-odd
// call sites untouched — which is why the clinic still saw a slow refresh after
// the "fix". The coalescing now lives inside api() itself so every call site
// gets it without being edited. These tests pin that: that it is api() doing
// it, that writes are excluded, and that a backend without the batch action
// still answers every caller.
var fs = require("fs");
var src = fs.readFileSync(__dirname + "/../index.html", "utf8");
var pass = 0, fail = 0;
function ok(name, cond) {
  if (cond) { pass++; console.log("  PASS  " + name); }
  else { fail++; console.log("  FAIL  " + name); }
}

ok("the raw request is its own function", /async function apiDirect\(action/.test(src));
ok("and api() is the one that queues", /function api\(action, data = \{\}\) \{/.test(src));
ok("reads are collected into a queue", /_batchQueue\.push\(\{\n    key, action, data, resolve, promise,/.test(src));
ok("and flushed in one tick", /_batchTimer = setTimeout\(flushBatch, 0\)/.test(src));

ok("writes never batch", /action\.indexOf\("get"\) === 0/.test(src));
// Reads carrying parameters now batch too. Excluding them was the mistake:
// every read naming a patient or a date still made its own request, and those
// are most of what a clinic screen asks for.
ok("a read carrying parameters batches as well",
   /const batchable = action !== "batch" && action\.indexOf\("get"\) === 0;/.test(src));
ok("and its parameters travel with it", /entry: \{ key, action, params: data \}/.test(src));
ok("the backend keeps action and token as its own",
   /if \(k !== "action" && k !== "token"\) payload\[k\] = entry\.params\[k\];/
     .test(fs.readFileSync(__dirname + "/../apps-script/out/Code.gs", "utf8")));
ok("and batch cannot batch itself", /action !== "batch"/.test(src));

// The parameters are part of the key: two patients are not the same read.
ok("the same read asked for twice is one request",
   /_batchQueue\.find\(q => q\.key === key\)/.test(src));
ok("and the key includes the parameters",
   /const key = action \+ "\|" \+ JSON\.stringify\(data\);/.test(src));
ok("and both callers get the same answer", /return already\.promise/.test(src));

ok("a batch is capped", /KB_BATCH_MAX = 25/.test(src));
ok("and a longer queue is split, not dropped",
   /for \(let i = 0; i < queue\.length; i \+= KB_BATCH_MAX\)/.test(src));

ok("an old backend still answers every caller, parameters and all",
   /chunk\.forEach\(q => apiDirect\(q\.action, q\.data\)\.then\(q\.resolve\)\)/.test(src));
ok("and a missing result is an error, not a silent undefined",
   /missing from batch/.test(src));

console.log("==============================================================================");
console.log("  " + pass + " passed, " + fail + " failed");
console.log("==============================================================================");
process.exit(fail ? 1 : 0);
