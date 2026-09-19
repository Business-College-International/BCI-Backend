import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { GradingPolicyStatus, Level, Prisma, Programme } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { PrismaService } from '../../prisma.service';
import { GradeBand, GradingPolicyError, validateGradeBands } from './grading-engine';
import { CreateGradingPolicyDto, GradingBandDto, UpdateGradingPolicyDto } from './dto/grading-policy.dto';

@Injectable()
export class GradingPolicyService {
  constructor(private readonly prisma: PrismaService) {}

  async list(filters: { academicYearId?: string; level?: Level; programme?: Programme }) {
    return this.prisma.gradingPolicy.findMany({
      where: {
        ...(filters.academicYearId ? { academicYearId: filters.academicYearId } : {}),
        ...(filters.level ? { level: filters.level } : {}),
        ...(filters.programme ? { programme: filters.programme } : {}),
      },
      include: { bands: { orderBy: { order: 'asc' } } },
      orderBy: [{ academicYearId: 'asc' }, { level: 'asc' }, { createdAt: 'desc' }],
    });
  }

  async create(actorUserId: string, dto: CreateGradingPolicyDto) {
    const name = dto.name.trim();
    if (!name) throw new ConflictException('Grading policy name is required.');
    const bands = this.normalizeBands(dto.bands);
    this.assertValidBands(bands);

    const academicYear = await this.prisma.academicYear.findUnique({
      where: { id: dto.academicYearId },
      select: { id: true },
    });
    if (!academicYear) throw new NotFoundException('Academic year not found.');

    const policy = await this.prisma.gradingPolicy.create({
      data: {
        version: this.nextVersion(),
        name,
        academicYearId: dto.academicYearId,
        level: dto.level,
        programme: dto.programme ?? null,
        status: GradingPolicyStatus.DRAFT,
        bands: { create: bands },
      },
      include: { bands: { orderBy: { order: 'asc' } } },
    });

    await this.prisma.auditLog.create({
      data: {
        actorUserId,
        action: 'CREATE',
        entityType: 'GradingPolicy',
        entityId: policy.id,
        afterJson: {
          version: policy.version,
          name: policy.name,
          academicYearId: policy.academicYearId,
          level: policy.level,
          programme: policy.programme,
          status: policy.status,
          bandCount: policy.bands.length,
        },
      },
    });

    return policy;
  }

  async update(id: string, actorUserId: string, dto: UpdateGradingPolicyDto) {
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.gradingPolicy.findUnique({
        where: { id },
        include: { bands: { orderBy: { order: 'asc' } } },
      });
      if (!policy) throw new NotFoundException('Grading policy not found.');
      if (policy.status !== GradingPolicyStatus.DRAFT) {
        throw new ConflictException('Only draft grading policies can be edited.');
      }

      const name = dto.name === undefined ? policy.name : dto.name.trim();
      if (!name) throw new ConflictException('Grading policy name is required.');
      const bands = dto.bands ? this.normalizeBands(dto.bands) : this.toGradeBands(policy.bands);
      this.assertValidBands(bands);

      await tx.gradingBand.deleteMany({ where: { policyId: id } });
      const updated = await tx.gradingPolicy.update({
        where: { id },
        data: {
          name,
          bands: { create: bands },
        },
        include: { bands: { orderBy: { order: 'asc' } } },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'GradingPolicy',
          entityId: id,
          beforeJson: { version: policy.version, name: policy.name, bandCount: policy.bands.length },
          afterJson: { version: updated.version, name: updated.name, bandCount: updated.bands.length },
        },
      });

