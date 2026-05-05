import { Controller, Get, Post, Param, UseGuards, Request } from '@nestjs/common';
import { AppointmentsService } from './appointments.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('appointments')
export class AppointmentsController {
  constructor(private appts: AppointmentsService) {}

  @Get()
  findMine(@Request() req) {
    return this.appts.findMyAppointments(req.user.id, req.user.role);
  }

  @Post(':id/complete')
  complete(@Request() req, @Param('id') id: string) {
    return this.appts.complete(req.user.id, id);
  }

  @Post(':id/cancel')
  cancel(@Request() req, @Param('id') id: string) {
    return this.appts.cancel(req.user.id, id);
  }
}
