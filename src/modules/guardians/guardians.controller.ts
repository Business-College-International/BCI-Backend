import { Body, Controller, Get, Patch, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuardiansService } from './guardians.service';
import { UpdateMyProfileDto } from './dto/update-my-profile.dto';

type AuthenticatedRequest = Request & { user: { id: string } };

@Controller('guardians')
@UseGuards(JwtAuthGuard)
export class GuardiansController {
  constructor(private readonly guardians: GuardiansService) {}

  @Get('me/profile')
  getMyProfile(@Req() request: AuthenticatedRequest) {
    return this.guardians.getMyProfile(request.user.id);
  }

  @Patch('me/profile')
  updateMyProfile(@Body() dto: UpdateMyProfileDto, @Req() request: AuthenticatedRequest) {
    return this.guardians.updateMyProfile(request.user.id, dto);
  }
}
