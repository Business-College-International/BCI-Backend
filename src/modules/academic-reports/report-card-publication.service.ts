import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReportCardPublicationStatus, RoleName } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { AcademicReportsService } from './academic-reports.service';
import { ReportReadinessService } from './report-readiness.service';
import { assertPublicationTransition } from './publication-state';

const PUBLISH_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);

@Injectable()
export class ReportCardPublicationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: AcademicReportsService,
    private readonly readiness: ReportReadinessService,
  ) {}

  async prepare(studentId: string, termId: string, actorUserId: string, roles: RoleName[]) {
    this.assertPublishRole(roles);
    const term = await this.prisma.term.findUnique({ where: { id: termId }, select: { id: true, status: true } });
    if (!term) throw new NotFoundException('Term not found.');
    if (term.status !== 'CLOSED') throw new ConflictException('A report card can only be prepared after the term is closed.');

    const report = await this.reports.getStudentTermSummary(studentId, termId, actorUserId, roles);
    if (!report.placement) throw new ConflictException('Student has no active enrolment for this term.');
    if (report.calculation.mode === 'MIXED_POLICY_REQUIRED') throw new ConflictException('Mixed assessment weighting must be resolved before publication.');
    if (!report.grading.assigned || !report.grading.policyVersionId) throw new ConflictException('An active grading policy is required before publication.');

    const readiness = await this.readiness.getClassReadiness(report.placement.class.id, termId, actorUserId, roles);
    const studentReadiness = readiness.students.find((item) => item.student.id === studentId);
    if (!studentReadiness || !studentReadiness.ready) {
      throw new ConflictException('Student is not ready for publication: ' + (studentReadiness?.reasons.join(', ') ?? 'NOT_ENROLLED'));
    }

    const snapshot = this.snapshotFromReport(report);
    const snapshotHash = createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(
          "SELECT pg_advisory_xact_lock(hashtext('bci:report-publication:' || $1 || ':' || $2))",
          studentId,
          termId,
        );

        const current = await tx.reportCardPublication.findFirst({
          where: { studentId, termId, status: ReportCardPublicationStatus.PUBLISHED },
          select: { id: true },
        });
        if (current) throw new ConflictException('A current report card is already published. Void it before preparing a replacement.');

        const latest = await tx.reportCardPublication.findFirst({
          where: { studentId, termId },
          orderBy: { publicationVersion: 'desc' },
          select: { publicationVersion: true },
        });
        const publication = await tx.reportCardPublication.create({
          data: {
            studentId,
            termId,
            publicationVersion: (latest?.publicationVersion ?? 0) + 1,
            status: ReportCardPublicationStatus.READY_FOR_PUBLICATION,
            snapshotJson: snapshot,
            snapshotHash,
            gradingPolicyVersionId: report.grading.policyVersionId,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'ReportCardPublication',
            entityId: publication.id,
            afterJson: {
              publicationVersion: publication.publicationVersion,
              status: publication.status,
              snapshotHash,
              gradingPolicyVersionId: report.grading.policyVersionId,
            },
          },
        });
        return publication;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 15000 });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') throw new ConflictException('Report-card preparation conflicted with another publication. Please retry.');
      if ((error as { code?: string }).code === 'P2002') throw new ConflictException('A publication for this student and term already exists. Retry after reconciling the current publication state.');
      throw error;
    }
  }

  async publish(id: string, actorUserId: string, roles: RoleName[]) {
    this.assertPublishRole(roles);
    try {
      return await this.prisma.$transaction(async (tx) => {
        const publication = await tx.reportCardPublication.findUnique({ where: { id } });
        if (!publication) throw new NotFoundException('Report-card publication not found.');
        assertPublicationTransition(publication.status, ReportCardPublicationStatus.PUBLISHED);

        await tx.$executeRawUnsafe(
          "SELECT pg_advisory_xact_lock(hashtext('bci:report-publication:' || $1 || ':' || $2))",
          publication.studentId,
          publication.termId,
        );

        const current = await tx.reportCardPublication.findFirst({
          where: { studentId: publication.studentId, termId: publication.termId, status: ReportCardPublicationStatus.PUBLISHED, id: { not: id } },
          select: { id: true },
        });
        if (current) throw new ConflictException('Another published report exists for this student and term.');

        const report = await this.reports.getStudentTermSummary(publication.studentId, publication.termId, actorUserId, roles);
        const currentHash = createHash('sha256').update(JSON.stringify(this.snapshotFromReport(report))).digest('hex');
        if (currentHash !== publication.snapshotHash) {
          throw new ConflictException('The prepared report snapshot is stale. Re-prepare the report after reconciling the underlying academic record.');
        }

        const updated = await tx.reportCardPublication.update({
          where: { id },
          data: { status: ReportCardPublicationStatus.PUBLISHED, publishedAt: new Date(), publishedBy: actorUserId },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'UPDATE',
            entityType: 'ReportCardPublication',
            entityId: id,
            beforeJson: { status: publication.status, publicationVersion: publication.publicationVersion },
            afterJson: { status: updated.status, publicationVersion: updated.publicationVersion, publishedAt: updated.publishedAt },
          },
        });
        return updated;
      }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable, maxWait: 5000, timeout: 20000 });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') throw new ConflictException('Report-card publication conflicted with another publication. Please retry.');
      throw error;
    }
  }

  async void(id: string, actorUserId: string, roles: RoleName[], reason: string) {
    this.assertPublishRole(roles);
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new ConflictException('A reason is required to void a published report card.');

    return this.prisma.$transaction(async (tx) => {
      const publication = await tx.reportCardPublication.findUnique({ where: { id } });
      if (!publication) throw new NotFoundException('Report-card publication not found.');
      assertPublicationTransition(publication.status, ReportCardPublicationStatus.VOIDED);
      const updated = await tx.reportCardPublication.update({
        where: { id },
        data: { status: ReportCardPublicationStatus.VOIDED, voidedAt: new Date(), voidedBy: actorUserId, voidReason: trimmedReason },
      });
      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'ReportCardPublication',
          entityId: id,
          beforeJson: { status: publication.status, publicationVersion: publication.publicationVersion },
          afterJson: { status: updated.status, voidReason: trimmedReason },
        },
      });
      return updated;
    });
  }

  async current(studentId: string, termId: string, actorUserId: string, roles: RoleName[]) {
    await this.reports.getStudentTermSummary(studentId, termId, actorUserId, roles);
    const current = await this.prisma.reportCardPublication.findFirst({
      where: { studentId, termId, status: ReportCardPublicationStatus.PUBLISHED },
      orderBy: { publicationVersion: 'desc' },
    });
    if (!current) throw new NotFoundException('No published report card exists for this student and term.');
    return current;
  }

  private snapshotFromReport(report: Awaited<ReturnType<AcademicReportsService['getStudentTermSummary']>>) {
    return {
      schemaVersion: 1,
      student: report.student,
      term: report.term,
      placement: report.placement,
      calculation: report.calculation,
      subjects: report.subjects,
      assessments: report.assessments,
      attendance: report.attendance,
      grading: report.grading,
    };
  }

  private assertPublishRole(roles: RoleName[]) {
    if (!roles.some((role) => PUBLISH_ROLES.has(role))) throw new ForbiddenException('Only authorized academic/office leadership may publish report cards.');
  }
}