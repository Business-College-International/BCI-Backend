import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, ReportCardCorrectionDecision, ReportCardPublicationStatus, RoleName } from '@prisma/client';
import { createHash } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { AcademicReportsService } from './academic-reports.service';
import { assertCorrectionDecisionTransition } from './publication-state';

const REQUEST_ROLES = new Set<RoleName>([RoleName.TEACHER]);
const REVIEW_ROLES = new Set<RoleName>([RoleName.DIRECTOR, RoleName.PRINCIPAL, RoleName.OFFICE]);

@Injectable()
export class ReportCardCorrectionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reports: AcademicReportsService,
  ) {}

  async request(
    studentId: string,
    termId: string,
    reason: string,
    actorUserId: string,
    roles: RoleName[],
  ) {
    this.assertRequestAccess(roles);
    const trimmedReason = reason.trim();
    if (!trimmedReason) throw new ConflictException('A correction reason is required.');

    const current = await this.prisma.reportCardPublication.findFirst({
      where: { studentId, termId, status: ReportCardPublicationStatus.PUBLISHED },
      orderBy: { publicationVersion: 'desc' },
    });
    if (!current) throw new ConflictException('A correction can only be requested for a currently published report card.');

    const report = await this.reports.getStudentTermSummary(studentId, termId, actorUserId, roles);
    if (!report.grading.assigned || !report.grading.policyVersionId) {
      throw new ConflictException('A correction request requires a report with an assigned grading-policy version.');
    }

    const replacementSnapshot = this.snapshotFromReport(report);
    const replacementSnapshotHash = hashSnapshot(replacementSnapshot);

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "ReportCardPublication" WHERE id = ${current.id} FOR UPDATE`;
      const latestCurrent = await tx.reportCardPublication.findUnique({ where: { id: current.id } });
      if (!latestCurrent || latestCurrent.status !== ReportCardPublicationStatus.PUBLISHED) {
        throw new ConflictException('The current published report changed while the correction request was being prepared.');
      }

      const pending = await tx.reportCardCorrectionRequest.findFirst({
        where: {
          studentId,
          termId,
          targetPublicationId: current.id,
          decision: ReportCardCorrectionDecision.PENDING,
        },
        select: { id: true },
      });
      if (pending) throw new ConflictException('A correction request is already pending for this published report.');

      const created = await tx.reportCardCorrectionRequest.create({
        data: {
          studentId,
          termId,
          targetPublicationId: current.id,
          replacementSnapshotJson: replacementSnapshot,
          replacementSnapshotHash,
          gradingPolicyVersionId: report.grading.policyVersionId,
          reason: trimmedReason,
          requestedBy: actorUserId,
        },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'CREATE',
          entityType: 'ReportCardCorrectionRequest',
          entityId: created.id,
          afterJson: {
            targetPublicationId: created.targetPublicationId,
            publicationVersion: current.publicationVersion,
            replacementSnapshotHash,
            gradingPolicyVersionId: created.gradingPolicyVersionId,
            reason: created.reason,
          },
        },
      });

      return created;
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 15000,
    });
  }

  async list(studentId: string, termId: string, actorUserId: string, roles: RoleName[]) {
    if (roles.some((role) => REVIEW_ROLES.has(role))) {
      return this.prisma.reportCardCorrectionRequest.findMany({
        where: { studentId, termId },
        orderBy: { requestedAt: 'desc' },
      });
    }
    this.assertRequestAccess(roles);
    await this.reports.getStudentTermSummary(studentId, termId, actorUserId, roles);
    return this.prisma.reportCardCorrectionRequest.findMany({
      where: { studentId, termId },
      orderBy: { requestedAt: 'desc' },
    });
  }

  async approve(id: string, decisionNote: string, actorUserId: string, roles: RoleName[]) {
    this.assertReviewAccess(roles);
    const trimmedNote = decisionNote.trim();
    if (!trimmedNote) throw new ConflictException('An approval note is required.');

    const report = await this.prisma.reportCardCorrectionRequest.findUnique({
      where: { id },
      select: {
        id: true,
        studentId: true,
        termId: true,
        targetPublicationId: true,
        replacementSnapshotJson: true,
        replacementSnapshotHash: true,
        gradingPolicyVersionId: true,
        decision: true,
        reason: true,
      },
    });
    if (!report) throw new NotFoundException('Report-card correction request not found.');
    assertCorrectionDecisionTransition(report.decision, ReportCardCorrectionDecision.APPROVED);

    const authoritativeReport = await this.reports.getStudentTermSummary(
      report.studentId,
      report.termId,
      actorUserId,
      roles,
    );
    if (!authoritativeReport.grading.assigned || authoritativeReport.grading.policyVersionId !== report.gradingPolicyVersionId) {
      throw new ConflictException('The correction request no longer matches the current grading-policy version. Recalculate and submit a new request.');
    }

    const authoritativeSnapshot = this.snapshotFromReport(authoritativeReport);
    if (hashSnapshot(authoritativeSnapshot) !== report.replacementSnapshotHash) {
      throw new ConflictException('The proposed correction snapshot is stale. Recalculate the report and submit a new correction request.');
    }

    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT id FROM "ReportCardCorrectionRequest" WHERE id = ${id} FOR UPDATE`;
        await tx.$executeRaw`SELECT id FROM "ReportCardPublication" WHERE id = ${report.targetPublicationId} FOR UPDATE`;

        const request = await tx.reportCardCorrectionRequest.findUnique({ where: { id } });
        if (!request) throw new NotFoundException('Report-card correction request not found.');
        if (request.decision !== ReportCardCorrectionDecision.PENDING) {
          throw new ConflictException('This correction request has already been decided.');
        }

        const current = await tx.reportCardPublication.findUnique({ where: { id: request.targetPublicationId } });
        if (!current || current.status !== ReportCardPublicationStatus.PUBLISHED) {
          throw new ConflictException('The correction must target the current published report version.');
        }

        const latest = await tx.reportCardPublication.findFirst({
          where: { studentId: request.studentId, termId: request.termId },
          orderBy: { publicationVersion: 'desc' },
          select: { publicationVersion: true },
        });

        await tx.reportCardPublication.update({
          where: { id: current.id },
          data: {
            status: ReportCardPublicationStatus.VOIDED,
            voidedAt: new Date(),
            voidedBy: actorUserId,
            voidReason: 'Correction approved: ' + request.reason,
          },
        });

        const replacement = await tx.reportCardPublication.create({
          data: {
            studentId: request.studentId,
            termId: request.termId,
            publicationVersion: (latest?.publicationVersion ?? 0) + 1,
            status: ReportCardPublicationStatus.PUBLISHED,
            snapshotJson: request.replacementSnapshotJson,
            snapshotHash: request.replacementSnapshotHash,
            gradingPolicyVersionId: request.gradingPolicyVersionId,
            publishedAt: new Date(),
            publishedBy: actorUserId,
          },
        });

        const decided = await tx.reportCardCorrectionRequest.update({
          where: { id: request.id },
          data: {
            decision: ReportCardCorrectionDecision.APPROVED,
            decidedBy: actorUserId,
            decidedAt: new Date(),
            decisionNote: trimmedNote,
            approvedPublicationId: replacement.id,
          },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'UPDATE',
            entityType: 'ReportCardPublication',
            entityId: current.id,
            beforeJson: { status: current.status, publicationVersion: current.publicationVersion },
            afterJson: { status: ReportCardPublicationStatus.VOIDED, voidReason: 'Correction approved: ' + request.reason },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'CREATE',
            entityType: 'ReportCardPublication',
            entityId: replacement.id,
            afterJson: {
              publicationVersion: replacement.publicationVersion,
              status: replacement.status,
              sourceCorrectionRequestId: request.id,
              snapshotHash: replacement.snapshotHash,
              gradingPolicyVersionId: replacement.gradingPolicyVersionId,
            },
          },
        });
        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'APPROVE',
            entityType: 'ReportCardCorrectionRequest',
            entityId: request.id,
            beforeJson: { decision: request.decision },
            afterJson: {
              decision: decided.decision,
              decisionNote: trimmedNote,
              approvedPublicationId: replacement.id,
            },
          },
        });

        return { request: decided, voidedPublication: current, replacementPublication: replacement };
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 20000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Correction approval conflicted with another publication change. Please retry.');
      }
      throw error;
    }
  }

  async reject(id: string, decisionNote: string, actorUserId: string, roles: RoleName[]) {
    this.assertReviewAccess(roles);
    const trimmedNote = decisionNote.trim();
    if (!trimmedNote) throw new ConflictException('A rejection note is required.');

    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM "ReportCardCorrectionRequest" WHERE id = ${id} FOR UPDATE`;
      const request = await tx.reportCardCorrectionRequest.findUnique({ where: { id } });
      if (!request) throw new NotFoundException('Report-card correction request not found.');
      assertCorrectionDecisionTransition(request.decision, ReportCardCorrectionDecision.REJECTED);

      const updated = await tx.reportCardCorrectionRequest.updateMany({
        where: { id, decision: ReportCardCorrectionDecision.PENDING },
        data: {
          decision: ReportCardCorrectionDecision.REJECTED,
          decidedBy: actorUserId,
          decidedAt: new Date(),
          decisionNote: trimmedNote,
        },
      });
      if (updated.count !== 1) throw new ConflictException('Correction request changed concurrently. Please reload and retry.');

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'REJECT',
          entityType: 'ReportCardCorrectionRequest',
          entityId: id,
          beforeJson: { decision: request.decision },
          afterJson: { decision: ReportCardCorrectionDecision.REJECTED, decisionNote: trimmedNote },
        },
      });

      return tx.reportCardCorrectionRequest.findUniqueOrThrow({ where: { id } });
    }, {
      isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
      maxWait: 5000,
      timeout: 15000,
    });
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

  private assertRequestAccess(roles: RoleName[]) {
    if (!roles.some((role) => REQUEST_ROLES.has(role)) && !roles.some((role) => REVIEW_ROLES.has(role))) {
      throw new ForbiddenException('Report-card correction request access is restricted to assigned teachers and authorized reviewers.');
    }
  }

  private assertReviewAccess(roles: RoleName[]) {
    if (!roles.some((role) => REVIEW_ROLES.has(role))) {
      throw new ForbiddenException('Only authorized report-card reviewers may decide correction requests.');
    }
  }
}

function hashSnapshot(snapshot: Prisma.InputJsonValue) {
  return createHash('sha256').update(JSON.stringify(snapshot)).digest('hex');
}
