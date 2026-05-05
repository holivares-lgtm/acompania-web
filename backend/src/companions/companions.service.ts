import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateProfileDto } from './dto/update-profile.dto';

@Injectable()
export class CompanionsService {
  constructor(private prisma: PrismaService) {}

  async findAll(query: { location?: string; tags?: string; available?: string }) {
    const where: any = { isActive: true, isApproved: true };
    if (query.location) where.location = { contains: query.location, mode: 'insensitive' };
    if (query.tags) {
      const tagList = query.tags.split(',');
      where.tags = { hasSome: tagList };
    }

    return this.prisma.companionProfile.findMany({
      where,
      select: {
        id: true,
        displayName: true,
        bio: true,
        pricePerHour: true,
        location: true,
        tags: true,
        services: true,
        rating: true,
        reviewCount: true,
        identityVerified: true,
        photos: { where: { isApproved: true }, select: { url: true }, take: 1 },
      },
      orderBy: { rating: 'desc' },
    });
  }

  async findOne(profileId: string) {
    const profile = await this.prisma.companionProfile.findUnique({
      where: { id: profileId },
      include: {
        photos: { where: { isApproved: true } },
        availability: true,
        reviews: {
          include: { client: { select: { id: true, email: true } } },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!profile) throw new NotFoundException('Perfil no encontrado');
    return profile;
  }

  async getMyProfile(userId: string) {
    const profile = await this.prisma.companionProfile.findUnique({
      where: { userId },
      include: { photos: true, availability: true },
    });
    if (!profile) throw new NotFoundException('Perfil no encontrado');
    return profile;
  }

  async updateMyProfile(userId: string, dto: UpdateProfileDto) {
    const profile = await this.prisma.companionProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    return this.prisma.companionProfile.update({
      where: { userId },
      data: dto,
    });
  }

  async updateAvailability(userId: string, slots: { dayOfWeek: number; slotStart: number; slotEnd: number }[]) {
    const profile = await this.prisma.companionProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    await this.prisma.companionAvailability.deleteMany({ where: { profileId: profile.id } });
    await this.prisma.companionAvailability.createMany({
      data: slots.map(s => ({ ...s, profileId: profile.id })),
    });

    return { ok: true };
  }

  async addPhoto(userId: string, url: string) {
    const profile = await this.prisma.companionProfile.findUnique({ where: { userId } });
    if (!profile) throw new NotFoundException('Perfil no encontrado');

    return this.prisma.companionPhoto.create({
      data: { profileId: profile.id, url, isApproved: false },
    });
  }

  async markVerified(userId: string) {
    return this.prisma.companionProfile.update({
      where: { userId },
      data: { identityVerified: true },
    });
  }
}
