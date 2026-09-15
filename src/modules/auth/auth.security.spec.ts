import { ConflictException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { AuthService } from './auth.service';

describe('AuthService security controls', () => {
  it('rejects an incorrect current password', async () => {
    const prisma = {
      user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', passwordHash: await bcrypt.hash('CorrectPassword1!', 4), tokenVersion: 1, status: UserStatus.ACTIVE }) },
      refreshSession: { updateMany: jest.fn() }, auditLog: { create: jest.fn() },
      $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback({ user: { update: jest.fn() }, refreshSession: { updateMany: jest.fn() }, auditLog: { create: jest.fn() } })),
    };
    const service = new AuthService(prisma as never, { signAsync: jest.fn() } as never);
    await expect(service.changePassword('user-1', { currentPassword: 'WrongPassword1!', newPassword: 'NewPassword2@' })).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('rejects reusing the current password', async () => {
    const hash = await bcrypt.hash('CurrentPassword1!', 4);
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', passwordHash: hash, tokenVersion: 1, status: UserStatus.ACTIVE }) }, refreshSession: { updateMany: jest.fn() }, auditLog: { create: jest.fn() }, $transaction: jest.fn() };
    const service = new AuthService(prisma as never, { signAsync: jest.fn() } as never);
    await expect(service.changePassword('user-1', { currentPassword: 'CurrentPassword1!', newPassword: 'CurrentPassword1!' })).rejects.toBeInstanceOf(ConflictException);
  });

  it('invalidates all refresh sessions when the password changes', async () => {
    const hash = await bcrypt.hash('CurrentPassword1!', 4);
    const tx = { user: { update: jest.fn() }, refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 3 }) }, auditLog: { create: jest.fn() } };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', passwordHash: hash, tokenVersion: 4, status: UserStatus.ACTIVE }) }, refreshSession: {}, auditLog: {}, $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(tx)) };
    const service = new AuthService(prisma as never, { signAsync: jest.fn() } as never);
    await expect(service.changePassword('user-1', { currentPassword: 'CurrentPassword1!', newPassword: 'NewPassword2@' })).resolves.toEqual({ success: true, sessionsRevoked: true });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: expect.objectContaining({ tokenVersion: 5 }) });
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', revokedAt: null } }));
    expect(tx.auditLog.create).toHaveBeenCalled();
  });

  it('immediately invalidates access tokens when all sessions are revoked', async () => {
    const tx = { user: { update: jest.fn() }, refreshSession: { updateMany: jest.fn().mockResolvedValue({ count: 4 }) }, auditLog: { create: jest.fn() } };
    const prisma = { user: { findUnique: jest.fn().mockResolvedValue({ id: 'user-1', tokenVersion: 7, status: UserStatus.ACTIVE }) }, refreshSession: {}, auditLog: {}, $transaction: jest.fn(async (callback: (tx: any) => unknown) => callback(tx)) };
    const service = new AuthService(prisma as never, { signAsync: jest.fn() } as never);
    await expect(service.revokeAllSessions('user-1')).resolves.toEqual({ success: true, revokedCount: 4 });
    expect(tx.user.update).toHaveBeenCalledWith({ where: { id: 'user-1' }, data: { tokenVersion: 8 } });
    expect(tx.refreshSession.updateMany).toHaveBeenCalledWith(expect.objectContaining({ where: { userId: 'user-1', revokedAt: null } }));
    expect(tx.auditLog.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ entityType: 'UserSecurity', afterJson: expect.objectContaining({ action: 'ALL_SESSIONS_REVOKED' }) }) }));
  });

  it('does not allow revoking another user session', async () => {
    const prisma = { refreshSession: { findFirst: jest.fn().mockResolvedValue(null), update: jest.fn() }, user: {}, auditLog: {}, $transaction: jest.fn() };
    const service = new AuthService(prisma as never, { signAsync: jest.fn() } as never);
    await expect(service.revokeSession('user-1', 'session-2')).rejects.toBeInstanceOf(NotFoundException);
    expect(prisma.refreshSession.update).not.toHaveBeenCalled();
  });
});
