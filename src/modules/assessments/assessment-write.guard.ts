import { BadRequestException, CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AssessmentWriteGuard implements CanActivate {
  constructor(private readonly prisma: PrismaService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ params?: { assessmentId?: string }; body?: unknown }>();
    const assessmentId = request.params?.assessmentId;
    if (!assessmentId) throw new BadRequestException('Assessment ID is required.');

    const assessment = await this.prisma.assessment.findUnique({
      where: { id: assessmentId },
      select: { id: true, termId: true, term: { select: { status: true } } },
    });
    if (!assessment) throw new NotFoundException('Assessment not found.');
    if (assessment.term.status !== 'CLOSED') return true;

    const body = request.body as {
      results?: Array<{ studentId?: string }>;
    } | undefined;
    const studentIds = [...new Set(
      (body?.results ?? [])
        .map((result) => result.studentId)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    )];

    if (studentIds.length === 0) {
      throw new BadRequestException('Assessment results cannot be changed after the term is closed.');
    }

    const published = await this.prisma.reportCardPublication.findMany({
      where: {
        studentId: { in: studentIds },
        termId: assessment.termId,
        status: 'PUBLISHED',
      },
      select: { id: true, studentId: true },
    });

    if (published.length !== studentIds.length) {
      throw new BadRequestException(
        'Closed-term assessment changes require a published report-card correction request for every changed student.',
      );
    }

    const pending = await this.prisma.reportCardCorrectionRequest.findMany({
      where: {
        studentId: { in: studentIds },
        termId: assessment.termId,
        targetPublicationId: { in: published.map((row) => row.id) },
        decision: 'PENDING',
      },
      select: { studentId: true },
    });

    if (new Set(pending.map((row) => row.studentId)).size !== studentIds.length) {
      throw new BadRequestException(
        'Closed-term assessment changes require a pending report-card correction request for every changed student.',
      );
    }

    return true;
  }
}
