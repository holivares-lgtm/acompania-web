import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class UsersService {
  constructor(private prisma: PrismaService) {}

  async findById(id: string) {
    const user = await this.prisma.user.findUnique({
      where: { id },
      include: { profile: true },
    });
    if (!user) throw new NotFoundException('Usuario no encontrado');
    const { passwordHash, ...safe } = user;
    return safe;
  }

  async updatePhone(userId: string, phone: string) {
    return this.prisma.user.update({
      where: { id: userId },
      data: { phone, phoneVerified: true },
      select: { id: true, email: true, phone: true, role: true, phoneVerified: true },
    });
  }
}
