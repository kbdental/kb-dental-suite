# Setting it up from the source

There is no `react.js` to find, and nothing to build. The React is
**inside `index.html`**, already compiled — `React.createElement` calls, not
JSX — with React itself loaded from a CDN by two `<script>` tags at the top
of the file. No npm install, no bundler, no `dist/`. That file *is* the
front end: put it on any web server and it runs.

So setting this up is one job only: **giving that page a backend to talk
to.**

---

## What a backend has to be

The page asks for an action by name and expects JSON back:

```
GET  …/?action=getPatient&uhid=AL1010      →  {"success":true,"patient":{…}}
POST …/   {"action":"savePatient", …}      →  {"success":true}
```

158 action names, one contract. Anything that answers them will do. Two
things already do.

| | Runs on | Data in | Good for |
|---|---|---|---|
| **A. Apps Script** | Google's servers, free | Google Sheets | what the clinic runs; nothing to host or back up |
| **B. The Node server** | a PC you control | PostgreSQL | speed, real queries, working offline |

Start with **A** unless you already know you want B. Moving between them
later is one line of configuration — see the end.

---

## Route A — Apps Script and Google Sheets

**1. Make the spreadsheet.** A new blank Google Sheet. Name it for the
clinic. You do not need to create any tabs: the backend creates each one
the first time it is used.

**2. Put the backend in it.** In that sheet: **Extensions → Apps Script**.
Delete the stub `Code.gs` and paste the whole of
`apps-script/out/Code.gs` from this repo. Save.

> The copy in this repo is a **reference copy for version history**.
> Nothing reads it. Editing it changes nothing anywhere — the code that
> runs is the copy inside Apps Script.

**3. Deploy it.** **Deploy → New deployment → Web app**:

- Execute as: **Me**
- Who has access: **Anyone**

Copy the `/exec` URL it gives you.

> "Anyone" is what lets a browser call it at all; it does not make the
> sheet public. Everything still runs as you, and only these 158 actions
> are reachable. See **Passwords** below for what to turn on.

**4. Point the page at it.** Near the top of `index.html`:

```js
window.KB_INSTANCES = {
  main: {
    label: "Your Clinic",
    scriptUrl: KB_SERVER_URL || "https://script.google.com/macros/s/…/exec",
    clinic: window.KB_LETTERHEAD
  }
};
```

Replace the `scriptUrl`, and `window.KB_LETTERHEAD` just above it with the
clinic's own name, address and phone — that is what prints on every
document.

**5. Serve the page.** Anything that serves a static file:

```bash
python3 -m http.server 8000      # then open http://localhost:8000
```

For the real thing, push the repo to GitHub and turn on Pages (the
`.nojekyll` file at the root is already there so Pages serves it
untouched). Opening `index.html` straight off the disk works too, but some
browsers restrict `file://` pages.

**6. First run.** The app comes up empty. Fill it in through **Master**:

- Each list that ships with a starting set — clinical note templates, the
  note plans, the examination — has a **"Load the clinic's N …"** button on
  its empty state. One press writes them into the sheet, and they are
  yours to edit from then on.
- The rest — doctors, chairs, payment modes, panels, the fee schedules —
  are typed in. They are the clinic's own.
- Then run **`setupClinicalRecordTabs`** once from the Apps Script editor.
  It builds the flat clinical tabs with their column headers.

---

## Route B — your own server and PostgreSQL

`server/README.md` has this in full. In short:

```bash
cd server && npm install
createdb kbdental
psql -d kbdental -f ../database/schema.sql
psql -d kbdental -f ../database/002-api.sql
PGDATABASE=kbdental PGUSER=kb node src/server.js
```

It prints three lines, and the first is the one that matters:

```
[startup] every action the app calls is implemented
```

If an action the app calls is missing it is **named at startup**, rather
than found by a receptionist mid-task.

Then point the page at `http://<that-pc>:8080/` the same way as above, and
add the page's own address to `KB_ALLOWED_ORIGINS` so it is allowed to
call in.

PostgreSQL 16 and Node 18+, one npm dependency (`pg`). That is deliberate:
it has to keep running on a clinic PC maintained by people who are not
programmers.

---

## Passwords

Nothing is enforced until you set it, in Apps Script under
**Project Settings → Script Properties**:

| Property | What it does |
|---|---|
| `APP_PASSWORD` | the sign-in for the whole app |
| `REQUIRE_AUTH` | `true` to start enforcing it |
| `MASTER_PASSWORD` | gate on the Master screen |
| `REPORTS_PASSWORD_1`, `_2` | gate on Reports (either works) |
| `FINANCE_PASSWORD` | gate on Finance |
| `ANTHROPIC_API_KEY` | SOAP notes and the patient chatbot |

Leave `REQUIRE_AUTH` unset while you are setting up, or you will lock
yourself out of a half-configured app. **Set it before the app holds a real
patient:** until you do, the URL is the only thing between a stranger and
the records.

Two more properties move where data is kept: `CLINICAL_SHEET_ID` and
`FINANCE_SHEET_ID`. Unset, a book keeps its clinical records and its money
**in itself** — which is why copying the spreadsheet gives you a whole
second clinic with no path back to the first.

---

## Did it work

- The sidebar shows the backend's build and the page's build. If the
  backend reads **not connected**, the `scriptUrl` is wrong or the
  deployment is not "Anyone".
- Register a patient. A **Registrations** tab appears in the spreadsheet
  with a row in it. That is the whole chain proven: page → action →
  backend → sheet.

Two ways to waste an afternoon, both already paid for here:

- **A deployed page is not a refreshed one.** `index.html` caches hard.
  Hard-refresh (Ctrl+Shift+R) before concluding a change did not work —
  that is what `KB_APP_BUILD` in the sidebar is for.
- **A saved script is not a deployed one.** Pasting into the Apps Script
  editor and saving changes nothing until **Deploy → Manage deployments →
  New version**.

---

## Changing your mind later

`scriptUrl` is configuration, not code. Point it at a `/exec` URL and you
are on Sheets; point it at `http://…:8080/` and you are on PostgreSQL. The
app does not know the difference, and the move back is the same one line.
