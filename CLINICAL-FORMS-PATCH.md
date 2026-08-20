# Apps Script — two clinical form fields that are being thrown away

Found while auditing all 18 Clinical Records forms against what the backend
actually stores. Everything else lines up; these two do not.

## The problem

The **Pathology** and **Radiology** forms both have a **Remarks** box. Both
send it. Neither `savePathology` nor `saveRadiology` maps it, so it is dropped
on arrival — the clinician types remarks, sees the record save, and the text is
gone. Nothing warns them.

## Fix — two lines, plus two columns

### 1. `savePathology`

Find `"Follow-up Action": p.followupAction || ""` and add a line after it
(remember the comma on the line above):

```javascript
      "Remarks": p.remarks || ""
```

### 2. `saveRadiology`

Find `"Follow-up Recommendation": p.followupRecommendation || ""` and add:

```javascript
      "Remarks": p.remarks || ""
```

### 3. Two sheet columns

`saveClinicalRecord` auto-extends the header row with any field it has not seen
before, so this happens by itself on the next save — the new **Remarks** column
appears at the far right of the **Pathology** and **Radiology** tabs, and older
rows simply stay blank under it. Nothing to do by hand.

## Deploy

**Ctrl+S**, then **Deploy → Manage deployments → pencil → New version → Deploy.**

## Not a backend change, but worth knowing

The forms used to show "✅ Saved!" the moment they handed the record to the
app, without waiting to hear whether it was stored. The app, in turn, ignored
whether the save succeeded. A rejected save — an expired session, a sheet
error, an unknown action — looked exactly like a successful one, and the record
was lost silently. The forms now wait for the real answer and say plainly when
a record did **not** save. That part is already done in `index.html` and needs
nothing from you.
