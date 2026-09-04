# Apps Script — add the Implant Brands master list

The Implant Surgery form's brand dropdown, and the sizes it offers once a brand
is chosen, now come from **Master → Clinic → Implant Brands & Sizes** instead of
being fixed in the app. Adding a system, or correcting the sizes you actually
stock, becomes a change you make yourself.

The app half is already live. The backend needs these two functions, which only
you can add — I cannot deploy `Code.gs`.

Until this is pasted in, the form keeps working on its built-in brand list, and
the Master screen shows the list as empty. Nothing breaks in the meantime.

## 1. Add the two router cases

Ctrl+F for:

```javascript
      case "getMedicineDosagesList":       return getMedicineDosagesList();
```

and paste these two lines **directly above** it:

```javascript
      case "getImplantBrandsList":         return getImplantBrandsList();
      case "saveImplantBrandsList":       return saveImplantBrandsList(p);
```

## 2. Add the two functions

Ctrl+F for:

```javascript
function getMedicineDosagesList() {
```

and paste this **directly above** that line:

```javascript
// Implant brands and the sizes each is stocked in — maintained by the clinic
// in Master (Clinic > Implant Brands & Sizes) rather than fixed in the app,
// so a new system or a discontinued size is a sheet edit, not a code change.
// Sizes are one comma-separated string per brand; the form splits them and
// still accepts anything typed, so an unlisted size never blocks a case.
function getImplantBrandsList() {
  var sh = getSheet("Implant Brands");
  var data = sh.getDataRange().getValues();
  var items = [];
  for (var i = 1; i < data.length; i++) {
    if (!data[i][0]) continue;
    items.push({ name: String(data[i][0]).trim(), sizes: String(data[i][1] || "").trim() });
  }
  return { success: true, brands: items };
}
function saveImplantBrandsList(p) {
  var sh = getSheet("Implant Brands");
  sh.clearContents();
  sh.appendRow(["Brand", "Sizes", "Updated At"]);
  var arr = [];
  try { arr = JSON.parse(p.brands); } catch (e) { if (Array.isArray(p.brands)) arr = p.brands; }
  var now = new Date().toISOString();
  arr.forEach(function(b) { sh.appendRow([b.name, b.sizes || "", now]); });
  return { success: true };
}
```

Save (Ctrl+S), then **Deploy → Manage deployments → edit → Version: New version
→ Deploy**. Without the redeploy the web app keeps serving the old code.

## 3. Fill in your own catalogue

Open the app → **Master → Clinic → Implant Brands & Sizes**. It starts empty.

Add a row per system you stock. Sizes are comma separated, and the text is free
— write them however you read them off the box:

| Brand | Sizes |
| --- | --- |
| Straumann | `3.3 × 8 mm, 3.3 × 10 mm, 4.1 × 10 mm, 4.1 × 12 mm` |
| Nobel Active | `3.5 × 10 mm, 4.3 × 11.5 mm, 5.0 × 13 mm` |

Editing the Sizes box on an existing row saves when you click away from it.

The "Implant Brands" tab is created in the spreadsheet the first time you save.

## Notes

- **A size that is not on the list can still be typed** straight into the form.
  The dropdown is a suggestion list, never a restriction — an unusual implant at
  8pm must never be blocked by a catalogue that is missing a row.
- **Existing records are safe.** A brand already recorded against an implant
  stays on that row even if you later remove it from the master list, so old
  surgeries never silently change brand.
- Once your list has at least one brand, it replaces the built-in one entirely.
