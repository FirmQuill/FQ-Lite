// US checking-account statement interchange. Stateless rules; scope history in the caller.
const MAX_SAFE = BigInt(Number.MAX_SAFE_INTEGER);
const headers = ['Date', 'Description', 'Amount'];

function requireProfile(profile) {
  if (profile !== 'wave' && profile !== 'quickbooks') throw Error('Choose a supported bank CSV profile.');
}

function checkSize(text, profile) {
  const maxBytes = profile === 'quickbooks' ? 350_000 : 2_000_000;
  if (typeof text !== 'string' || text.length > maxBytes || new TextEncoder().encode(text).length > maxBytes)
    throw Error('Bank CSV exceeds the selected profile’s file size limit.');
}

function safeInteger(value) {
  if (value > MAX_SAFE || value < -MAX_SAFE) throw Error('Statement total exceeds the supported cents range.');
  return Number(value);
}

function cents(value) {
  if (!Number.isSafeInteger(value)) throw Error('Expected whole integer cents.');
  return BigInt(value);
}

function amountFromDecimal(value) {
  const m = /^(-?)(\d{1,14})(?:\.(\d{1,2}))?$/.exec(value);
  if (!m) throw Error('Enter signed decimal dollars, with at most two decimal places.');
  const magnitude = BigInt(m[2]) * 100n + BigInt((m[3] || '').padEnd(2, '0'));
  return safeInteger(m[1] ? -magnitude : magnitude);
}

function amountToDecimal(value) {
  const amount = cents(value);
  const magnitude = amount < 0n ? -amount : amount;
  return (amount < 0n ? '-' : '') + String(magnitude / 100n) + '.' + String(magnitude % 100n).padStart(2, '0');
}

function localToday() {
  const now = new Date();
  return [String(now.getFullYear()), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
}

function validateRow(row, profile) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date)) throw Error('Unsupported date format.');
  const day = new Date(row.date + 'T12:00:00Z');
  if (!Number.isFinite(day.valueOf()) || day.toISOString().slice(0, 10) !== row.date)
    throw Error('Date is not a valid calendar day.');
  if (profile === 'wave' && (row.date < '2000-01-01' || row.date > localToday()))
    throw Error('Wave template requires a date between 2000-01-01 and today.');
  if (typeof row.description !== 'string' || !/[a-z]/i.test(row.description))
    throw Error('A plain-text English transaction description is required.');
  if (/[\u0000-\u001f\u007f]/u.test(row.description) || /^[\s\uFEFF]*[=+@-]/u.test(row.description))
    throw Error('Descriptions containing controls or a spreadsheet formula prefix cannot be exchanged.');
  cents(row.amountCents);
  if (row.amountCents === 0) throw Error('Bank statement movements must be nonzero.');
  if (profile === 'wave' && Math.abs(row.amountCents) > 100_000_000_000)
    throw Error('Amount exceeds the Wave template’s single-transaction limit.');
}

// Exactly one physical record per transaction; escaped quotes and commas are allowed.
function parseLine(line) {
  const fields = [];
  let value = '', quoted = false, closed = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c !== '"') value += c;
      else if (line[i + 1] === '"') { value += '"'; i++; }
      else { quoted = false; closed = true; }
    } else if (c === ',') {
      fields.push(value);
      value = ''; closed = false;
    } else if (c === '"' && value === '' && !closed) {
      quoted = true;
    } else {
      if (c === '"' || closed) throw Error('Invalid CSV quoting.');
      value += c;
    }
  }
  if (quoted) throw Error('Unclosed quoted field or multiline description.');
  fields.push(value);
  return fields;
}

function parseDate(value, profile) {
  if (profile === 'wave') return value;
  const match = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(value);
  if (!match) throw Error('QuickBooks profile uses DD/MM/YYYY.');
  return [match[3], match[2], match[1]].join('-');
}

function rowCountOk(count, profile) {
  if (count < 1) throw Error('Provide at least one bank movement.');
  if (count > (profile === 'quickbooks' ? 999 : 10_000)) throw Error('Split this statement into smaller files.');
}

