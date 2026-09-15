import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { ApplicationsService } from './applications.service';
import { CreateApplicationDto } from './dto/create-application.dto';

@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  create(@Body() dto: CreateApplicationDto) {
    return this.applications.create(dto);
  }

  @Get('track/:trackingCode')
  getStatus(@Param('trackingCode') trackingCode: string) {
    return this.applications.findByTrackingCode(trackingCode);
  }
}
