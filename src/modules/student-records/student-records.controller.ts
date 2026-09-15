import { Body, Controller, Delete, Get, Param, Post, Req, UseGuards } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { StudentDocumentDto } from './dto/student-document.dto';
import { StudentRecordsService } from './student-records.service';

type AuthenticatedRequest = Request & { user: { id: string; roles: RoleName[] } };

@Controller('student-records')
@UseGuards(JwtAuthGuard)
export class StudentRecordsController {
  constructor(private readonly records: StudentRecordsService) {}

  @Get('students/:studentId/documents')
  listDocuments(@Param('studentId') studentId: string, @Req() request: AuthenticatedRequest) {
    return this.records.listDocuments(studentId, request.user.id, request.user.roles);
  }

  @Post('students/:studentId/documents')
  addDocument(@Param('studentId') studentId: string, @Body() dto: StudentDocumentDto, @Req() request: AuthenticatedRequest) {
    return this.records.addDocument(studentId, request.user.id, request.user.roles, dto);
  }

  @Delete('documents/:documentId')
  removeDocument(@Param('documentId') documentId: string, @Req() request: AuthenticatedRequest) {
    return this.records.removeDocument(documentId, request.user.id, request.user.roles);
  }
}
