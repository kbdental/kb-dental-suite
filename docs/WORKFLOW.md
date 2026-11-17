# How the app works

There is no `react.gs`, and there cannot be: React and `.gs` are the two
halves of this app and they run on different machines.

| | Where it runs | What it is | File |
|---|---|---|---|
| **React** | the dentist's browser | every screen | `index.html` |
| **`.gs`** | Google's servers | every read and write to the sheets | `apps-script/out/Code.gs` |

They never share code. They share one thing: a list of **158 action
names**. The browser asks for an action, the server answers it. That is
the whole contract.

---

## One round trip, end to end

Say the receptionist opens a patient.

**1. The screen asks.** A React component calls

```js
const res = await api("getPatient", { uhid: "AL1010" });
```

`api()` is in `index.html` (line ~650). It does not send anything yet.

**2. Reads are gathered up.** An action whose name starts with `get` is
*batchable*: it goes into a queue instead of onto the wire, and a timer of
zero milliseconds collects everything else asked for in the same tick. Six
components asking for six lists as the page draws become **one** request.

Two screens asking for the *same* thing with the *same* parameters get the
same promise — asked once, answered twice.

Writes are never batched. A half-applied batch of writes is a worse
problem than a slow page.

**3. It goes out.** `apiDirect()` builds `…/exec?action=getPatient&uhid=AL1010`.

- Under ~1800 characters: a `GET`, in the query string.
- Longer: a `POST` with the payload as a JSON body. A master list is sent
  as one JSON blob, so the longer the list the longer the URL — past a few
  thousand characters Apps Script refuses it outright. That is why saving
  got worse as the lists filled up.
- `text/plain` on the POST, deliberately: it keeps the request "simple",
  so there is no CORS preflight for Apps Script to fail to answer.

**4. Apps Script answers.** `doGet(e)` or `doPost(e)` — four lines each —
hand the parameters to `route(p)`, which checks the session where the
action needs one and then runs a 158-case `switch`.

**5. The case does the work.** `getPatient` opens the Registrations tab,
finds the row, returns `{ success: true, patient: {...} }` as JSON.

**6. Back in the browser**, the promise resolves and the component renders.

### Retries

Apps Script refuses a request outright now and then — mid-deployment, or
when enough executions overlap. It comes back as a 404 or a 5xx with
nothing having run.

- **Reads retry themselves**, three times, backing off 400 ms then 1.2 s.
- **Writes never retry.** A save that reached the sheet before the
  connection broke would be applied twice, and a duplicate payment is far
  worse than an error message.

---

## Where the data lives

Three spreadsheets, and the script is **bound to the first one**:

| File | Holds |
|---|---|
| PMS (the script's own container) | patients, appointments, the day book, every master list |
| Clinical | the clinical records and the work-done tabs |
| Finance | receipts, expenses, the FY tabs |

The clinical and finance IDs come from Script Properties, falling back to
`defaultSheetId_()`, which is why **a copy of the PMS keeps its records and
its money in itself**: copy the spreadsheet and you have a whole second
clinic, with no path back to the original. That is how the empanelled book
and the trial app both work.

---

## The clinical forms are not React

The 21 clinical forms (RCT, implant, crown, the prescription pad, the CRM,
the chatbot) are complete HTML documents carried **inside `index.html` as
base64**. At runtime:

```
base64  →  b64decode()  →  kbFormWithTail()  →  Blob  →  blob: URL  →  <iframe>
```

`kbFormWithTail()` appends shared markup and script before `</body>` at
blob-creation time. That is how all 21 forms gained a work-done sheet, a
step bar and a doctor list **without editing a single blob**.

A blob URL keeps the page's origin, so the form and the app share one
`localStorage` — which is why every key goes through `lsKey()`.

### The bridge

The form and the app talk by `postMessage`, never by function call.

**The app sends in** what the form needs: `KB_DOCTORS`, `KB_MEDICINES`,
`KB_MED_LISTS`, `KB_IMPLANT_BRANDS`, `KB_PAD_MARGINS`, `KB_CLINIC_NAME`,
`KB_TODAYS_PROCEDURES`, `KB_CLINICAL_RECORD`.

**The form sends out** what it has done: `KB_SAVE_RECORD`,
`KB_SAVE_CLINICAL_SHEET`, `KB_SAVE_PDF`, and the eight `KB_CRM_*`
messages. The app does the saving — the form never touches the backend —
and replies `KB_SAVE_RESULT` or `KB_SAVE_PDF_RESULT`.

So a save from a form is: **form → postMessage → app → `api()` → Apps
Script → sheet**, and the answer back along the same chain.

---

## One page, several clinics

`window.KB_INSTANCES` at the top of `index.html` maps an id to a backend.
`?clinic=empanelled` points the same page at the empanelled book. An
unknown id refuses to load rather than quietly becoming the main clinic —
that is how an empanelled patient would end up in the wrong book.

Both instances share a browser origin, so **every** `localStorage` key goes
through `lsKey()` / `scopedKey()`. A test fails if a new one does not.

The trial app (`trial/index.html`) is the same page generated with only a
trial instance in it, so it cannot address the clinic's data at all.

---

## Changing something

| To change | Edit | Then |
|---|---|---|
| a screen | `index.html` | bump `KB_APP_BUILD`, push |
| what a read or write does | `Code.gs` | paste into Apps Script, Deploy |
| a new action | both: a `case` in `route()`, an `api()` call in the page | deploy both |
| a clinical form's fields | the shared tail in `index.html`, not the blob | bump `KB_APP_BUILD` |
| a master list's contents | nothing — it is in the sheet, edited in Master | — |

There is **no build step**. `index.html` is the app: GitHub Pages serves
that file. (`trial/index.html` is generated — `npm run build:trial`.)

### The build markers

`KB_APP_BUILD` (page) and `BACKEND_BUILD` (server) both show in the
sidebar, so "did my change reach this browser" is answerable at a glance.
GitHub Pages caches `index.html` hard, so **bump `KB_APP_BUILD` on every
change to it** — without that, a change that shipped and a change that
never arrived look identical from both ends.

`KB_BACKEND_BUILD_REQUIRED` is separate: it is raised only when the page
genuinely cannot work without a new `Code.gs`, because a red "backend out
of date" for something merely nicer is the boy who cried wolf.

---

## The tests

`CHROME_PATH=/path/to/chromium node test/run-all.js` — 197 suites, about
nine minutes. Most of them **drive the real page in a headless browser**
rather than reading the source, because the bugs that have hurt here were
ones where the source looked right: a prop that was never declared, a
cached empty list, a sender with no caller.
