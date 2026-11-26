import test from 'node:test';
import assert from 'node:assert/strict';
import {ficaPreview, incomeTaxPreview, payrollGate, states} from '../payroll-rules.mjs';

const payDate = '2026-11-25';
const wages = {payDate, ssWagesCents: 0, priorSsWagesCents: 0, medicareWagesCents: 0, priorMedicareWagesCents: 0};
const w4 = {payDate, taxableWagesCents: 0, periods: 2, filingStatus: 'single', step2: false, otherIncomeCents: 0, deductionsCents: 0, creditsCents: 0, extraCents: 0};

test('IRS Pub 926 arithmetic example, $180 subject to Social Security produces $11.16', () => {
  const out = ficaPreview({...wages, ssWagesCents: 18000, medicareWagesCents: 18000});
  assert.equal(out.employeeSocialSecurityCents, 1116);
  assert.equal(out.employerSocialSecurityCents, 1116);
  assert.equal(out.employeeMedicareCents, 261);
  assert.equal(out.employerMedicareCents, 261);
});

test('IRS Pub 15-A example, given its already determined taxable wage bases', () => {
  const out = ficaPreview({...wages, ssWagesCents: 18450000, medicareWagesCents: 19425571});
  assert.equal(out.employeeSocialSecurityCents, 1143900);
  assert.equal(out.employeeMedicareCents, 281671);
  assert.equal(out.additionalMedicareCents, 0);
});

test('IRS Additional Medicare example, $180,000 prior and $50,000 current', () => {
  const out = ficaPreview({...wages, priorMedicareWagesCents: 18000000, medicareWagesCents: 5000000});
  assert.equal(out.additionalMedicareCents, 27000);
  assert.equal(out.employerMedicareCents, 72500);
});

test('Crossing Social Security wage cap and wages already at the cap', () => {
  assert.equal(ficaPreview({...wages, priorSsWagesCents: 18440000, ssWagesCents: 20000}).employeeSocialSecurityCents, 620);
  assert.equal(ficaPreview({...wages, priorSsWagesCents: 18450000, ssWagesCents: 20000}).employeeSocialSecurityCents, 0);
});

test('Exact cent rounding and Additional Medicare on all wages following the threshold', () => {
  assert.equal(ficaPreview({...wages, medicareWagesCents: 100, priorMedicareWagesCents: 20100000}).additionalMedicareCents, 1);
  assert.equal(ficaPreview({...wages, medicareWagesCents: 100}).employeeMedicareCents, 1);
  assert.equal(ficaPreview({...wages, medicareWagesCents: 1000}).employeeMedicareCents, 15);
});

test('All six 2026 annual percentage schedules agree with published bracket bases', () => {
  // Each case specifies synthetic half-year pay in cents that lands exactly on an IRS bracket.
  for (const [filingStatus,step2,halfYearCents,expectedCents] of [
    ['single',false,3325000,290000], ['joint',false,6650000,580000], ['head',false,4580000,387000],
    ['single',true,1662500,145000], ['joint',true,3325000,290000], ['head',true,2290000,193500]
  ]) assert.equal(incomeTaxPreview({...w4, filingStatus, step2, taxableWagesCents: halfYearCents}), expectedCents);
});

test('W-4 annual other income, deductions, credits and per-period additional withholding', () => {
  // $50,000 annual wages + $2,000 - $1,000 - $8,600 = $42,400 adjusted.
  // $1,240 + 12% of $22,500 = $3,940 annual, minus $1,000 credits, / 2, + $25.
  assert.equal(incomeTaxPreview({...w4,taxableWagesCents: 2500000, otherIncomeCents: 200000, deductionsCents: 100000, creditsCents: 100000, extraCents: 2500}), 149500);
  assert.equal(incomeTaxPreview({...w4,creditsCents: 10000, extraCents: 25}), 25);
});

test('Reject wrong years, impossible dates, missing wage history, unsafe amounts and invalid W-4s', () => {
  for (const date of ['2025-12-31','2027-01-01','2026-02-29','2026-00-03',null])
    assert.throws(() => ficaPreview({...wages, payDate: date}));
  for (const invalid of [undefined, null, '0', NaN, -1, 1.01, Number.MAX_SAFE_INTEGER + 1])
    assert.throws(() => ficaPreview({...wages, priorSsWagesCents: invalid}));
  for (const override of [{filingStatus: 'constructor'}, {periods: 0}, {creditsCents: undefined}, {step2: 'no'}])
    assert.throws(() => incomeTaxPreview({...w4, ...override}));
});

test('All 50 states, DC, unknown districts and dates deny final payroll output', () => {
  assert.equal(new Set(states).size, 51);
  assert.ok(states.includes('DC'));
  for (const state of [...states, 'US', '', undefined]) {
    for (const date of ['2026-01-01','2026-11-25','2027-01-01','2026-04-31']) {
      const result = payrollGate({payDate: date, state, locality: 'Synthetic district', reviewed: true, approved: true});
      assert.equal(result.allowed, false);
      assert.ok(result.blockers.length >= 4);
    }
  }
  assert.equal(payrollGate().allowed, false);
});
