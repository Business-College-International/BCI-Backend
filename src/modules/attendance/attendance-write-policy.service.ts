import { BadRequestException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

@Injectable()
export class AttendanceWritePolicyService {
  async assertSessionWritable(
    tx: PrismaService | Prisma.TransactionClient,
    termId: string,
    publishedAt: Date | null,
  ) {
    const term = await tx.term.findUnique({ where: { id: termId }, select: { status: true } });
    if (!term) throw new BadRequestException('Attendance term not found.');
    if (term.status === 'CLOSED') throw new BadRequestException('Attendance records are read-only after the term is closed.');
    if (publishedAt) throw new BadRequestException('This attendance session has been finalized and is read-only.');
  }
}
