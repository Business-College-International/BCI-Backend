import { Prisma } from '@prisma/client';

export interface CompensationJson {
  amount?: number | string;
  percentage?: number | string;
}

function decimal(value: unknown): Prisma.Decimal {
  if (typeof value === 'number' || typeof value === 'string') return new Prisma.Decimal(value);
  throw new Error('Compensation amount/percentage must be numeric.');
}

function lines(value: unknown, field: string): CompensationJson[] {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`${field} must be an array of compensation lines.`);
  return value as CompensationJson[];
}

export function calculateCompensation(input: {
  basePay: Prisma.Decimal;
  allowances: unknown;
  deductions: unknown;
}) {
  const allowanceItems = lines(input.allowances, 'Allowances');
  const deductionItems = lines(input.deductions, 'Deductions');

  let allowancesTotal = new Prisma.Decimal(0);
  for (const item of allowanceItems) {
    if (item.percentage != null) allowancesTotal = allowancesTotal.plus(input.basePay.mul(decimal(item.percentage)).div(100));
    else if (item.amount != null) allowancesTotal = allowancesTotal.plus(decimal(item.amount));
    else throw new Error('Each allowance line must include amount or percentage.');
  }

  let deductionsTotal = new Prisma.Decimal(0);
  for (const item of deductionItems) {
    if (item.percentage != null) deductionsTotal = deductionsTotal.plus(input.basePay.mul(decimal(item.percentage)).div(100));
    else if (item.amount != null) deductionsTotal = deductionsTotal.plus(decimal(item.amount));
    else throw new Error('Each deduction line must include amount or percentage.');
  }

  const grossPay = input.basePay.plus(allowancesTotal);
  const netPay = grossPay.minus(deductionsTotal);
  if (netPay.lessThan(0)) throw new Error('Calculated net pay cannot be negative.');

  return {
    basePay: input.basePay.toFixed(2),
    allowancesTotal: allowancesTotal.toFixed(2),
    deductionsTotal: deductionsTotal.toFixed(2),
    grossPay: grossPay.toFixed(2),
    netPay: netPay.toFixed(2),
  };
}
