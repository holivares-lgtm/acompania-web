import { Injectable, NotFoundException, ForbiddenException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateRequestDto } from './dto/create-request.dto';

@Injectable()
export class RequestsService {
  constructor(private prisma: PrismaService) {}

  async create(clientId: string, dto: CreateRequestDto) {
    return this.prisma.request.create({
      data: { ...dto, date: new Date(dto.date), clientId },
    });
  }

  async findMyRequests(clientId: string) {
    return this.prisma.request.findMany({
      where: { clientId },
      include: {
        applicants: {
          include: {
            profile: {
              select: { id: true, displayName: true, rating: true, identityVerified: true, photos: { take: 1 } },
            },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOpenRequests() {
    return this.prisma.request.findMany({
      where: { status: 'OPEN' },
      include: { client: { select: { id: true, email: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  async apply(companionUserId: string, requestId: string, message?: string) {
    const profile = await this.prisma.companionProfile.findUnique({ where: { userId: companionUserId } });
    if (!profile) throw new ForbiddenException('Solo acompañantes pueden postular');

    const request = await this.prisma.request.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (request.status !== 'OPEN') throw new BadRequestException('Solicitud no disponible');

    return this.prisma.requestApplicant.upsert({
      where: { requestId_profileId: { requestId, profileId: profile.id } },
      update: { message },
      create: { requestId, profileId: profile.id, message },
    });
  }

  async confirmApplicant(clientId: string, requestId: string, profileId: string) {
    const request = await this.prisma.request.findUnique({
      where: { id: requestId },
      include: { applicants: true },
    });
    if (!request) throw new NotFoundException('Solicitud no encontrada');
    if (request.clientId !== clientId) throw new ForbiddenException();

    const applicant = request.applicants.find(a => a.profileId === profileId);
    if (!applicant) throw new NotFoundException('Postulante no encontrado');

    await this.prisma.$transaction([
      this.prisma.requestApplicant.update({
        where: { id: applicant.id },
        data: { status: 'ACCEPTED' },
      }),
      this.prisma.requestApplicant.updateMany({
        where: { requestId, profileId: { not: profileId } },
        data: { status: 'REJECTED' },
      }),
      this.prisma.request.update({
        where: { id: requestId },
        data: { status: 'CONFIRMED' },
      }),
      this.prisma.appointment.create({
        data: {
          requestId,
          clientId,
          profileId,
          date: request.date,
          duration: request.duration,
          totalAmount: request.priceOffer,
        },
      }),
    ]);

    return { ok: true };
  }

  async cancelRequest(clientId: string, requestId: string) {
    const request = await this.prisma.request.findUnique({ where: { id: requestId } });
    if (!request) throw new NotFoundException();
    if (request.clientId !== clientId) throw new ForbiddenException();

    return this.prisma.request.update({
      where: { id: requestId },
      data: { status: 'CANCELLED' },
    });
  }
}
