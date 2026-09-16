import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { PrismaService } from '../../prisma.service';
import { AttendanceWritePolicyService } from './attendance-write-policy.service';

type AuthenticatedRequest = Request & { user?: { id: string } };

@Injectable()
export class AttendanceWriteGuard implements CanActivate {
  constructor(
    private readonly prisma: PrismaService,
    private readonly policy: AttendanceWritePolicyService,
  ) {}

  async canActivate(context: ExecutionContext) {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const sessionId = request.params?.sessionId;
    if (!sessionId) return true;

    const session = await this.prisma.attendanceSession.findUnique({
      where: { id: sessionId },
      select: { termId: true, publishedAt: true },
    });

    if (!session) return true;
    await this.policy.assertSessionWritable(this.prisma, session.termId, session.publishedAt);
    return true;
  }
}
