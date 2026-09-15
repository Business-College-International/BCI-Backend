import { SetMetadata } from '@nestjs/common';
import { RoleName } from '@prisma/client';

export const REQUIRED_ROLES = 'required_roles';
export const Roles = (...roles: RoleName[]) => SetMetadata(REQUIRED_ROLES, roles);
