import { Prisma } from '@prisma/client';

export interface CompensationJson {
  amount?: number | string;
  percentage?: number | string;
}

function decimal(value: unknown): Prisma.Decimal {
  if (typeof value === 'number' || typeof value === 'string') return new Prisma.Decimal(value);
  return new Prisma.Decimal(0);
}

export function calculateCompensation(input: {
  basePay: Prisma.Decimal;
  allowances: unknown;
  deductions: unknown;
}) {
  const allowanceItems = Array.isArray(input.allowances) ? input.allowances : [];
  const deductionItems = Array.isArray(input.deductions) ? input.deductions : [];

  let allowancesTotal = new Prisma.Decimal(0);
  for (const item of allowanceItems as CompensationJson[]) {
    if (item.percentage != null) allowancesTotal = allowancesTotal.plus(input.basePay.mul(decimal(item.percentage)).div(100));
    else allowancesTotal = allowancesTotal.plus(decimal(item.amount));
  }

  let deductionsTotal = new Prisma.Decimal(0);
  for (const item of deductionItems as CompensationJson[]) {
    if (item.percentage != null) deductionsTotal = deductionsTotal.plus(input.basePay.mul(decimal(item.percentage)).div(100));
    else deductionsTotal = deductionsTotal.plus(decimal(item.amount));
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
