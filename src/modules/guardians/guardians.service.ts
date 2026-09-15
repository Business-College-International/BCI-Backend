import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

@Injectable()
export class GuardiansService {
  constructor(private readonly prisma: PrismaService) {}

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
    const guardian = await this.prisma.guardian.findUnique({
      where: { userId },
      include: { person: true, user: true },
    });

    if (!guardian) throw new NotFoundException('Guardian profile not found.');

    const phone = dto.phone?.trim() || guardian.person.phone;
    const email = dto.email?.trim().toLowerCase();

    if (phone && phone !== guardian.user?.phone) {
      const existingPhone = await this.prisma.user.findUnique({ where: { phone } });
      if (existingPhone && existingPhone.id !== userId) {
        throw new ConflictException('That phone number is already attached to another account.');
      }
    }

    if (email && email !== guardian.user?.email) {
      const existingEmail = await this.prisma.user.findUnique({ where: { email } });
      if (existingEmail && existingEmail.id !== userId) {
        throw new ConflictException('That email address is already attached to another account.');
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const person = await tx.person.update({
        where: { id: guardian.personId },
        data: {
          firstName: dto.firstName.trim(),
          lastName: dto.lastName.trim(),
          phone,
          email,
          address: dto.address?.trim(),
          occupation: dto.occupation?.trim(),
          hometown: dto.hometown?.trim(),
          region: dto.region?.trim(),
        },
      });

      await tx.user.update({
        where: { id: userId },
        data: { phone, email },
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
            phone: guardian.person.phone,
            email: guardian.person.email,
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
            phone: person.phone,
            email: person.email,
            address: person.address,
            occupation: person.occupation,
            hometown: person.hometown,
            region: person.region,
            preferredSms: updatedGuardian.preferredSms,
            preferredPush: updatedGuardian.preferredPush,
          },
        },
      });

      return this.getMyProfile(userId);
    });
  }
}
