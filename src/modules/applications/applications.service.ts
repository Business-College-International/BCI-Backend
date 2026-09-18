import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AdmissionDecision, ApplicationStatus, Prisma, RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AdmitApplicationDto } from './dto/admit-application.dto';
import { CreateApplicationDto } from './dto/create-application.dto';

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateApplicationDto) {
    return this.prisma.application.create({
      data: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        dob: new Date(dto.dob),
        levelApplied: dto.levelApplied,
        programmeApplied: dto.programmeApplied,
        guardianName: dto.guardianName.trim(),
        guardianPhone: dto.guardianPhone.trim(),
        previousSchool: dto.previousSchool?.trim(),
        passportPhotoUrl: dto.passportPhotoUrl?.trim(),
      },
      select: { id: true, trackingCode: true, status: true, submittedAt: true },
    });
  }

  async findByTrackingCode(trackingCode: string) {
    const application = await this.prisma.application.findUnique({
      where: { trackingCode },
      select: {
        trackingCode: true,
        levelApplied: true,
        programmeApplied: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
        admissionDecisions: {
          orderBy: { decidedAt: 'asc' },
          select: { decision: true, decidedAt: true },
        },
      },
    });
    if (!application) throw new NotFoundException('Application not found');

    const events = [
      { code: 'SUBMITTED', at: application.submittedAt },
      ...application.admissionDecisions.map((decision) => ({
        code: decision.decision === AdmissionDecision.ADMITTED ? 'ADMITTED' : 'REJECTED',
        at: decision.decidedAt,
      })),
    ].sort((a, b) => a.at.getTime() - b.at.getTime());

    return {
      trackingCode: application.trackingCode,
      levelApplied: application.levelApplied,
      programmeApplied: application.programmeApplied,
      status: application.status,
      submittedAt: application.submittedAt,
      updatedAt: application.updatedAt,
      timeline: events,
    };
  }

  async listForStaff() {
    return this.prisma.application.findMany({
      orderBy: { submittedAt: 'desc' },
      select: {
        id: true,
        trackingCode: true,
        firstName: true,
        lastName: true,
        dob: true,
        levelApplied: true,
        programmeApplied: true,
        guardianName: true,
        guardianPhone: true,
        status: true,
        submittedAt: true,
        updatedAt: true,
      },
    });
  }

  async review(
    id: string,
    status: 'UNDER_REVIEW' | 'REJECTED',
    reason: string | undefined,
    actorUserId: string,
  ) {
    return this.prisma.$transaction(async (tx) => {
      const current = await tx.application.findUnique({ where: { id } });
      if (!current) throw new NotFoundException('Application not found');
      if (!([ApplicationStatus.PENDING, ApplicationStatus.UNDER_REVIEW] as ApplicationStatus[]).includes(current.status)) {
        throw new ConflictException('This application is already in a terminal state.');
      }

      const transition = await tx.application.updateMany({
        where: { id, status: current.status },
        data: { status, reviewedBy: actorUserId },
      });
      if (transition.count !== 1) {
        throw new ConflictException('Application changed while it was being reviewed.');
      }

      const updated = await tx.application.findUnique({
        where: { id },
        select: { id: true, trackingCode: true, status: true, updatedAt: true },
      });

      if (!updated) throw new NotFoundException('Application not found');

      if (status === ApplicationStatus.REJECTED) {
        await tx.admissionDecisionRecord.create({
          data: { applicationId: id, decision: AdmissionDecision.REJECTED, decidedBy: actorUserId, reason },
        });
      }

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: status === ApplicationStatus.REJECTED ? 'REJECT' : 'UPDATE',
          entityType: 'Application',
          entityId: id,
          beforeJson: { status: current.status },
          afterJson: { status },
        },
      });

      return updated;
    });
  }

  async admit(id: string, dto: AdmitApplicationDto, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        // Serialize admission for the application and destination class.
        // The class lock is what makes the capacity check authoritative when
        // multiple admissions target the same capacity-limited class.
        await tx.$queryRaw`SELECT id FROM "Application" WHERE id = ${id} FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "SchoolClass" WHERE id = ${dto.classId} FOR UPDATE`;

        const current = await tx.application.findUnique({ where: { id } });
        if (!current) throw new NotFoundException('Application not found');
        if (current.status !== ApplicationStatus.UNDER_REVIEW) {
          throw new ConflictException('Only applications under review can be admitted.');
        }

        const [academicYear, term, schoolClass] = await Promise.all([
          tx.academicYear.findUnique({ where: { id: dto.academicYearId } }),
          tx.term.findUnique({ where: { id: dto.termId } }),
          tx.schoolClass.findUnique({ where: { id: dto.classId } }),
        ]);

        if (!academicYear || !term || !schoolClass) {
          throw new NotFoundException('Academic year, term, or class was not found.');
        }
        if (term.academicYearId !== academicYear.id) {
          throw new BadRequestException('The selected term does not belong to the selected academic year.');
        }
        if (schoolClass.academicYearId !== academicYear.id) {
          throw new BadRequestException('The selected class does not belong to the selected academic year.');
        }
        if (term.startsAt < academicYear.startsAt || term.endsAt > academicYear.endsAt) {
          throw new BadRequestException('The selected term falls outside the selected academic year.');
        }
        if (schoolClass.level !== current.levelApplied || schoolClass.programme !== current.programmeApplied) {
          throw new BadRequestException('The selected class does not match the application level/programme.');
        }
        if (term.status !== 'OPEN') {
          throw new BadRequestException('The selected term is not open for enrolment.');
        }

        if (schoolClass.capacity !== null) {
          const activeEnrollmentCount = await tx.enrolment.count({
            where: {
              classId: schoolClass.id,
              termId: term.id,
              status: 'ACTIVE',
            },
          });
          if (activeEnrollmentCount >= schoolClass.capacity) {
            throw new ConflictException('The selected class is already at capacity.');
          }
        }

        const existingStudent = await tx.student.findUnique({ where: { applicationId: id } });
        if (existingStudent) throw new ConflictException('This application has already created a student.');

        if (dto.admissionNumber) {
          const existingAdmissionNumber = await tx.student.findUnique({
            where: { admissionNumber: dto.admissionNumber.trim() },
            select: { id: true },
          });
          if (existingAdmissionNumber) {
            throw new ConflictException('The admission number is already in use.');
          }
        }

        const applicationTransition = await tx.application.updateMany({
          where: { id, status: ApplicationStatus.UNDER_REVIEW },
          data: { status: ApplicationStatus.ADMITTED, reviewedBy: actorUserId },
        });
        if (applicationTransition.count !== 1) {
          throw new ConflictException('Application changed while it was being admitted.');
        }

        const student = await tx.student.create({
          data: {
            applicationId: id,
            firstName: current.firstName,
            lastName: current.lastName,
            dateOfBirth: current.dob,
            passportPhotoUrl: current.passportPhotoUrl,
            previousSchool: current.previousSchool,
            admittedAt: new Date(),
            admissionNumber: dto.admissionNumber?.trim() || undefined,
          },
        });

        const guardianPhone = current.guardianPhone.trim();
        const existingUser = await tx.user.findUnique({
          where: { phone: guardianPhone },
          include: { roles: true },
        });

        let guardianPersonId: string;
        if (existingUser) {
          const isGuardian = existingUser.roles.some((assignment) => assignment.role === RoleName.GUARDIAN);
          if (!isGuardian || !existingUser.personId) {
            throw new ConflictException('The guardian phone number belongs to a non-guardian account. Resolve the identity before admission.');
          }
          guardianPersonId = existingUser.personId;

          await tx.guardian.upsert({
            where: { personId: guardianPersonId },
            create: { personId: guardianPersonId, userId: existingUser.id },
            update: { userId: existingUser.id },
          });
        } else {
          const existingPerson = await tx.person.findFirst({
            where: { phone: guardianPhone },
            select: { id: true },
          });

          if (existingPerson) {
            guardianPersonId = existingPerson.id;
            await tx.guardian.upsert({
              where: { personId: guardianPersonId },
              create: { personId: guardianPersonId },
              update: {},
            });
          } else {
            const guardianPerson = await tx.person.create({
              data: {
                firstName: current.guardianName.split(' ')[0] || current.guardianName,
                lastName: current.guardianName.split(' ').slice(1).join(' ') || 'Guardian',
                phone: guardianPhone,
              },
            });
            guardianPersonId = guardianPerson.id;
            await tx.guardian.create({ data: { personId: guardianPersonId } });
          }
        }

        const existingLink = await tx.guardianStudent.findUnique({
          where: { guardianId_studentId: { guardianId: guardianPersonId, studentId: student.id } },
        });
        if (!existingLink) {
          await tx.guardianStudent.create({
            data: { guardianId: guardianPersonId, studentId: student.id, relationship: 'guardian', isPrimaryContact: true },
          });
        }

        const enrolment = await tx.enrolment.create({
          data: {
            studentId: student.id,
            academicYearId: academicYear.id,
            termId: term.id,
            classId: schoolClass.id,
            level: current.levelApplied,
            programme: current.programmeApplied,
            status: 'ACTIVE',
          },
        });

        await tx.admissionDecisionRecord.create({
          data: { applicationId: id, decision: AdmissionDecision.ADMITTED, decidedBy: actorUserId },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'APPROVE',
            entityType: 'Application',
            entityId: id,
            beforeJson: { status: ApplicationStatus.UNDER_REVIEW },
            afterJson: { status: ApplicationStatus.ADMITTED, studentId: student.id, enrolmentId: enrolment.id },
          },
        });

        return { applicationId: id, student, enrolment };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Admission changed concurrently. Please retry the admission.');
      }
      throw error;
    }
  }
}
