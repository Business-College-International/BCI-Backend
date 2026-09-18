import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { UpdateStaffRecordDto } from './dto/update-staff-record.dto';

@Injectable()
export class StaffManagementService {
  constructor(private readonly prisma: PrismaService) {}

  async getStaffRecord(staffPersonId: string) {
    const staff = await this.prisma.staff.findUnique({
      where: { personId: staffPersonId },
      include: {
        person: {
          select: {
            id: true,
            firstName: true,
            middleName: true,
            lastName: true,
            phone: true,
            email: true,
            photoUrl: true,
            address: true,
          },
        },
        user: { select: { id: true, status: true, roles: { select: { role: true } } } },
        duties: { orderBy: { startsAt: 'desc' } },
        teaching: {
          include: {
            class: { select: { id: true, name: true, level: true, programme: true } },
            subject: { select: { id: true, code: true, name: true } },
            term: { select: { id: true, code: true, name: true, startsAt: true, endsAt: true, status: true } },
          },
          orderBy: { term: { startsAt: 'desc' } },
        },
      },
    });
    if (!staff) throw new NotFoundException('Staff member not found.');
    return staff;
  }

  async updateStaffRecord(staffPersonId: string, dto: UpdateStaffRecordDto, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT "personId" FROM "Staff" WHERE "personId" = ${staffPersonId} FOR UPDATE`;

        const existing = await tx.staff.findUnique({ where: { personId: staffPersonId } });
        if (!existing) throw new NotFoundException('Staff member not found.');

        if (dto.employmentStatus === 'terminated') {
          const activePayroll = await tx.payrollEntry.count({
            where: { staffId: staffPersonId, status: { in: ['pending', 'calculated', 'approved'] } },
          });
          if (activePayroll > 0) {
            throw new ConflictException('Staff member has unresolved payroll entries and cannot be terminated yet.');
          }
        }

        const staff = await tx.staff.update({
          where: { personId: staffPersonId },
          data: {
            ...(dto.department !== undefined ? { department: dto.department.trim() || null } : {}),
            ...(dto.contractType !== undefined ? { contractType: dto.contractType.trim() || null } : {}),
            ...(dto.employmentStatus !== undefined ? { employmentStatus: dto.employmentStatus } : {}),
          },
          include: { person: { select: { firstName: true, lastName: true } } },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'UPDATE',
            entityType: 'Staff',
            entityId: staffPersonId,
            beforeJson: {
              department: existing.department,
              contractType: existing.contractType,
              employmentStatus: existing.employmentStatus,
            },
            afterJson: {
              department: staff.department,
              contractType: staff.contractType,
              employmentStatus: staff.employmentStatus,
            },
          },
        });
        return staff;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Staff record changed concurrently. Please retry the staff update.');
      }
      throw error;
    }
  }

  async completeDuty(dutyId: string, actorUserId: string) {
    const duty = await this.prisma.staffDuty.findUnique({ where: { id: dutyId } });
    if (!duty) throw new NotFoundException('Staff duty not found.');
    if (!duty.active) throw new BadRequestException('Duty is already inactive.');

    const updated = await this.prisma.$transaction(async (tx) => {
      const result = await tx.staffDuty.update({ where: { id: dutyId }, data: { active: false } });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'StaffDuty',
          entityId: dutyId,
          beforeJson: { active: true },
          afterJson: { active: false },
        },
      });
      return result;
    });
    return updated;
  }
}
