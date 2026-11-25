// Rules for restricted, synthetic 2026 worksheets. Monetary inputs and outputs are integer cents.
// Jurisdiction discovery, actual forms and bank-specific export are release gates. This module
// has no storage, network access, final-net calculation or output-file generation.
export const payrollRulesVersion = 'us-regular-wages.2026.preview.1';
export const states = Object.freeze('AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY'.split(' '));

function currentYear(payDate) {
  if (typeof payDate !== 'string' || !/^2026-\d{2}-\d{2}$/.test(payDate)) return false;
  const parsed = new Date(payDate + 'T12:00:00Z');
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().startsWith(payDate);
}

function checkDate(payDate) {
  if (!currentYear(payDate)) throw new Error('The pay date must be a valid date in tax year 2026.');
}

function cents(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(label + ' requires nonnegative integer cents.');
  return BigInt(value);
}

function roundedRatio(numerator, denominator) {
  const result = (2n * numerator + denominator) / (2n * denominator);
  if (result > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('Calculated amount exceeds the supported range.');
  return Number(result);
}

function positive(amount) {
  return amount > 0n ? amount : 0n;
}

// Inputs are separately determined taxable wages, including explicit prior wages from this
// employer for this calendar year. Do not substitute gross wages or assume YTD wages of zero.
export function ficaPreview({payDate, ssWagesCents, medicareWagesCents, priorSsWagesCents, priorMedicareWagesCents}) {
  checkDate(payDate);
  const ss = cents(ssWagesCents, 'Social Security wages');
  const medicare = cents(medicareWagesCents, 'Medicare wages');
  const priorSS = cents(priorSsWagesCents, 'Prior Social Security wages');
  const priorMedicare = cents(priorMedicareWagesCents, 'Prior Medicare wages');
  const remaining = positive(18450000n - priorSS);
  const ssTax = roundedRatio((ss < remaining ? ss : remaining) * 62n, 1000n);
  const medicareTax = roundedRatio(medicare * 145n, 10000n);
  const aboveThreshold = positive(priorMedicare + medicare - 20000000n) - positive(priorMedicare - 20000000n);
  return {
    employeeSocialSecurityCents: ssTax,
    employerSocialSecurityCents: ssTax,
    employeeMedicareCents: medicareTax,
    employerMedicareCents: medicareTax,
    additionalMedicareCents: roundedRatio(aboveThreshold * 9n, 1000n)
  };
}

// IRS Publication 15-T (2026), Section 1, Worksheet 1A. Each row contains the annual
// adjusted wage threshold in dollars, annual base withholding in cents, and excess rate in percent.
const schedules = {
  joint: [
    [[0,0,0],[19300,0,10],[44100,248000,12],[120100,1160000,22],[230700,3593200,24],[422850,8204800,32],[531750,11689600,35],[788000,20658350,37]],
    [[0,0,0],[16100,0,10],[28500,124000,12],[66500,580000,22],[121800,1796600,24],[217875,4102400,32],[272325,5844800,35],[400450,10329175,37]]
  ],
  single: [
    [[0,0,0],[7500,0,10],[19900,124000,12],[57900,580000,22],[113200,1796600,24],[209275,4102400,32],[263725,5844800,35],[648100,19297925,37]],
    [[0,0,0],[8050,0,10],[14250,62000,12],[33250,290000,22],[60900,898300,24],[108938,2051200,32],[136163,2922400,35],[328350,9648963,37]]
  ],
  head: [
    [[0,0,0],[15550,0,10],[33250,177000,12],[83000,774000,22],[121250,1615500,24],[217300,3920700,32],[271750,5663100,35],[656150,19117100,37]],
    [[0,0,0],[12075,0,10],[20925,88500,12],[45800,387000,22],[64925,807750,24],[112950,1960350,32],[140175,2831550,35],[332375,9558550,37]]
  ]
};

// Regular civilian wages, resident employee, modern W-4. The caller must supply every
// W-4 field. Supplemental wages, nonresident adjustments, legacy certificates, exemptions
// and wage-base classification require distinct rules.
export function incomeTaxPreview({payDate, taxableWagesCents, periods, filingStatus, step2, otherIncomeCents, deductionsCents, creditsCents, extraCents}) {
  checkDate(payDate);
  if (![2,4,12,24,26,52,260].includes(periods)) throw new Error('Unsupported pay frequency.');
  if (!Object.hasOwn(schedules, filingStatus) || typeof step2 !== 'boolean') throw new Error('Specify filing status and Step 2 checkbox.');
  const wages = cents(taxableWagesCents, 'Federal taxable wages');
  const other = cents(otherIncomeCents, 'W-4 other income');
  const deductions = cents(deductionsCents, 'W-4 deductions');
  const credits = cents(creditsCents, 'W-4 credits');
  const extra = cents(extraCents, 'W-4 additional withholding');
  const adjustment = step2 ? 0n : (filingStatus === 'joint' ? 1290000n : 860000n);
  const annual = positive(wages * BigInt(periods) + other - deductions - adjustment);
  const bracket = schedules[filingStatus][Number(step2)].findLast(([threshold]) => BigInt(threshold) * 100n <= annual);
  const [thresholdDollars, baseCents, percent] = bracket.map(BigInt);
  const annualHundredths = baseCents * 100n + (annual - thresholdDollars * 100n) * percent;
  const divisor = 100n * BigInt(periods);
  return roundedRatio(positive(annualHundredths - credits * 100n) + extra * divisor, divisor);
}

export function payrollGate({payDate, state, locality} = {}) {
  const blockers = [];
  if (!currentYear(payDate)) blockers.push('No rule package covers this pay date.');
  blockers.push('Federal payroll forms, wage classifications and unemployment treatment require verification.');
  blockers.push(states.includes(state) ? state + ' tax rules and forms lack release approval.' : 'Work and residence jurisdictions require resolution.');
  blockers.push(typeof locality === 'string' && locality.trim() ? 'Local tax applicability, rules and forms lack release approval.' : 'Resolve applicable local taxing districts for the employee.');
  blockers.push('Independent payroll review and bank-specific direct-deposit validation are outstanding.');
  return {allowed: false, blockers};
}
