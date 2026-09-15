import {
  ConflictException,
  Injectable,
  UnauthorizedException,
  NotFoundException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RoleName, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

const ACCESS_TTL = '15m';
const REFRESH_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(private readonly prisma: PrismaService, private readonly jwt: JwtService) {}

  async registerGuardian(dto: RegisterDto) {
    const phone = dto.phone.trim();
    const email = dto.email?.trim().toLowerCase();
    const [phoneMatch, emailMatch] = await Promise.all([this.prisma.user.findUnique({ where: { phone } }), email ? this.prisma.user.findUnique({ where: { email } }) : null]);
    if (phoneMatch || emailMatch) throw new ConflictException('An account already exists for that phone or email.');
    const passwordHash = await bcrypt.hash(dto.password, 12);
    const user = await this.prisma.$transaction(async (tx) => {
      const existingPerson = await tx.person.findFirst({ where: { phone }, select: { id: true } });
      const person = existingPerson
        ? await tx.person.update({ where: { id: existingPerson.id }, data: { firstName: dto.firstName.trim(), lastName: dto.lastName.trim(), email } })
        : await tx.person.create({ data: { firstName: dto.firstName.trim(), lastName: dto.lastName.trim(), phone, email } });
      return tx.user.create({ data: { personId: person.id, phone, email, passwordHash, roles: { create: { role: RoleName.GUARDIAN } }, guardian: { create: { personId: person.id } } }, include: { roles: true } });
    });
    return this.issueTokens(user.id, user.tokenVersion, user.roles.map((r) => r.role));
  }

  async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();
    const user = await this.prisma.user.findFirst({ where: { OR: [{ phone: identifier }, { email: identifier.toLowerCase() }] }, include: { roles: true } });
    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) throw new UnauthorizedException('Invalid credentials.');
    if (user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('This account is not active.');
    return this.issueTokens(user.id, user.tokenVersion, user.roles.map((r) => r.role));
  }

  async getCurrentUser(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, include: { roles: true, directPermissions: { select: { permissionCode: true, scopeType: true, scopeId: true } }, person: { select: { id: true, firstName: true, middleName: true, lastName: true, phone: true, email: true, photoUrl: true } }, guardian: { select: { personId: true, preferredSms: true, preferredPush: true } }, staff: { select: { personId: true, staffIdNo: true, department: true, employmentStatus: true } } } });
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Session is no longer valid.');
    const roles = user.roles.map((role) => role.role);
    const [rolePermissions, directPermissions] = await Promise.all([
      this.prisma.rolePermission.findMany({ where: { role: { in: roles } }, select: { role: true, permissionCode: true } }),
      Promise.resolve(user.directPermissions),
    ]);
    const effectivePermissionCodes = new Set<string>([...rolePermissions.map((permission) => permission.permissionCode), ...directPermissions.map((permission) => permission.permissionCode)]);
    return { id: user.id, status: user.status, roles, permissions: Array.from(effectivePermissionCodes).sort(), permissionAssignments: directPermissions, person: user.person, guardian: user.guardian, staff: user.staff };
  }

  async listMySessions(userId: string) {
    return this.prisma.refreshSession.findMany({ where: { userId }, select: { id: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true }, orderBy: { createdAt: 'desc' }, take: 25 });
  }

  async changePassword(userId: string, dto: ChangePasswordDto) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, passwordHash: true, tokenVersion: true, status: true } });
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Account is not active.');
    if (!(await bcrypt.compare(dto.currentPassword, user.passwordHash))) throw new UnauthorizedException('Current password is incorrect.');
    if (dto.currentPassword === dto.newPassword) throw new ConflictException('New password must be different from the current password.');
    const passwordHash = await bcrypt.hash(dto.newPassword, 12);
    const nextTokenVersion = user.tokenVersion + 1;
    await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { passwordHash, tokenVersion: nextTokenVersion } });
      await tx.refreshSession.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: { actorUserId: user.id, action: 'UPDATE', entityType: 'UserSecurity', entityId: user.id, beforeJson: { tokenVersion: user.tokenVersion }, afterJson: { tokenVersion: nextTokenVersion, action: 'PASSWORD_CHANGED_AND_SESSIONS_REVOKED' } } });
    });
    return { success: true, sessionsRevoked: true };
  }

  async revokeSession(userId: string, sessionId: string) {
    const session = await this.prisma.refreshSession.findFirst({ where: { id: sessionId, userId } });
    if (!session) throw new NotFoundException('Session not found.');
    await this.prisma.refreshSession.update({ where: { id: sessionId }, data: { revokedAt: session.revokedAt ?? new Date() } });
    return { success: true };
  }

  async revokeAllSessions(userId: string) {
    const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { id: true, tokenVersion: true, status: true } });
    if (!user || user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Account is not active.');
    const revokedAt = new Date();
    const nextTokenVersion = user.tokenVersion + 1;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.user.update({ where: { id: user.id }, data: { tokenVersion: nextTokenVersion } });
      const revoked = await tx.refreshSession.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt } });
      await tx.auditLog.create({ data: { actorUserId: user.id, action: 'LOGOUT', entityType: 'UserSecurity', entityId: user.id, beforeJson: { tokenVersion: user.tokenVersion }, afterJson: { tokenVersion: nextTokenVersion, action: 'ALL_SESSIONS_REVOKED' } } });
      return revoked;
    });
    return { success: true, revokedCount: result.count };
  }

  async refresh(dto: RefreshDto) {
    const tokenHash = this.hashRefreshToken(dto.refreshToken);
    const session = await this.prisma.refreshSession.findUnique({ where: { tokenHash }, include: { user: { include: { roles: true } } } });
    if (!session || session.revokedAt || session.expiresAt <= new Date() || session.user.status !== UserStatus.ACTIVE) throw new UnauthorizedException('Refresh session is invalid or expired.');
    return this.prisma.$transaction(async (tx) => {
      const refreshToken = randomBytes(48).toString('base64url');
      const replacement = await tx.refreshSession.create({ data: { userId: session.userId, tokenHash: this.hashRefreshToken(refreshToken), expiresAt: this.refreshExpiry(), lastUsedAt: new Date() } });
      await tx.refreshSession.update({ where: { id: session.id }, data: { revokedAt: new Date(), lastUsedAt: new Date(), replacedById: replacement.id } });
      const accessToken = await this.signAccessToken(session.user.id, session.user.tokenVersion, session.user.roles.map((r) => r.role));
      return { accessToken, refreshToken };
    });
  }

  async logout(dto: RefreshDto) {
    const tokenHash = this.hashRefreshToken(dto.refreshToken);
    await this.prisma.refreshSession.updateMany({ where: { tokenHash, revokedAt: null }, data: { revokedAt: new Date() } });
    return { success: true };
  }

  private async issueTokens(userId: string, tokenVersion: number, roles: RoleName[]) {
    const refreshToken = randomBytes(48).toString('base64url');
    const accessToken = await this.signAccessToken(userId, tokenVersion, roles);
    await this.prisma.refreshSession.create({ data: { userId, tokenHash: this.hashRefreshToken(refreshToken), expiresAt: this.refreshExpiry() } });
    return { accessToken, refreshToken };
  }

  private signAccessToken(userId: string, tokenVersion: number, roles: RoleName[]) { return this.jwt.signAsync({ sub: userId, ver: tokenVersion, roles }, { expiresIn: ACCESS_TTL }); }
  private refreshExpiry() { return new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000); }
  private hashRefreshToken(token: string) { return createHash('sha256').update(token).digest('hex'); }
}
