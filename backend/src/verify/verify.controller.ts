import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { VerifyService } from './verify.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('verify')
export class VerifyController {
  constructor(private verify: VerifyService) {}

  @Post('start')
  start(@Request() req) {
    return this.verify.startSession(req.user.id);
  }

  @Post('document')
  document(@Request() req, @Body() body: { sessionId: string; image: string; mimeType: string }) {
    return this.verify.uploadDocument(req.user.id, body.sessionId, 'front', body.image, body.mimeType);
  }

  @Post('document-back')
  documentBack(@Request() req, @Body() body: { sessionId: string; image: string; mimeType: string }) {
    return this.verify.uploadDocument(req.user.id, body.sessionId, 'back', body.image, body.mimeType);
  }

  @Post('selfie')
  selfie(@Request() req, @Body() body: { sessionId: string; image: string; mimeType: string }) {
    return this.verify.uploadSelfie(req.user.id, body.sessionId, body.image, body.mimeType);
  }

  @Get('status/:sessionId')
  status(@Param('sessionId') sessionId: string) {
    return this.verify.getStatus(sessionId);
  }
}
