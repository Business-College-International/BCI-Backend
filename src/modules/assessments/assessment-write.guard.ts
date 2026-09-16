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
      select: { id: true, term: { select: { status: true } } },
    });
    if (!assessment) throw new NotFoundException('Assessment not found.');
    if (assessment.term.status === 'CLOSED') {
      throw new BadRequestException('Assessment results cannot be changed after the term is closed.');
    }

    return true;
  }
}