      return updated;
    });
  }

  async publish(id: string, actorUserId: string) {
    try {
      return await this.prisma.$transaction(async (tx) => {
        const policy = await tx.gradingPolicy.findUnique({
          where: { id },
          include: { bands: { orderBy: { order: 'asc' } } },
        });
        if (!policy) throw new NotFoundException('Grading policy not found.');
        if (policy.status !== GradingPolicyStatus.DRAFT) {
          throw new ConflictException('Only draft grading policies can be published.');
        }

        this.assertValidBands(this.toGradeBands(policy.bands));

        const scopeKey = policy.academicYearId + ':' + policy.level + ':' + (policy.programme ?? 'GENERIC');
        await tx.$executeRawUnsafe(
          "SELECT pg_advisory_xact_lock(hashtext('bci:grading-policy:' || $1))",
          scopeKey,
        );

        const existingActive = await tx.gradingPolicy.findFirst({
          where: {
            academicYearId: policy.academicYearId,
            level: policy.level,
            programme: policy.programme,
            status: GradingPolicyStatus.ACTIVE,
            id: { not: policy.id },
          },
          select: { id: true, version: true },
        });
        if (existingActive) {
          throw new ConflictException('An active grading policy already exists for this academic scope. Retire it before publishing a replacement.');
        }

        const published = await tx.gradingPolicy.update({
          where: { id },
          data: {
            status: GradingPolicyStatus.ACTIVE,
            publishedAt: new Date(),
            publishedBy: actorUserId,
          },
          include: { bands: { orderBy: { order: 'asc' } } },
        });

        await tx.auditLog.create({
          data: {
            actorUserId,
            action: 'UPDATE',
            entityType: 'GradingPolicy',
            entityId: id,
            beforeJson: { status: policy.status, version: policy.version },
            afterJson: { status: published.status, version: published.version, publishedAt: published.publishedAt },
          },
        });

        return published;
      }, {
        isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        maxWait: 5000,
        timeout: 10000,
      });
    } catch (error) {
      if ((error as { code?: string }).code === 'P2034') {
        throw new ConflictException('Grading policy publication conflicted with another policy change. Please retry.');
      }
      throw error;
    }
  }

  async retire(id: string, actorUserId: string) {
    return this.prisma.$transaction(async (tx) => {
      const policy = await tx.gradingPolicy.findUnique({ where: { id } });
      if (!policy) throw new NotFoundException('Grading policy not found.');
      if (policy.status !== GradingPolicyStatus.ACTIVE) {
        throw new ConflictException('Only active grading policies can be retired.');
      }

      const updated = await tx.gradingPolicy.update({
        where: { id },
        data: { status: GradingPolicyStatus.RETIRED },
      });

      await tx.auditLog.create({
        data: {
          actorUserId,
          action: 'UPDATE',
          entityType: 'GradingPolicy',
          entityId: id,
          beforeJson: { status: policy.status, version: policy.version },
          afterJson: { status: updated.status, version: updated.version },
        },
      });
      return updated;
    });
  }

  async resolveActive(academicYearId: string, level: Level, programme: Programme) {
    const exact = programme === Programme.NONE
      ? null
      : await this.prisma.gradingPolicy.findFirst({
          where: { academicYearId, level, programme, status: GradingPolicyStatus.ACTIVE },
          include: { bands: { orderBy: { order: 'asc' } } },
        });
    if (exact) return exact;

    return this.prisma.gradingPolicy.findFirst({
      where: { academicYearId, level, programme: null, status: GradingPolicyStatus.ACTIVE },
      include: { bands: { orderBy: { order: 'asc' } } },
    });
  }

  private nextVersion() {
    const year = new Date().getUTCFullYear();
    return 'GRADING-' + year + '-' + randomBytes(5).toString('hex').toUpperCase();
  }

  private normalizeBands(input: readonly GradingBandDto[]): GradeBand[] {
    const seenCodes = new Set<string>();
    const seenOrders = new Set<number>();
    return input.map((band) => {
      const code = band.code.trim().toUpperCase();
      const descriptor = band.descriptor.trim();
      if (!code) throw new ConflictException('Every grading band requires a code.');
      if (!descriptor) throw new ConflictException('Every grading band requires a descriptor.');
      if (seenCodes.has(code)) throw new ConflictException('Grading band codes must be unique.');
      if (seenOrders.has(band.order)) throw new ConflictException('Grading band orders must be unique.');
      seenCodes.add(code);
      seenOrders.add(band.order);
      return {
        code,
        lowerInclusive: Number(band.lowerInclusive),
        upperExclusive: band.upperExclusive == null ? null : Number(band.upperExclusive),
        pass: band.pass,
        descriptor,
        points: band.points == null ? null : Number(band.points),
        order: band.order,
      };
    });
  }

  private toGradeBands(bands: Array<{
    code: string;
    lowerInclusive: Prisma.Decimal;
    upperExclusive: Prisma.Decimal | null;
    pass: boolean;
    descriptor: string;
    points: Prisma.Decimal | null;
    order: number;
  }>): GradeBand[] {
    return bands.map((band) => ({
      code: band.code,
      lowerInclusive: Number(band.lowerInclusive.toString()),
      upperExclusive: band.upperExclusive == null ? null : Number(band.upperExclusive.toString()),
      pass: band.pass,
      descriptor: band.descriptor,
      points: band.points == null ? null : Number(band.points.toString()),
      order: band.order,
    }));
  }

  private assertValidBands(bands: readonly GradeBand[]) {
    try {
      validateGradeBands(bands);
    } catch (error) {
      if (error instanceof GradingPolicyError) throw new ConflictException(error.message);
      throw error;
    }
  }
}