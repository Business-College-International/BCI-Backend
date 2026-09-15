import { PrismaClient, RoleName } from '@prisma/client';
import { PERMISSIONS } from '../src/modules/auth/permission-catalog';

const prisma = new PrismaClient();

const permissionsByRole: Record<RoleName, readonly string[]> = {
  [RoleName.DIRECTOR]: Object.values(PERMISSIONS),
  [RoleName.PRINCIPAL]: [
    PERMISSIONS.APPLICATIONS_READ,
    PERMISSIONS.APPLICATIONS_REVIEW,
    PERMISSIONS.APPLICATIONS_ADMIT,
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.STUDENTS_MANAGE,
    PERMISSIONS.ACADEMICS_READ,
    PERMISSIONS.ACADEMICS_MANAGE,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.ASSESSMENTS_READ,
    PERMISSIONS.ASSESSMENTS_MANAGE,
    PERMISSIONS.ANNOUNCEMENTS_MANAGE,
  ],
  [RoleName.OFFICE]: [
    PERMISSIONS.APPLICATIONS_READ,
    PERMISSIONS.APPLICATIONS_REVIEW,
    PERMISSIONS.APPLICATIONS_ADMIT,
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.STUDENTS_MANAGE,
    PERMISSIONS.ACADEMICS_READ,
    PERMISSIONS.ANNOUNCEMENTS_MANAGE,
  ],
  [RoleName.ACCOUNTANT]: [
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.FINANCE_READ,
    PERMISSIONS.FINANCE_MANAGE,
    PERMISSIONS.PAYMENTS_MANAGE,
    PERMISSIONS.PAYROLL_READ,
    PERMISSIONS.PAYROLL_MANAGE,
    PERMISSIONS.INVENTORY_READ,
  ],
  [RoleName.TEACHER]: [
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.ACADEMICS_READ,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ATTENDANCE_MANAGE,
    PERMISSIONS.ASSESSMENTS_READ,
    PERMISSIONS.ASSESSMENTS_MANAGE,
  ],
  [RoleName.SUPPORT_STAFF]: [
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.ACADEMICS_READ,
  ],
  [RoleName.GUARDIAN]: [
    PERMISSIONS.STUDENTS_READ,
    PERMISSIONS.ATTENDANCE_READ,
    PERMISSIONS.ASSESSMENTS_READ,
  ],
  [RoleName.APPLICANT]: [
    PERMISSIONS.APPLICATIONS_READ,
  ],
};

async function main() {
  for (const [role, permissionCodes] of Object.entries(permissionsByRole) as [RoleName, readonly string[]][]) {
    for (const permissionCode of permissionCodes) {
      await prisma.rolePermission.upsert({
        where: { role_permissionCode: { role, permissionCode } },
        update: {},
        create: { role, permissionCode },
      });
    }
  }
}

main()
  .finally(async () => prisma.$disconnect())
  .catch(async (error) => {
    console.error(error);
    await prisma.$disconnect();
    process.exit(1);
  });
