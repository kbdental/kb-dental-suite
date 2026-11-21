# The trial app

The same clinical suite with nobody's records in it: its own Google
spreadsheet, the master lists filled in, every patient, appointment,
clinical record and money tab empty.

**Link:** `https://kbdental.github.io/kb-dental-suite/trial/`

## Why it is a separate page

The clinic's own link and this one differ by more than a query string on
purpose. Today the URL is the only thing between a stranger and the live
patient list — only Master and Reports ask for a password — so a trial
link that was `?clinic=trial` on the clinic's own page would hand over the
clinic's address with it.

This page carries **one** instance and does not contain the clinic's
`/exec` URLs at all, so there is no way back to the real book from it
however the address bar is edited.

## It is generated, not maintained

`trial/index.html` is built from `index.html` by `tools/build-trial.js`,
which changes three things and nothing else: the instance list, the
default instance, and the `<script>` that loads `config.js`. A test
regenerates it and compares byte for byte, so the trial cannot drift
behind the app.

Rebuild it after any change to `index.html`:

```
node tools/build-trial.js
```

## Setting up its backend

See the steps in `config.js`. In short: copy the PMS spreadsheet, run
`emptyThisCopyForTrial` in the copy, deploy the copy's script, paste the
`/exec` URL into `config.js`.

`emptyThisCopyForTrial` refuses to run on the main clinic's book or the
empanelled one, so it cannot be pointed at the wrong file by mistake.
