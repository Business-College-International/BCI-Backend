import { ConflictException, BadRequestException, NotFoundException } from '@nestjs/common';
import { StaffManagementService } from './staff-management.service';

describe('StaffManagementService', () => {
  it('blocks termination when unresolved payroll exists after locking staff state', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ personId: 'staff-1' }]),
      staff: {
        findUnique: jest.fn().mockResolvedValue({
          personId: 'staff-1',
          department: 'Science',
          contractType: 'permanent',
          employmentStatus: 'active',
        }),
        update: jest.fn(),
      },
      payrollEntry: { count: jest.fn().mockResolvedValue(1) },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new StaffManagementService(prisma as never);

    await expect(service.updateStaffRecord('staff-1', { employmentStatus: 'terminated' }, 'actor-1'))
      .rejects.toBeInstanceOf(ConflictException);
    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.payrollEntry.count).toHaveBeenCalled();
    expect(tx.staff.update).not.toHaveBeenCalled();
  });

  it('locks the staff row before checking unresolved payroll during termination', async () => {
    const tx = {
      $queryRaw: jest.fn().mockResolvedValue([{ personId: 'staff-1' }]),
      staff: {
        findUnique: jest.fn().mockResolvedValue({
          personId: 'staff-1',
          department: 'Science',
          contractType: 'permanent',
          employmentStatus: 'active',
        }),
        update: jest.fn(),
      },
      payrollEntry: { count: jest.fn().mockResolvedValue(1) },
      auditLog: { create: jest.fn() },
    };
    const prisma = {
      $transaction: jest.fn(async (callback: (value: typeof tx) => unknown) => callback(tx)),
    };
    const service = new StaffManagementService(prisma as never);

    await expect(service.updateStaffRecord('staff-1', { employmentStatus: 'terminated' }, 'actor-1'))
      .rejects.toBeInstanceOf(ConflictException);

    expect(tx.$queryRaw).toHaveBeenCalledTimes(1);
    expect(tx.payrollEntry.count).toHaveBeenCalledWith({
      where: { staffId: 'staff-1', status: { in: ['pending', 'calculated', 'approved'] } },
    });
    expect(tx.staff.update).not.toHaveBeenCalled();
  });

  it('completes an active duty and audits the transition', async () => {
    const duty = { id: 'duty-1', active: true };
    const tx = {
      staffDuty: { update: jest.fn().mockResolvedValue({ ...duty, active: false }) },
      auditLog: { create: jest.fn().mockResolvedValue({ id: 'audit-1' }) },
    };
    const prisma = {
      staffDuty: { findUnique: jest.fn().mockResolvedValue(duty) },
      $transaction: jest.fn(async (callback: (arg: typeof tx) => unknown) => callback(tx)),
    };
    const service = new StaffManagementService(prisma as never);

    await expect(service.completeDuty('duty-1', 'actor-1')).resolves.toMatchObject({ active: false });
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ entityType: 'StaffDuty', entityId: 'duty-1' }),
    }));
  });

  it('rejects completing an already inactive duty', async () => {
    const prisma = {
      staffDuty: { findUnique: jest.fn().mockResolvedValue({ id: 'duty-1', active: false }) },
      $transaction: jest.fn(),
    };
    const service = new StaffManagementService(prisma as never);
    await expect(service.completeDuty('duty-1', 'actor-1')).rejects.toBeInstanceOf(BadRequestException);
  });

  it('returns not found for an unknown staff member', async () => {
    const prisma = { staff: { findUnique: jest.fn().mockResolvedValue(null) } };
    const service = new StaffManagementService(prisma as never);
    await expect(service.getStaffRecord('missing')).rejects.toBeInstanceOf(NotFoundException);
  });
});
