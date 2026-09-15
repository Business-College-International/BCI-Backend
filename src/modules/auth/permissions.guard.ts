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

    const [userRoles, directPermissions] = await Promise.all([
      this.prisma.userRole.findMany({
        where: { userId },
        select: { role: true },
      }),
      this.prisma.userPermission.findMany({
        where: { userId, permissionCode: { in: required } },
        select: { permissionCode: true },
      }),
    ]);

    const roleNames = userRoles.map(({ role }) => role);
    const rolePermissions = await this.prisma.rolePermission.findMany({
      where: { role: { in: roleNames }, permissionCode: { in: required } },
      select: { permissionCode: true },
    });

    const granted = new Set([
      ...directPermissions.map(({ permissionCode }) => permissionCode),
      ...rolePermissions.map(({ permissionCode }) => permissionCode),
    ]);

    if (required.every((permission) => granted.has(permission))) return true;

    throw new ForbiddenException('You do not have permission to perform this action.');
  }
}
