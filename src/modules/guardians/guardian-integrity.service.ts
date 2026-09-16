import { ForbiddenException, Injectable } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

const INTEGRITY_ROLES = new Set<RoleName>([
  RoleName.DIRECTOR,
  RoleName.PRINCIPAL,
  RoleName.OFFICE,
]);

@Injectable()
export class GuardianIntegrityService {
  constructor(private readonly prisma: PrismaService) {}

  async get(roles: RoleName[]) {
    if (!roles.some((role) => INTEGRITY_ROLES.has(role))) {
      throw new ForbiddenException('Guardian integrity review is restricted.');
    }

    const links = await this.prisma.guardianStudent.findMany({
      select: {
        guardianId: true,
        studentId: true,
        relationship: true,
        isPrimaryContact: true,
        canViewAcademic: true,
        canPayFees: true,
        canManageWallet: true,
      },
      orderBy: [{ studentId: 'asc' }, { guardianId: 'asc' }],
    });

    const byStudent = new Map<string, typeof links>();
    for (const link of links) {
      const current = byStudent.get(link.studentId) ?? [];
      current.push(link);
      byStudent.set(link.studentId, current);
    }

    const findings = Array.from(byStudent.entries()).flatMap(([studentId, studentLinks]) => {
      const primaryCount = studentLinks.filter((link) => link.isPrimaryContact).length;
      const studentFindings: Array<Record<string, unknown>> = [];

      if (primaryCount === 0) {
        studentFindings.push({ studentId, code: 'NO_PRIMARY_GUARDIAN', severity: 'BLOCKING' });
      }
      if (primaryCount > 1) {
        studentFindings.push({ studentId, code: 'MULTIPLE_PRIMARY_GUARDIANS', severity: 'BLOCKING', primaryCount });
      }

      for (const link of studentLinks) {
        if (!link.canPayFees && !link.canManageWallet && !link.canViewAcademic) {
          studentFindings.push({
            studentId,
            guardianId: link.guardianId,
            code: 'NO_GUARDIAN_PORTAL_PERMISSIONS',
            severity: 'INFO',
          });
        }
        if (link.canManageWallet && !link.canPayFees) {
          studentFindings.push({
            studentId,
            guardianId: link.guardianId,
            code: 'WALLET_WITHOUT_FEE_PAYMENT',
            severity: 'REVIEW',
          });
        }
      }

      return studentFindings;
    });

    return {
      summary: {
        wardCount: byStudent.size,
        guardianLinkCount: links.length,
        findingCount: findings.length,
        blockingCount: findings.filter((finding) => finding.severity === 'BLOCKING').length,
      },
      findings,
    };
  }
}
