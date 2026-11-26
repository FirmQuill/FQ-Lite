import test from 'node:test';
import assert from 'node:assert/strict';
import {previewBankCsv, exportBankCsv, reconcileBankStatement} from '../interop.mjs';

const header = 'Date,Description,Amount\n';
const wave = header + '2024-02-29,"Panel, ""North""",123.45\n2024-03-01,Assembly supplies,-23.35\n';
const qb = header + '29/02/2024,"Panel, ""North""",123.45\n01/03/2024,Assembly supplies,-23.35\n';

test('Wave published three-column header, sign conventions, and exact statement control totals', () => {
  const preview = previewBankCsv(wave, 'wave');
  assert.equal(preview.rows.length, 2);
  assert.equal(preview.totalCents, 10010);
  assert.equal(preview.addedCents, 10010);
  assert.equal(preview.depositsCents, 12345);
  assert.equal(preview.withdrawalsCents, 2335);
  assert.deepEqual(reconcileBankStatement(preview, 40000, 50010),
    {computedClosingCents:50010, differenceCents:0, balanced:true});
  assert.equal(reconcileBankStatement(preview, 40000, 50009).differenceCents, 1);
});

test('Round trip through both official bank-import profiles preserves reference, date, memo and cents', () => {
  const a = previewBankCsv(wave, 'wave');
  const b = previewBankCsv(qb, 'quickbooks');
  assert.deepEqual(a.rows, b.rows);
  assert.equal(a.rows[0].description, 'Panel, "North"');
  for (const profile of ['wave', 'quickbooks']) {
    const file = exportBankCsv(a.rows, profile);
    assert.match(file, /^Date,Description,Amount\r\n/);
    assert.deepEqual(previewBankCsv(file, profile).rows, a.rows);
    assert.equal(previewBankCsv(file, profile, a.rows).added.length, 0);
  }
});

test('Published QuickBooks signed-amount example distinguishes a payment and a deposit', () => {
  const csv = header + '01/01/2018,Example of a payment,-100.00\n01/01/2018,Example of a deposit,200.00\n';
  const preview = previewBankCsv(csv, 'quickbooks');
  assert.deepEqual(preview.rows.map(row => row.amountCents), [-10000, 20000]);
  assert.equal(preview.totalCents, 10000);
});

test('Multiple identical movements in one file retain separate, stable identities', () => {
  const line = '2025-08-01,Transit fare,-3.15\n';
  const first = previewBankCsv(header + line + line, 'wave');
  assert.equal(new Set(first.rows.map(r => r.sourceRef)).size, 2);
  const next = previewBankCsv(header + line + line + line, 'wave', first.rows);
  assert.equal(next.skipped.length, 2);
  assert.equal(next.added.length, 1);
  assert.equal(next.addedCents, -315);
  const repeat = previewBankCsv(header + line + line, 'wave', first.rows);
  assert.equal(repeat.addedCents, 0);
  assert.equal(reconcileBankStatement(repeat, 630, 0).balanced, true);
});

test('Overlap across profiles and reordered files uses references, scoped to passed account history', () => {
  const first = previewBankCsv(wave, 'wave');
  const reversed = exportBankCsv([...first.rows].reverse(), 'quickbooks');
  assert.equal(previewBankCsv(reversed, 'quickbooks', first.rows).skipped.length, 2);
  assert.equal(previewBankCsv(reversed, 'quickbooks', []).added.length, 2);
});

test('Rejects ambiguous layouts, impossible dates, malformed decimals, blank lines, and control prefixes', () => {
  for (const csv of [
    'Date,Description,Credit,Debit\n01/02/2023,Fare,1.20,',
    header + '2025-02-29,Local fare,4.25', header + '2024-01-01,Local fare,-3.101',
    header + '01/02/2023,Local fare,1.00', header + '2025-01-01,999999,1.00',
    header + '2025-01-01,"Tab\taccount",1.00', header + '2025-01-01, =SUM(2),1.00',
    header + '2025-01-01,"Extra"junk,1.00', header + '2025-01-01,"Unclosed,1.00',
    header + '2025-01-01,Zero,0.00', header + '1999-01-01,Before template,1.00',
    header + '2999-01-01,Future purchase,1.00', header + '2025-01-01,Too large,1000000000.01',
    wave + '\n2025-01-01,Fee,-1',
  ]) assert.throws(() => previewBankCsv(csv, 'wave'));
  assert.throws(() => previewBankCsv(wave, 'quickbooks'));
  assert.throws(() => previewBankCsv(wave, 'desktop'));
  assert.throws(() => exportBankCsv([{date:'2024-01-01',description:'+subtotal', amountCents:1}], 'wave'));
  assert.throws(() => exportBankCsv([], 'quickbooks'));
});

test('QuickBooks size, line count, invalid cents and exact aggregation overflow are rejected', () => {
  assert.throws(() => previewBankCsv(header + ('01/01/2024,Small fare,1\n').repeat(1000), 'quickbooks'));
  assert.throws(() => previewBankCsv(header + ('a').repeat(350001), 'quickbooks'));
  assert.throws(() => previewBankCsv(header + ('01/01/2024,Industrial machinery,90071992547409.91\n').repeat(2), 'quickbooks'));
  assert.throws(() => reconcileBankStatement({rows:[]}, 1.23, 2));
  const row = {date:'2024-01-01',description:'Receipt', amountCents:Number.MAX_SAFE_INTEGER};
  assert.throws(() => reconcileBankStatement({rows:[row]}, 10, 0));
});
