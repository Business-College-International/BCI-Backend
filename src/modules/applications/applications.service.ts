import { Injectable, NotFoundException } from '@nestjs/common';
import { ApplicationStatus } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { CreateApplicationDto } from './dto/create-application.dto';

@Injectable()
export class ApplicationsService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateApplicationDto) {
    return this.prisma.application.create({
      data: {
        firstName: dto.firstName.trim(),
        lastName: dto.lastName.trim(),
        dob: new Date(dto.dob),
        levelApplied: dto.levelApplied,
        programmeApplied: dto.programmeApplied,
        guardianName: dto.guardianName.trim(),
        guardianPhone: dto.guardianPhone.trim(),
        previousSchool: dto.previousSchool?.trim(),
        passportPhotoUrl: dto.passportPhotoUrl?.trim(),
      },
      select: {
        id: true,
        trackingCode: true,
        status: true,
        submittedAt: true,
      },
    });
  }

  async findByTrackingCode(trackingCode: string) {
    const application = await this.prisma.application.findUnique({
      where: { trackingCode },
      select: {
        trackingCode: true,
        levelApplied: true,
        programmeApplied: true,
        status: true,
        submittedAt: true,
      },
    });

    if (!application) throw new NotFoundException('Application not found');
    return application;
  }

  async review(id: string, status: Exclude<ApplicationStatus, 'PENDING'>) {
    if (![
      ApplicationStatus.UNDER_REVIEW,
      ApplicationStatus.ADMITTED,
      ApplicationStatus.REJECTED,
    ].includes(status)) {
      throw new Error('Unsupported review status');
    }

    return this.prisma.application.update({
      where: { id },
      data: { status },
      select: {
        id: true,
        status: true,
      },
    });
  }
}
