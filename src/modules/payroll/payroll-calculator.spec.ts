import { Prisma } from '@prisma/client';
import { calculateCompensation } from './payroll-calculator';

describe('calculateCompensation', () => {
  it('calculates fixed and percentage allowances and deductions with decimal precision', () => {
    const result = calculateCompensation({
      basePay: new Prisma.Decimal('5000.00'),
      allowances: [{ amount: '500.00' }, { percentage: '10' }],
      deductions: [{ amount: '250.00' }, { percentage: '5' }],
    });

    expect(result).toEqual({
      basePay: '5000.00',
      allowancesTotal: '1000.00',
      deductionsTotal: '500.00',
      grossPay: '6000.00',
      netPay: '5500.00',
    });
  });

  it('rejects malformed compensation JSON instead of silently treating it as zero', () => {
    expect(() => calculateCompensation({
      basePay: new Prisma.Decimal('5000.00'),
      allowances: { amount: '500.00' },
      deductions: [],
    })).toThrow('Allowances must be an array of compensation lines.');
  });

  it('rejects a calculation that would produce negative net pay', () => {
    expect(() => calculateCompensation({
      basePay: new Prisma.Decimal('100.00'),
      allowances: [],
      deductions: [{ amount: '150.00' }],
    })).toThrow('Calculated net pay cannot be negative.');
  });
});
