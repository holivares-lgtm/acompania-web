import { Injectable, BadGatewayException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CompanionsService } from '../companions/companions.service';

@Injectable()
export class VerifyService {
  private readonly lambdaUrl = process.env.AWS_LAMBDA_URL;

  constructor(
    private prisma: PrismaService,
    private companions: CompanionsService,
  ) {}

  async startSession(userId: string) {
    const response = await this.callLambda('/verify/start', 'POST', { userId });
    await this.prisma.verificationSession.create({
      data: { userId, sessionId: response.sessionId },
    });
    return response;
  }

  async uploadDocument(userId: string, sessionId: string, side: 'front' | 'back', fileBase64: string, mimeType: string) {
    const endpoint = side === 'front' ? '/verify/document' : '/verify/document-back';
    return this.callLambda(endpoint, 'POST', { userId, sessionId, image: fileBase64, mimeType });
  }

  async uploadSelfie(userId: string, sessionId: string, fileBase64: string, mimeType: string) {
    const result = await this.callLambda('/verify/selfie', 'POST', {
      userId, sessionId, image: fileBase64, mimeType,
    });

    if (result.verified) {
      await this.prisma.verificationSession.update({
        where: { sessionId },
        data: { status: 'APPROVED', result },
      });
      await this.companions.markVerified(userId);
      await this.prisma.user.update({
        where: { id: userId },
        data: { emailVerified: true },
      });
    } else {
      await this.prisma.verificationSession.update({
        where: { sessionId },
        data: { status: 'REJECTED', result },
      });
    }

    return result;
  }

  async getStatus(sessionId: string) {
    return this.prisma.verificationSession.findUnique({ where: { sessionId } });
  }

  private async callLambda(path: string, method: string, body: any) {
    if (!this.lambdaUrl) {
      throw new BadGatewayException('AWS_LAMBDA_URL no configurada');
    }
    const res = await fetch(`${this.lambdaUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const err = await res.text();
      throw new BadGatewayException(`Lambda error: ${err}`);
    }
    return res.json();
  }
}
