import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma.service';
import { REQUIRED_PERMISSIONS } from './permissions.decorator';

interface AuthenticatedRequest {
  user?: { id: string };
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<string[]>(
      REQUIRED_PERMISSIONS,
      [context.getHandler(), context.getClass()],
    );

    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const userId = request.user?.id;
    if (!userId) throw new ForbiddenException('Authenticated user context is required.');

    const assignments = await this.prisma.userPermission.findMany({
      where: { userId, permissionCode: { in: required } },
      select: { permissionCode: true },
    });

    const granted = new Set(assignments.map((assignment) => assignment.permissionCode));
    if (required.every((permission) => granted.has(permission))) return true;

    throw new ForbiddenException('You do not have permission to perform this action.');
  }
}
