import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';
import { ListGuardiansDto } from './dto/list-guardians.dto';

const GUARDIAN_DIRECTORY_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
]);

@Injectable()
export class GuardiansService {
  constructor(private readonly prisma: PrismaService) {}

  async listDirectory(query: ListGuardiansDto, roles: RoleName[]) {
    if (!roles.some((role) => GUARDIAN_DIRECTORY_ROLES.has(role))) {
      throw new ForbiddenException('Guardian directory access is restricted.');
    }

    const q = query.q?.trim();
    const guardians = await this.prisma.guardian.findMany({
      where: q
        ? {
            person: {
              OR: [
                { firstName: { contains: q, mode: 'insensitive' } },
                { lastName: { contains: q, mode: 'insensitive' } },
                { phone: { contains: q, mode: 'insensitive' } },
                { email: { contains: q, mode: 'insensitive' } },
              ],
            },
          }
        : undefined,
      include: {
        person: { select: { firstName: true, middleName: true, lastName: true, phone: true, email: true } },
        _count: { select: { wards: true } },
      },
      orderBy: [{ person: { lastName: 'asc' } }, { person: { firstName: 'asc' } }],
      take: 250,
    });

    return guardians.map((guardian) => ({
      personId: guardian.personId,
      name: [guardian.person.firstName, guardian.person.middleName, guardian.person.lastName].filter(Boolean).join(' '),
      phone: guardian.person.phone,
      email: guardian.person.email,
      wardCount: guardian._count.wards,
    }));
  }

  async getMyProfile(userId: string) {
    const guardian = await this.prisma.guardian.findUnique({
      where: { userId },
      include: { person: true },
    });

    if (!guardian) throw new NotFoundException('Guardian profile not found.');

    return {
      firstName: guardian.person.firstName,
      middleName: guardian.person.middleName,
      lastName: guardian.person.lastName,
      phone: guardian.person.phone,
      email: guardian.person.email,
      address: guardian.person.address,
      occupation: guardian.person.occupation,
      hometown: guardian.person.hometown,
      region: guardian.person.region,
      preferredSms: guardian.preferredSms,
      preferredPush: guardian.preferredPush,
    };
  }

  async updateMyProfile(userId: string, dto: UpdateMyProfileDto) {
    return this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT "personId" FROM "Guardian" WHERE "userId" = ${userId} FOR UPDATE`;

      const guardian = await tx.guardian.findUnique({
        where: { userId },
        include: { person: true },
      });
      if (!guardian) throw new NotFoundException('Guardian profile not found.');

      const person = await tx.person.update({
        where: { id: guardian.personId },
        data: {
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          address: dto.address?.trim(),
          occupation: dto.occupation?.trim(),
          hometown: dto.hometown?.trim(),
          region: dto.region?.trim(),
        },
      });

      const updatedGuardian = await tx.guardian.update({
        where: { userId },
        data: {
          preferredSms: dto.preferredSms ?? guardian.preferredSms,
          preferredPush: dto.preferredPush ?? guardian.preferredPush,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId: userId,
          actorPersonId: guardian.personId,
          action: 'UPDATE',
          entityType: 'GuardianProfile',
          entityId: guardian.personId,
          beforeJson: {
            firstName: guardian.person.firstName,
            lastName: guardian.person.lastName,
            address: guardian.person.address,
            occupation: guardian.person.occupation,
            hometown: guardian.person.hometown,
            region: guardian.person.region,
            preferredSms: guardian.preferredSms,
            preferredPush: guardian.preferredPush,
          },
          afterJson: {
            firstName: person.firstName,
            lastName: person.lastName,
            address: person.address,
            occupation: person.occupation,
            hometown: person.hometown,
            region: person.region,
            preferredSms: updatedGuardian.preferredSms,
            preferredPush: updatedGuardian.preferredPush,
          },
        },
      });

      return {
        firstName: person.firstName,
        middleName: person.middleName,
        lastName: person.lastName,
        phone: guardian.person.phone,
        email: guardian.person.email,
        address: person.address,
        occupation: person.occupation,
        hometown: person.hometown,
        region: person.region,
        preferredSms: updatedGuardian.preferredSms,
        preferredPush: updatedGuardian.preferredPush,
      };
    });
  }
}
