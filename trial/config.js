// Where the TRIAL's own backend is.
//
// This is the only file to edit when the trial is pointed at a new copy of
// the spreadsheet. The page itself is generated from index.html and is not
// edited by hand -- `node tools/build-trial.js` rebuilds it.
//
// To fill this in:
//   1. Open the clinic's PMS spreadsheet and choose File > Make a copy.
//      (The copy carries the Apps Script with it.)
//   2. In the COPY: Extensions > Apps Script. If emptyThisCopyForTrial is
//      not in the file, paste the current Code.gs in first -- the copy
//      carries whatever script the clinic's book had when it was copied.
//      Then Run > emptyThisCopyForTrial. It clears every patient,
//      appointment, record and money tab and keeps the master lists, and
//      it refuses to run on either of the clinic's own books.
//   3. Still in the copy's script: Deploy > New deployment > Web app,
//      "Execute as me", "Anyone with the link", and copy the /exec URL.
//   4. Paste it between the quotes below and publish.
//
// Left empty, the trial page says it is not connected and opens nothing --
// which is the safe state, not a broken one.
window.KB_TRIAL_SCRIPT_URL = "";
