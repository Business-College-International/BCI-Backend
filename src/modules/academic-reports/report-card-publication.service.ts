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