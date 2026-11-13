// Aggregate reconciliation only; never writes a patient-bearing candidate ledger.
import {tableRows, digest} from './source.mjs';

export function sourceIdentities(books) {
  const identities = new Map();
  const add = (id, name, category) => {
    id = id.trim().toUpperCase();
    if (!id) return;
    const current = identities.get(id) ?? {categories: new Set(), names: new Set()};
    current.categories.add(category);
    if (name) current.names.add(name.trim().toLowerCase().replace(/\s+/g, ' '));
    identities.set(id, current);
  };
  for (const book of books) {
    const historicalTab = book.tabs.find(tab => tab.title === 'Registration Form') ?? book.tabs[0];
    const tabs = book.role === 'historical-registration' ? (historicalTab ? [historicalTab] : []) : book.tabs;
    for (const tab of tabs) {
      const registration = tab.title === 'Registrations' && ['main', 'empanelled'].includes(book.role);
      const history = book.role === 'historical-registration';
      const clinical = book.role === 'clinical';
      const finance = book.role === 'finance';
      const crm = tab.title.startsWith('CRM ') && ['main', 'empanelled'].includes(book.role);
      const care = ['Daily Register', 'Appointments', 'Treatment Cases', 'Treatment Plans', 'Care Plans', 'Consents', 'CGHS Bills'].includes(tab.title)
        && ['main', 'empanelled'].includes(book.role);
      if (!registration && !history && !clinical && !care && !finance && !crm) continue;
      for (const row of tableRows(tab)) {
        const name = row.get(['Full Name', 'Patient Name', "Patient's Name", 'Name of Patient', 'Name', 'Patient'])
          || [row.get(['firstName']), row.get(['lastName'])].filter(Boolean).join(' ');
        add(row.get(['UHID', 'UHID No.', 'Registration ID', 'Patient ID']), name,
          registration ? 'current-registration' : history ? 'historical-registration' : finance ? 'finance-reference' : crm ? 'crm-reference' : 'care-record');
      }
    }
  }
  return identities;
}

export function dayOnly(value) {
  if (typeof value === 'number') {
    // Sheets serials are local wall-clock calendar values, not UTC instants.
    if (!Number.isFinite(value) || value < 1 || value > 2958465) return null;
    return new Date(Date.UTC(1899, 11, 30) + Math.floor(value) * 86400000).toISOString().slice(0, 10);
  }
  const text = String(value ?? '').trim();
  let match = /^(\d{4})-(\d{2})-(\d{2})(?:T|\s|$)/.exec(text);
  let result;
  if (match) result = `${match[1]}-${match[2]}-${match[3]}`;
  else {
    match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:\s|$)/.exec(text);
    if (!match) return null;
    // Ambiguous display dates require the raw date cell/locale conversion.
    if (Number(match[1]) <= 12 && Number(match[2]) <= 12 && match[1] !== match[2]) return null;
    const monthFirst = Number(match[2]) > 12;
    const day = monthFirst ? match[2] : match[1];
    const month = monthFirst ? match[1] : match[2];
    result = `${match[3]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  const date = new Date(result + 'T00:00:00Z');
  return !isNaN(date.getTime()) && date.toISOString().slice(0, 10) === result ? result : null;
}

export function registerCollisions(books) {
  const groups = new Map();
  let unreadableOrAmbiguousDates = 0, missingIdentifier = 0, rows = 0;
  for (const book of books.filter(book => ['main', 'empanelled'].includes(book.role))) {
    for (const tab of book.tabs.filter(tab => tab.title === 'Daily Register')) {
      for (const row of tableRows(tab)) {
        rows++;
        const id = row.get(['UHID', 'UHID No.']).toUpperCase();
        const day = dayOnly(row.getRaw(['Timestamp', 'Date']));
        if (!id) { missingIdentifier++; continue; }
        if (!day) { unreadableOrAmbiguousDates++; continue; }
        const key = `${id}:${day}`;
        const group = groups.get(key) ?? [];
        group.push(digest(row.cells));
        groups.set(key, group);
      }
    }
  }
  const duplicates = [...groups.values()].filter(group => group.length > 1);
  return {rows, unreadableOrAmbiguousDates, missingIdentifier,
    repeatedPatientDayGroups: duplicates.length,
    repeatedGroupsWithDifferentRows: duplicates.filter(group => new Set(group).size > 1).length};
}

export function sourceSummary(books) {
  const identities = sourceIdentities(books);
  const categories = {currentRegistration: 0, historicalOnly: 0, careWithoutRegistration: 0, financeOrCrmOnly: 0, noRecordedName: 0};
  const referenceShape = {standardLooking: 0, numericOnly: 0, other: 0, multipleRecordedNameVariants: 0};
  for (const value of identities.values()) {
    if (value.categories.has('current-registration')) categories.currentRegistration++;
    else if (value.categories.has('historical-registration')) categories.historicalOnly++;
    else if (value.categories.has('care-record')) categories.careWithoutRegistration++;
    else categories.financeOrCrmOnly++;
    if (!value.names.size) categories.noRecordedName++;
  }
  for (const [identifier, value] of identities) {
    if (value.categories.has('current-registration') || value.categories.has('historical-registration') || value.categories.has('care-record')) continue;
    if (/^[A-Z]{2}(0[1-9]|1[0-2])[0-9]{2,}$/.test(identifier)) referenceShape.standardLooking++;
    else if (/^[0-9]+$/.test(identifier)) referenceShape.numericOnly++;
    else referenceShape.other++;
    if (value.names.size > 1) referenceShape.multipleRecordedNameVariants++;
  }
  return {identities, summary: {sourceIdentifiersAcrossAllExaminedSources: identities.size,
    categories, financeOrCrmOnlyReferenceShape: referenceShape, dailyRegister: registerCollisions(books)}};
}
