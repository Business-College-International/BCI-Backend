import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { RoleName, UserStatus } from '@prisma/client';
import * as bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import { PrismaService } from '../../prisma.service';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';

const ACCESS_TTL = '15m';
const REFRESH_DAYS = 30;

@Injectable()
export class AuthService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwt: JwtService,
  ) {}

  async registerGuardian(dto: RegisterDto) {
    const phone = dto.phone.trim();
    const email = dto.email?.trim().toLowerCase();

    const [phoneMatch, emailMatch] = await Promise.all([
      this.prisma.user.findUnique({ where: { phone } }),
      email ? this.prisma.user.findUnique({ where: { email } }) : null,
    ]);

    if (phoneMatch || emailMatch) {
      throw new ConflictException('An account already exists for that phone or email.');
    }

    const passwordHash = await bcrypt.hash(dto.password, 12);

    const user = await this.prisma.$transaction(async (tx) => {
      const existingPerson = await tx.person.findFirst({
        where: { phone },
        select: { id: true, firstName: true, lastName: true },
      });

      const person = existingPerson
        ? await tx.person.update({
            where: { id: existingPerson.id },
            data: {
              firstName: dto.firstName.trim(),
              lastName: dto.lastName.trim(),
              email,
            },
          })
        : await tx.person.create({
            data: {
              firstName: dto.firstName.trim(),
              lastName: dto.lastName.trim(),
              phone,
              email,
            },
          });

      const created = await tx.user.create({
        data: {
          personId: person.id,
          phone,
          email,
          passwordHash,
          roles: { create: { role: RoleName.GUARDIAN } },
          guardian: {
            create: { personId: person.id },
          },
        },
        include: { roles: true },
      });

      return created;
    });

    return this.issueTokens(user.id, user.tokenVersion, user.roles.map((r) => r.role));
  }

  async login(dto: LoginDto) {
    const identifier = dto.identifier.trim();
    const user = await this.prisma.user.findFirst({
      where: { OR: [{ phone: identifier }, { email: identifier.toLowerCase() }] },
      include: { roles: true },
    });

    if (!user || !(await bcrypt.compare(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Invalid credentials.');
    }
    if (user.status !== UserStatus.ACTIVE) {
      throw new UnauthorizedException('This account is not active.');
    }

    return this.issueTokens(user.id, user.tokenVersion, user.roles.map((r) => r.role));
  }

  async refresh(dto: RefreshDto) {
    const tokenHash = this.hashRefreshToken(dto.refreshToken);
    const session = await this.prisma.refreshSession.findUnique({
      where: { tokenHash },
      include: { user: { include: { roles: true } } },
    });

    if (
      !session ||
      session.revokedAt ||
      session.expiresAt <= new Date() ||
      session.user.status !== UserStatus.ACTIVE
    ) {
      throw new UnauthorizedException('Refresh session is invalid or expired.');
    }

    const result = await this.prisma.$transaction(async (tx) => {
      const refreshToken = randomBytes(48).toString('base64url');
      const replacement = await tx.refreshSession.create({
        data: {
          userId: session.userId,
          tokenHash: this.hashRefreshToken(refreshToken),
          expiresAt: this.refreshExpiry(),
          lastUsedAt: new Date(),
        },
      });

      await tx.refreshSession.update({
        where: { id: session.id },
        data: { revokedAt: new Date(), lastUsedAt: new Date(), replacedById: replacement.id },
      });

      const accessToken = await this.signAccessToken(
        session.user.id,
        session.user.tokenVersion,
        session.user.roles.map((r) => r.role),
      );

      return { accessToken, refreshToken };
    });

    return result;
  }

  async logout(dto: RefreshDto) {
    const tokenHash = this.hashRefreshToken(dto.refreshToken);
    await this.prisma.refreshSession.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return { success: true };
  }

  private async issueTokens(userId: string, tokenVersion: number, roles: RoleName[]) {
    const refreshToken = randomBytes(48).toString('base64url');
    const accessToken = await this.signAccessToken(userId, tokenVersion, roles);

    await this.prisma.refreshSession.create({
      data: {
        userId,
        tokenHash: this.hashRefreshToken(refreshToken),
        expiresAt: this.refreshExpiry(),
      },
    });

    return { accessToken, refreshToken };
  }

  private signAccessToken(userId: string, tokenVersion: number, roles: RoleName[]) {
    return this.jwt.signAsync(
      { sub: userId, ver: tokenVersion, roles },
      { expiresIn: ACCESS_TTL },
    );
  }

  private refreshExpiry() {
    return new Date(Date.now() + REFRESH_DAYS * 24 * 60 * 60 * 1000);
  }

  private hashRefreshToken(token: string) {
    return createHash('sha256').update(token).digest('hex');
  }
}
