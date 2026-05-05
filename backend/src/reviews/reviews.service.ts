import { Injectable, NotFoundException, ForbiddenException, ConflictException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateReviewDto } from './dto/create-review.dto';

@Injectable()
export class ReviewsService {
  constructor(private prisma: PrismaService) {}

  async create(clientId: string, dto: CreateReviewDto) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: dto.appointmentId },
    });
    if (!appt) throw new NotFoundException('Cita no encontrada');
    if (appt.clientId !== clientId) throw new ForbiddenException();
    if (appt.status !== 'COMPLETED') throw new ForbiddenException('La cita debe estar completada');

    const existing = await this.prisma.review.findUnique({ where: { appointmentId: dto.appointmentId } });
    if (existing) throw new ConflictException('Ya existe una reseña para esta cita');

    const review = await this.prisma.review.create({
      data: {
        appointmentId: dto.appointmentId,
        clientId,
        profileId: appt.profileId,
        rating: dto.rating,
        text: dto.text,
        aspects: dto.aspects ?? [],
      },
    });

    await this.recalcRating(appt.profileId);
    return review;
  }

  async findByProfile(profileId: string) {
    return this.prisma.review.findMany({
      where: { profileId },
      include: { client: { select: { id: true, email: true, emailVerified: true } } },
      orderBy: { createdAt: 'desc' },
    });
  }

  private async recalcRating(profileId: string) {
    const agg = await this.prisma.review.aggregate({
      where: { profileId },
      _avg: { rating: true },
      _count: { rating: true },
    });
    await this.prisma.companionProfile.update({
      where: { id: profileId },
      data: {
        rating: agg._avg.rating ?? 0,
        reviewCount: agg._count.rating,
      },
    });
  }
}
