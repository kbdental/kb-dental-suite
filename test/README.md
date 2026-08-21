# Tests

No build step and no network: all three suites read `index.html` directly,
and none of them talks to Google Sheets. They cover the client-side behaviour that runs
before any save.

    npm install                   # once
    npm test

`templates.test.js` and `register-questions.test.js` need Chromium. It uses Playwright's own copy by default
(`npx playwright install chromium`); where one is already on the machine, point
`CHROME_PATH` at it instead:

    CHROME_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome node test/templates.test.js

## prefill.test.js

`registerPrefill` turns a just-saved clinical form into a pre-filled Daily
Register entry. Each form names its fields for its own sheet tab, so this
checks the real field names every save action sends — plus the form-label
fallback, whitespace-only fields, and a missing UHID, which must offer no
register entry at all.

## register-questions.test.js

"Initial Assessment Done" and "Care Plan Documented" used to be answered `Yes`
by the backend whenever the app omitted them — which no caller sent, so every
register row claimed both without anyone having said so. The app now asks.

This mounts the real `RegisterConfirm` out of `index.html` against a stubbed
`api()` and checks what reaches the wire: unanswered travels as `""` (present
on the payload, not absent, and not `"Yes"`), `Yes` and `No` travel as given,
`No` is not mistaken for unset, and an answer that is taken back returns to
unanswered.

## templates.test.js

Loads each of the eighteen clinical forms in a browser, sends the same
`KB_PATIENT` and `KB_TEMPLATES` messages the parent app sends, then drives the
work-done dropdown the way staff would: pick a template, fill its
placeholders, press Insert. It asserts the text lands in the field that gets
saved to the sheet, with placeholders substituted and none left behind.

The dropdown sits inside a hidden tab pane on some forms, so the test sets
values and clicks through the DOM rather than through Playwright's
visibility-aware helpers, which would wait forever on a `display:none` pane.

Expect one console error per form: the Google Fonts stylesheet, which a
sandbox without network cannot fetch. No request from the forms' own code
fails.
