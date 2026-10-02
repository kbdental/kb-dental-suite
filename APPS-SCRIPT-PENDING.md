# Apps Script — nothing pending for the main PMS book

Everything that used to be listed here is live in **K. B. DENTAL SUITE - PMS**,
confirmed 2 Oct 2026:

- **The batched read** (`batchRead_` and `case "batch"`) — deployed. The Master
  page makes one request instead of eighteen.
- **No built-in chairs** — `getChairsList` no longer invents Chair 1-4 when the
  tab is empty, so a chair deleted in Master stays deleted.
- **One doctors list** — `getDoctorsList` and `saveDoctorsList` are gone from
  `Code.gs`, and the `Doctors` tab is deleted. **Doctor Details** is the only
  list, holding resident and visiting doctors together.

The functions had to go before the tab could: `getSheet()` creates any tab it
is asked for, so deleting `Doctors` while the old code was deployed only lasted
until the next call.

The maintenance scripts that did this work stay in `apps-script/maintenance/`
for reference and for seeding a future instance. **Do not run them again** on
the main book.

---

## KB Dental — PMS Empaneled: parked

That book carries the same stray paste artifact the main book had — a bare line
reading `javascript`, left over from a fenced code block — in `Code.gs`. It has
not been cleaned or redeployed.

It is deliberately on hold until the panel structure is designed: the panel
registration fields, the separate book for panel patients, and the panel fee
schedule. Doctors, payment modes and chairs are shared with the main book and
do not change for panels.

The front-end screens for it are written and tested but ship dark behind
`PANEL_UI_READY = false` in `index.html`, so registration starts as a normal
patient. Flip that flag the day a panel registration can actually save.
