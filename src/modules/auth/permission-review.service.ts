import { ForbiddenException, Injectable } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class PermissionReviewService {
  constructor(private readonly prisma: PrismaService) {}

  async review(actorRoles: RoleName[]) {
    if (!actorRoles.includes(RoleName.DIRECTOR)) {
      throw new ForbiddenException('Permission review is restricted to the director role.');
    }

    const assignments = await this.prisma.userPermission.findMany({
      orderBy: [{ grantedAt: 'desc' }],
      include: {
        user: {
          select: {
            id: true,
            status: true,
            roles: { select: { role: true } },
          },
        },
      },
    });

    return assignments.map((assignment) => {
      const scoped = Boolean(assignment.scopeType || assignment.scopeId);
      return {
        id: assignment.id,
        userId: assignment.user.id,
        userStatus: assignment.user.status,
        roles: assignment.user.roles.map(({ role }) => role),
        permissionCode: assignment.permissionCode,
        grantType: scoped ? 'SCOPED' : 'GLOBAL',
        scopeType: assignment.scopeType,
        scopeId: assignment.scopeId,
        grantedAt: assignment.grantedAt,
        grantedBy: assignment.grantedBy,
        globalRouteEffective: !scoped,
        finding: scoped ? 'SCOPED_GRANT_REQUIRES_DOMAIN_SCOPE_ENFORCEMENT' : 'NONE',
      };
    });
  }
}