export function previewBankCsv(text, profile, existingRows = []) {
  requireProfile(profile);
  checkSize(text, profile);
  const lines = text.replace(/^\uFEFF/, '').replace(/\r\n/g, '\n').split('\n');
  if (lines.at(-1) === '') lines.pop();
  const first = parseLine(lines.shift() || '');
  if (first.length !== 3 || first.some((name, i) => name !== headers[i]))
    throw Error('Expected header Date,Description,Amount. Check the selected file and layout.');
  rowCountOk(lines.length, profile);
  const existing = new Set(existingRows.map(row => row.sourceRef));
  const occurrences = new Map();
  const rows = [], added = [], skipped = [];
  let total = 0n, addedTotal = 0n, deposits = 0n, withdrawals = 0n;
  for (const [index, line] of lines.entries()) {
    try {
      const fields = parseLine(line);
      if (fields.length !== 3) throw Error('Expected three columns.');
      const row = {date: parseDate(fields[0], profile), description: fields[1], amountCents: amountFromDecimal(fields[2])};
      validateRow(row, profile);
      const signature = JSON.stringify([row.date, row.description, row.amountCents]);
      const ordinal = (occurrences.get(signature) || 0) + 1;
      occurrences.set(signature, ordinal);
      row.sourceRef = 'bank-v1/' + ordinal + '/' + signature;
      rows.push(row);
      const amount = cents(row.amountCents);
      total += amount;
      if (amount > 0n) deposits += amount;
      else withdrawals -= amount;
      if (existing.has(row.sourceRef)) skipped.push(row);
      else { added.push(row); addedTotal += amount; }
    } catch (error) {
      throw Error('Row ' + (index + 2) + ': ' + error.message);
    }
  }
  return {rows, added, skipped, totalCents: safeInteger(total), addedCents: safeInteger(addedTotal),
    depositsCents: safeInteger(deposits), withdrawalsCents: safeInteger(withdrawals)};
}

export function exportBankCsv(rows, profile) {
  requireProfile(profile);
  rowCountOk(rows.length, profile);
  const output = [headers.join(',')];
  for (const row of rows) {
    validateRow(row, profile);
    const [y, m, d] = row.date.split('-');
    const date = profile === 'wave' ? row.date : [d, m, y].join('/');
    const description = '"' + row.description.replaceAll('"', '""') + '"';
    output.push([date, description, amountToDecimal(row.amountCents)].join(','));
  }
  const text = output.join('\r\n') + '\r\n';
  checkSize(text, profile);
  return text;
}

export function reconcileBankStatement(preview, openingCents, closingCents) {
  const net = preview.rows.reduce((sum, row) => sum + cents(row.amountCents), 0n);
  const computedClosingCents = safeInteger(cents(openingCents) + net);
  const differenceCents = safeInteger(cents(computedClosingCents) - cents(closingCents));
  return {computedClosingCents, differenceCents, balanced: differenceCents === 0};
}


// A reviewed file's identity does not depend on its filename, CSV quoting, or source layout.
export async function statementFingerprint(preview,opening,closing) {
  const rows=preview.rows.map(row=>[row.date,row.description,row.amountCents]);
  const bytes=new TextEncoder().encode(JSON.stringify(['firmquill-bank-v1',opening,closing,rows]));
  const digest=await crypto.subtle.digest('SHA-256',bytes);
  return Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
}

export function bankImportReview(preview,existingRows,statementKey,confirmed=[]) {
  if(!/^[a-f0-9]{64}$/.test(statementKey))throw Error('Invalid bank statement fingerprint.');
  if(!Array.isArray(confirmed)||new Set(confirmed).size!==confirmed.length)throw Error('Invalid bank statement review selections.');
  const known=new Set(existingRows.map(row=>row.sourceRef));
  const sameStatement=existingRows.some(row=>row.statementKey===statementKey);
  const skipped=new Set(preview.skipped.map(row=>row.sourceRef));
  const candidates=new Set();
  const picked=new Set(confirmed);
  const rows=[];
  const decisions=preview.rows.map((row,index)=>{
    const indexKey=String(index);
    const reviewedRef='bank-reviewed/v1/'+statementKey+'/'+indexKey;
    if(known.has(reviewedRef))return 'recorded';
    if(!skipped.has(row.sourceRef)){
      rows.push({...row,statementKey});
      return 'new';
    }
    if(sameStatement)return 'duplicate';
    candidates.add(indexKey);
    if(picked.has(indexKey))rows.push({...row,sourceRef:reviewedRef,statementKey});
    return 'ambiguous';
  });
  if(confirmed.some(row=>!candidates.has(row)))throw Error('The review selections changed. Preview the statement again.');
  return {rows,decisions};
}
