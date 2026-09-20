import { BadRequestException, CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AssessmentWriteGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ params?: { assessmentId?: string } }>();
    const assessmentId = request.params?.assessmentId;
    if (!assessmentId) throw new BadRequestException('Assessment ID is required.');

    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { id: true, termId: true, term: { select: { status: true } } },
    });
    if (!assessment) throw new NotFoundException('Assessment not found.');
    if (assessment.term.status === 'CLOSED') {
      throw new BadRequestException('Assessment results cannot be changed after the term is closed.');
    }

    const body = request.body as { results?: Array<{ studentId?: string }> } | undefined;
    const studentIds = [...new Set((body?.results ?? []).map((result) => result.studentId).filter((id): id is string => typeof id === 'string' && id.length > 0))];

    if (studentIds.length > 0) {
      const published = await this.prisma.reportCardPublication.findMany({
        where: {
          studentId: { in: studentIds },
          termId: assessment.termId,
          status: 'PUBLISHED',
        },
        select: { id: true, studentId: true },
      });

      if (published.length > 0) {
        const pending = await this.prisma.reportCardCorrectionRequest.findMany({
          where: {
            studentId: { in: published.map((row) => row.studentId) },
            termId: assessment.termId,
            targetPublicationId: { in: published.map((row) => row.id) },
            decision: 'PENDING',
          },
          select: { studentId: true, targetPublicationId: true },
        });
        const permitted = new Set(pending.map((row) => row.studentId));
        const blocked = published.filter((row) => !permitted.has(row.studentId));
        if (blocked.length > 0) {
          throw new BadRequestException('Published report cards are read-only. Submit a correction request before changing their assessment results.');
        }
      }
    }

    return true;
  }
}
