import { Body, Controller, Get, Post, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './jwt-auth.guard';
import { LoginDto } from './dto/login.dto';
import { RefreshDto } from './dto/refresh.dto';
import { RegisterDto } from './dto/register.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { RevokeSessionDto } from './dto/revoke-session.dto';

type AuthenticatedRequest = Request & { user: { id: string } };

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Post('register')
  register(@Body() dto: RegisterDto) { return this.auth.registerGuardian(dto); }
  @Post('login')
  login(@Body() dto: LoginDto) { return this.auth.login(dto); }
  @Post('refresh')
  refresh(@Body() dto: RefreshDto) { return this.auth.refresh(dto); }
  @Post('logout')
  logout(@Body() dto: RefreshDto) { return this.auth.logout(dto); }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@Req() request: AuthenticatedRequest) { return this.auth.getCurrentUser(request.user.id); }

  @UseGuards(JwtAuthGuard)
  @Get('sessions')
  sessions(@Req() request: AuthenticatedRequest) { return this.auth.listMySessions(request.user.id); }

  @UseGuards(JwtAuthGuard)
  @Post('change-password')
  changePassword(@Body() dto: ChangePasswordDto, @Req() request: AuthenticatedRequest) { return this.auth.changePassword(request.user.id, dto); }

  @UseGuards(JwtAuthGuard)
  @Post('revoke-session')
  revokeSession(@Body() dto: RevokeSessionDto, @Req() request: AuthenticatedRequest) { return this.auth.revokeSession(request.user.id, dto.sessionId); }

  @UseGuards(JwtAuthGuard)
  @Post('revoke-all-sessions')
  revokeAllSessions(@Req() request: AuthenticatedRequest) { return this.auth.revokeAllSessions(request.user.id); }
}
