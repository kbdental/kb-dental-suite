# K.B. Dental Clinical Suite — the complete setup guide

Everything needed to stand this up from the source, in one file. Nothing
below sends you to another document to finish a step.

- [1. What you are setting up](#1-what-you-are-setting-up)
- [2. Decide which backend](#2-decide-which-backend)
- [3. Route A — Apps Script and Google Sheets](#3-route-a--apps-script-and-google-sheets)
- [4. Route B — the Node server and PostgreSQL](#4-route-b--the-node-server-and-postgresql)
- [5. Serving the page](#5-serving-the-page)
- [6. First run — filling in Master](#6-first-run--filling-in-master)
- [7. Passwords](#7-passwords)
- [8. Proving it works](#8-proving-it-works)
- [9. Day to day: shipping a change](#9-day-to-day-shipping-a-change)
- [10. A second clinic, and a trial copy](#10-a-second-clinic-and-a-trial-copy)
- [11. How it works inside](#11-how-it-works-inside)
- [12. When something is wrong](#12-when-something-is-wrong)

---

## 1. What you are setting up

**There is nothing to build.** No `react.js`, no npm install, no bundler,
no `dist/`. The React is **inside `index.html`**, already compiled —
`React.createElement` calls rather than JSX — with React itself loaded
from a CDN by two `<script>` tags at the top of the file.

That one file is the whole front end. Put it on any web server and it
runs.

So the job is: **give that page a backend to talk to.**

| Piece | Is | Where it goes |
|---|---|---|
| `index.html` (3.2 MB) | every screen, and the 21 clinical forms inside it as base64 | any static web host |
| a backend | answers 158 named actions with JSON | Google's servers, or a PC you control |

Everything else in the repo — `test/`, `tools/`, `docs/`, `migration/` —
supports those two.

---

## 2. Decide which backend

The page asks for an action by name and expects JSON back:

```
GET  …/?action=getPatient&uhid=AL1010     →  {"success":true,"patient":{…}}
POST …/   {"action":"savePatient", …}     →  {"success":true}
```

158 action names, one contract. Anything that answers them will do. Two
things already do:

| | Runs on | Data in | Choose it for |
|---|---|---|---|
| **A. Apps Script** | Google's servers, free | Google Sheets | nothing to host, nothing to back up, the clinic can read its own data in a spreadsheet |
| **B. The Node server** | a PC you control | PostgreSQL | speed, real queries, working without internet |

**Start with A** unless you already know you want B. Moving later is one
line of configuration, and so is moving back — see §9.

---

## 3. Route A — Apps Script and Google Sheets

### 3.1 Make the spreadsheet

A new blank Google Sheet. Name it for the clinic.

**You do not need to create any tabs.** The backend creates each one the
first time it is used.

### 3.2 Put the backend in it

In that sheet: **Extensions → Apps Script**. Delete the stub `Code.gs`,
paste the whole of `apps-script/out/Code.gs` from this repo, and Save.

> The copy in this repo is a **reference copy for version history**.
> Nothing reads it. Editing it changes nothing anywhere — the code that
> runs is the copy inside Apps Script.

The script is now *bound* to that spreadsheet, which is what makes the
spreadsheet its own database. Remember this: it is why a copy of the
sheet becomes a whole separate clinic (§10).

### 3.3 Deploy it

**Deploy → New deployment → Web app**:

- Execute as: **Me**
- Who has access: **Anyone**

Copy the `/exec` URL it gives you.

> "Anyone" is what lets a browser call it at all. It does not make the
> spreadsheet public: everything runs as you, and only these 158 actions
> are reachable. What it *does* mean is that the URL is the only secret —
> so set a password before real patients go in (§7).

### 3.4 Point the page at it

Near the top of `index.html`:

```js
window.KB_LETTERHEAD = {name:"Your Clinic", address:"…", phone:"…",
                        mobiles:"…", email:"…"};

window.KB_INSTANCES = {
  main: {
    label: "Your Clinic",
    scriptUrl: KB_SERVER_URL || "https://script.google.com/macros/s/…/exec",
    clinic: window.KB_LETTERHEAD
  }
};
```

Replace the `scriptUrl` with yours, and the letterhead above it with the
clinic's own name, address and phone — **that is what prints on every
document the app produces**.

Then carry on at §5.

---

## 4. Route B — the Node server and PostgreSQL

The program in `server/` sits between the browser and PostgreSQL. It
speaks exactly what Apps Script speaks, so the app needs no change beyond
one line of configuration.

### 4.1 What the machine needs

- **PostgreSQL 16**
- **Node 18 or newer**

One npm dependency (`pg`). Everything else is Node's own. That is
deliberate: this has to keep running on a clinic PC maintained by people
who are not programmers, and every package added is something that can
need fixing on a Tuesday morning.

### 4.2 Install and run

```bash
cd server
npm install

createdb kbdental
psql -d kbdental -f ../database/schema.sql
psql -d kbdental -f ../database/002-api.sql

PGDATABASE=kbdental PGUSER=kb node src/server.js
```

It prints three lines, and the first is the one that matters:

```
[startup] every action the app calls is implemented
[startup] connected to kbdental
[startup] listening on 0.0.0.0:8080
```

If an action the app calls is missing, it is **named at startup** rather
than discovered by a receptionist mid-task.

### 4.3 Settings

| Variable | Default | What it is |
|---|---|---|
| `PGHOST` `PGPORT` `PGDATABASE` `PGUSER` `PGPASSWORD` | `localhost` `5432` `kbdental` `kb` | the database |
| `PORT` `HOST` | `8080` `0.0.0.0` | where it listens |
| `KB_ALLOWED_ORIGINS` | `https://kbdental.github.io,http://localhost:8000` | which pages may call it |
| `KB_DOCS_DIR` | `./documents` | where X-rays and scans are kept — **point the backup at this** |
| `KB_HTML_TO_PDF` | found automatically | a browser to print prescriptions with |
| `ANTHROPIC_API_KEY` | — | SOAP notes and the patient chatbot |

Add the address you serve the page from to `KB_ALLOWED_ORIGINS`, or the
browser will refuse the calls.

### 4.4 Point the page at it

The same line as §3.4, with `scriptUrl` set to `http://<that-pc>:8080/`.

### 4.5 Its own tests

They need a real PostgreSQL — nothing is mocked, because a constraint that
would refuse a write at the desk has to refuse it in the tests too.

```bash
createdb kbtest
psql -d kbtest -f ../database/schema.sql -f ../database/002-api.sql
PGDATABASE=kbtest node test/actions.test.js
```

**The suite empties the database it is pointed at. Never point it at the
clinic's own.**

---

## 5. Serving the page

Anything that serves a static file:

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

For the real thing, push the repo to GitHub and turn on Pages. The
`.nojekyll` file at the root is already there so Pages serves the file
untouched.

Opening `index.html` straight off the disk works too, though some browsers
restrict what a `file://` page may do.

---

## 6. First run — filling in Master

The app comes up empty. Everything it offers in a dropdown is a list in
**Master**, and there are three kinds:

1. **Lists that ship with a starting set** — the clinical note templates,
   the note plans, the examination findings. Each has a
   **"Load the clinic's N …"** button on its empty state. One press writes
   them into the database, and they are yours to rename, reorder and add
   to from then on.
2. **Lists that are the clinic's own** — doctors, employees, chairs,
   panels, payment modes, expense categories, the fee schedules. Typed in.
   Start with the doctors: every clinical form asks who treated the
   patient.
3. **The clinic profile** — name, address, print margins. Master → CLINIC.

Then, on **Route A only**, run **`setupClinicalRecordTabs`** once from the
Apps Script editor. It builds the flat clinical tabs (RCT, Implant
Surgery, Implant Prosthetic, Crown & Bridge) with their column headers, so
the work-done rows have somewhere to land.

---

## 7. Passwords

Nothing is enforced until you turn it on, and **the two routes store this
differently.**

### Route A — Apps Script

**Project Settings → Script Properties**:

| Property | What it does |
|---|---|
| `APP_PASSWORD` | the sign-in for the whole app |
| `REQUIRE_AUTH` | `true` to start enforcing it |
| `MASTER_PASSWORD` | gate on the Master screen |
| `REPORTS_PASSWORD_1`, `REPORTS_PASSWORD_2` | gate on Reports (either works) |
| `FINANCE_PASSWORD` | gate on Finance |
| `ANTHROPIC_API_KEY` | SOAP notes and the patient chatbot |
| `CLINICAL_SHEET_ID`, `FINANCE_SHEET_ID` | keep clinical records / money in another spreadsheet |

Leave `REQUIRE_AUTH` unset while you are setting up, or you will lock
yourself out of a half-configured app.

Unset, `CLINICAL_SHEET_ID` and `FINANCE_SHEET_ID` mean a book keeps its
clinical records and its money **in itself** — which is exactly why
copying the spreadsheet gives a whole second clinic with no path back to
the first.

### Route B — the server

Settings live in the `clinic_settings` table, and passwords are **stored
hashed**, so reading the database does not hand somebody the password.

Make a hash:

```bash
node -e "const c=require('crypto');const s=c.randomBytes(16).toString('hex');
console.log('scrypt\$'+s+'\$'+c.scryptSync(process.argv[1],s,32).toString('hex'))" 'your password'
```

Then store it, and turn enforcement on:

```sql
INSERT INTO clinic_settings (key, value) VALUES
  ('app_password', '"scrypt$…the string above…"'),
  ('require_auth', 'true')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;
```

(`value` is `jsonb`, hence the quotes inside the quotes.) Repeated wrong
passwords from one place are made to wait — anyone on the clinic's WiFi
could otherwise try them as fast as the server answers.

### Either route

**Turn authentication on before the app holds a real patient.** Until you
do, the URL is the only thing between a stranger and the records.

---

## 8. Proving it works

- The sidebar shows the **backend's build** and the **page's build**. If
  the backend reads *not connected*, the `scriptUrl` is wrong, or the
  deployment is not set to "Anyone", or (Route B) the page's address is
  missing from `KB_ALLOWED_ORIGINS`.
- **Register a patient.** On Route A a **Registrations** tab appears in
  the spreadsheet with a row in it; on Route B the `patients` table gains
  one. That proves the whole chain: page → action → backend → database.
- Open a clinical form and save it. That proves the second chain, which
  runs differently (§11).

### The app's own tests

```bash
CHROME_PATH=/path/to/chromium node test/run-all.js
```

197 suites, about nine minutes. Most of them **drive the real page in a
headless browser** rather than reading the source, because the bugs that
have hurt here were the ones where the source looked right: a prop that
was never declared, a cached empty list, a sender with no caller.

---

## 9. Day to day: shipping a change

| To change | Edit | Then |
|---|---|---|
| a screen | `index.html` | bump `KB_APP_BUILD`, publish the file |
| what a read or write does | `Code.gs` (A) or `server/src/` (B) | paste + **redeploy** (A), or restart (B) |
| a new action | both: a `case` in `route()`, an `api()` call in the page | deploy both |
| a clinical form's fields | the shared tail in `index.html`, **not the base64 blob** | bump `KB_APP_BUILD` |
| a master list's contents | nothing — it is data, edited in Master | — |

### The build markers

`KB_APP_BUILD` (in `index.html`) and `BACKEND_BUILD` (in the backend) both
show in the sidebar, so "did my change reach this browser" is answerable
at a glance.

**Bump `KB_APP_BUILD` on every change to the page.** GitHub Pages caches
`index.html` hard; without the marker, a change that shipped and a change
that never arrived look identical from both ends.

`KB_BACKEND_BUILD_REQUIRED` is separate, and raised only when the page
genuinely cannot work without a new backend — a red "backend out of date"
for something merely nicer is the boy who cried wolf.

### Switching backends

`scriptUrl` is configuration, not code. Point it at a `/exec` URL and you
are on Sheets; point it at `http://…:8080/` and you are on PostgreSQL. The
app cannot tell the difference, and the move back is the same one line.

---

## 10. A second clinic, and a trial copy

### Another clinic, sharing the page

1. **File → Make a copy** of the PMS spreadsheet. This copies every tab
   *and* the bound Apps Script, so the copy already has the full backend.
2. In the copy: **Deploy → New deployment → Web app** → copy the `/exec`
   URL.
3. Add it to `KB_INSTANCES` in `index.html`:

```js
empanelled: {
  label: "Empanelled — CGHS / DGEHS",
  badge: "EMPANELLED", badgeColor: "#7C3AED",
  scriptUrl: "https://script.google.com/macros/s/…/exec",
  clinic: window.KB_LETTERHEAD
}
```

`?clinic=empanelled` now opens that book. An unknown id refuses to load
rather than quietly becoming the main clinic — that is how a patient ends
up in the wrong book.

Both instances share one browser origin, so **every `localStorage` key
goes through `lsKey()` / `scopedKey()`**. A test fails if a new one does
not.

### A trial copy with no patients in it

For handing to somebody to try:

1. Copy the spreadsheet as above.
2. In the copy's Apps Script, run **`emptyThisCopyForTrial`**. It keeps
   the master lists by name and clears everything else — patients,
   appointments, the day book, care plans, documents, bills, and the
   doctors' signature images. It refuses to run on the clinic's own books,
   by ID.
3. Deploy the copy, and paste its `/exec` URL into `trial/config.js`.

`trial/index.html` is generated from `index.html` by
`node tools/build-trial.js` (or `npm run build:trial`) and carries **only**
the trial backend, so that page cannot reach the clinic's data however the
address bar is edited. A test regenerates it and compares byte for byte,
so it cannot drift behind the app.

---

## 11. How it works inside

Enough to maintain it.

### One round trip

1. A component calls `api("getPatient", { uhid: "AL1010" })`.
2. **Reads are gathered up.** An action starting with `get` goes into a
   queue; a zero-millisecond timer collects everything else asked for in
   the same tick. Six components asking for six lists become **one**
   request. Two screens asking for the same thing with the same
   parameters get the same promise.
3. **Writes are never batched.** A half-applied batch of writes is a worse
   problem than a slow page.
4. Under ~1800 characters it goes as a `GET` in the query string; longer,
   as a `POST` with a JSON body — a master list is one JSON blob, and past
   a few thousand characters Apps Script refuses the URL outright. The
   POST is `text/plain` so there is no CORS preflight for Apps Script to
   fail to answer.
5. `doGet`/`doPost` hand the parameters to `route(p)`, which checks the
   session where the action needs one and runs a 158-case `switch`.
6. **Reads retry themselves**, three times. **Writes never retry** — a
   save that reached the database before the connection broke would be
   applied twice, and a duplicate payment is far worse than an error
   message.

### The clinical forms are not React

The 21 forms — RCT, implant, crown, the prescription pad, the CRM, the
chatbot — are complete HTML documents carried **inside `index.html` as
base64**:

```
base64 → b64decode() → kbFormWithTail() → Blob → blob: URL → <iframe>
```

`kbFormWithTail()` appends shared markup and script before `</body>` at
blob-creation time. That is how all 21 gained a work-done sheet, a step
bar and a doctor list **without editing a single blob**.

They talk to the app by `postMessage`, never by function call. The app
sends in what the form needs (`KB_DOCTORS`, `KB_MEDICINES`,
`KB_PAD_MARGINS`, …) and the form sends out what it has done
(`KB_SAVE_RECORD`, `KB_SAVE_CLINICAL_SHEET`, `KB_SAVE_PDF`, the `KB_CRM_*`
messages). **The app does the saving; the form never touches the
backend.**

A blob URL keeps the page's origin, which is the other reason every
`localStorage` key is scoped.

### Where the data lives (Route A)

Three spreadsheets, and the script is bound to the first:

| File | Holds |
|---|---|
| PMS (the script's own container) | patients, appointments, the day book, every master list |
| Clinical | clinical records and the work-done tabs |
| Finance | receipts, expenses, the FY tabs |

The clinical and finance IDs come from Script Properties, falling back to
"this same file".

---

## 12. When something is wrong

Two ways to waste an afternoon, both already paid for on this project:

- **A deployed page is not a refreshed one.** `index.html` caches hard.
  Hard-refresh (Ctrl+Shift+R) and check `KB_APP_BUILD` in the sidebar
  before concluding a change did not work.
- **A saved script is not a deployed one.** Pasting into the Apps Script
  editor and saving changes nothing until
  **Deploy → Manage deployments → New version**.

| Symptom | Usually |
|---|---|
| sidebar says *not connected* | wrong `scriptUrl`; deployment not "Anyone"; (B) origin not in `KB_ALLOWED_ORIGINS` |
| every screen empty, no error | the backend is answering but the lists have not been loaded — §6 |
| a form opens blank | the form's blob failed to build; check the browser console |
| saves work, nothing in the sheet | you are looking at the wrong spreadsheet — check `CLINICAL_SHEET_ID` |
| "AUTH_REQUIRED" everywhere | `REQUIRE_AUTH` is on and no password is set, or the session expired |
| a change is live for you, not for them | their browser has the old `index.html` — compare the build in the sidebar |

### Where the deeper detail is

This file is complete on its own. For more than it covers:
`docs/WORKFLOW.md` (the internals at length), `server/README.md` (the
server's own layout), `HANDOVER.md` (how *this* clinic's deployment
stands), `trial/README.md`.
