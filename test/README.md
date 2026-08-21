# Tests

No build step and no network: both suites read `index.html` directly, and
neither talks to Google Sheets. They cover the client-side behaviour that runs
before any save.

    npm install playwright        # once
    node test/prefill.test.js
    node test/templates.test.js

`templates.test.js` needs Chromium. It uses Playwright's own copy by default
(`npx playwright install chromium`); where one is already on the machine, point
`CHROME_PATH` at it instead:

    CHROME_PATH=/opt/pw-browsers/chromium-*/chrome-linux/chrome node test/templates.test.js

## prefill.test.js

`registerPrefill` turns a just-saved clinical form into a pre-filled Daily
Register entry. Each form names its fields for its own sheet tab, so this
checks the real field names every save action sends — plus the form-label
fallback, whitespace-only fields, and a missing UHID, which must offer no
register entry at all.

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
