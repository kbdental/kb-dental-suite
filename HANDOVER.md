# Handover — where things stand

Written so a fresh session, on any account, can pick this up without the prior
chat. Everything below is verifiable from the repo and the live sheet; nothing
depends on conversation history.

Branch: `claude/kb-dental-sheet-structure-mlfjr0`. Fully merged to `main` as of
`650a658` — the branch and `main` are level, nothing is in flight.

## How this system is deployed — the thing to understand first

Two halves, in two places, with different rules:

| Part | Lives in | Deploys by | Who can change it |
| --- | --- | --- | --- |
| `index.html` — the whole app UI | GitHub | merge to `main` → GitHub Pages | Claude, via PR |
| `Code.gs` — the backend | Apps Script bound to the PMS sheet | Deploy → Manage deployments → **New version** | The clinic only |

`apps-script/out/Code.gs` in this repo is a **reference copy for version
history**. Nothing reads it. Editing it changes nothing in the clinic.

Two failure modes that have already cost real time:

- **A merged PR is not a deployed change.** GitHub Pages takes a minute or two,
  and `index.html` caches hard — a normal refresh serves the old file. Always
  hard-refresh (Ctrl+Shift+R) before concluding a fix did not work.
- **A `Code.gs` paste without the redeploy does nothing.** Saving in the editor
  is not deploying.

Live app: https://kbdental.github.io/kb-dental-suite/
PMS sheet: https://docs.google.com/spreadsheets/d/1DtoZ3MNFq2Enr-ClAjENWFzk8SF2dYN9e1nGf7tAJC4/edit

## Open, waiting on the clinic

1. **`APPS-SCRIPT-PENDING.md` — the three `Code.gs` changes.** As of the last
   check: item 1 (`getNextUHID`) was already applied, item 2 (Clinical Sheets)
   was pasted and saved, item 3 (Implant Brands) was in progress. **The redeploy
   had not happened yet.** Confirm state by searching the live `Code.gs` for
   `CLINICAL_SHEET_TABS` and `getImplantBrandsList` before assuming anything.
2. **After deploying**, run `migrateClinicalSheetsToOwnTabs` from the Apps Script
   editor. Copies only, deletes nothing, safe to re-run, optional.
3. **Master → Clinic → Implant Brands & Sizes** starts empty. The clinic enters
   the brands and sizes it actually stocks. The built-in list is a fallback that
   only applies until the first brand is added.
4. **`findOrphanRegistrations`** (in `restore-missing-registration.gs`, already
   in the Apps Script project) has not been run. Read-only. It lists any patient
   in AL0808's position — treated, but missing from Registrations.

## Verified this session

- Printed WD-02 / WD-03 work-done sheets render correctly: single-page A4,
  ~115mm spare, no page errors. Not yet compared against the physical pad by
  the clinic.
- AL0808 (Dr Garima Chahal) restored to Registrations, marked `Incomplete` —
  address, DOB, medical history and consent still need collecting at the desk.

## Conventions worth keeping

- **Clinical forms are base64 blobs** inside `index.html` (`RCT_FORM_B64`,
  `IMP_SURGERY_B64`, `CROWN_BRIDGE_B64`, `IMP_PROSTHETIC_B64`,
  `PRESCRIPTION_FORM_B64`). Edit by: decode → patch with an exactly-one-match
  assertion → `node --check` every `<script>` → re-encode into 120-char string
  literals joined with `" +\n  "` → splice back → **decode again and
  byte-compare**. Skipping the round-trip check has caught real corruption.
- **`npm test`** is the full suite (738 checks, ~10 min, needs
  `CHROME_PATH=/opt/pw-browsers/chromium`). Read the result before committing —
  committing on an unread run has shipped a red test here before.
- **Never block clinical data entry on a lookup table.** The implant size field
  is a suggestion list that still accepts free text, deliberately: a missing
  catalogue row must never stop a case being recorded mid-surgery.
- **Tooth ranges follow the arch, not the numbers.** FDI runs `48..41 | 31..38`,
  so 43→33 is six teeth across the midline. A numeric range gets this wrong and
  the wrongness looks plausible.

## Recent history, newest first

| PR | What |
| --- | --- |
| #55 | Folded three Apps Script patch notes into one paste, one deploy |
| #54 | Clinical Sheets: one tab per form; row lookup without the JSON blobs |
| #53 | Implant Surgery: surgical detail, graft/membrane, suturing, follow-up |
| #52 | Pick a tooth range off the grid, then adjust it by hand |
| #51 | Tooth range follows the arch; Work Done + Tooth No. onto the prescription |
| #50 | RCT printed Clinical Record matches the paper pad |
