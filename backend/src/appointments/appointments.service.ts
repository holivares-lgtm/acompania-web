import { Injectable, NotFoundException, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AppointmentsService {
  constructor(private prisma: PrismaService) {}

  async findMyAppointments(userId: string, role: string) {
    const where = role === 'ACOMPANANTE'
      ? { profile: { userId } }
      : { clientId: userId };

    return this.prisma.appointment.findMany({
      where,
      include: {
        client: { select: { id: true, email: true } },
        profile: { select: { id: true, displayName: true, rating: true, identityVerified: true } },
        review: true,
      },
      orderBy: { date: 'desc' },
    });
  }

  async complete(userId: string, appointmentId: string) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { profile: true },
    });
    if (!appt) throw new NotFoundException();
    if (appt.clientId !== userId && appt.profile.userId !== userId) throw new ForbiddenException();

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'COMPLETED' },
    });
  }

  async cancel(userId: string, appointmentId: string) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { profile: true },
    });
    if (!appt) throw new NotFoundException();
    if (appt.clientId !== userId && appt.profile.userId !== userId) throw new ForbiddenException();

    return this.prisma.appointment.update({
      where: { id: appointmentId },
      data: { status: 'CANCELLED' },
    });
  }
}
