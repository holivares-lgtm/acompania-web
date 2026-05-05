import { Controller, Get, Post, Delete, Body, Param, UseGuards, Request } from '@nestjs/common';
import { RequestsService } from './requests.service';
import { CreateRequestDto } from './dto/create-request.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('requests')
export class RequestsController {
  constructor(private requests: RequestsService) {}

  @Post()
  create(@Request() req, @Body() dto: CreateRequestDto) {
    return this.requests.create(req.user.id, dto);
  }

  @Get('mine')
  findMine(@Request() req) {
    return this.requests.findMyRequests(req.user.id);
  }

  @Get('open')
  findOpen() {
    return this.requests.findOpenRequests();
  }

  @Post(':id/apply')
  apply(@Request() req, @Param('id') id: string, @Body() body: { message?: string }) {
    return this.requests.apply(req.user.id, id, body.message);
  }

  @Post(':id/confirm/:profileId')
  confirm(@Request() req, @Param('id') id: string, @Param('profileId') profileId: string) {
    return this.requests.confirmApplicant(req.user.id, id, profileId);
  }

  @Delete(':id')
  cancel(@Request() req, @Param('id') id: string) {
    return this.requests.cancelRequest(req.user.id, id);
  }
}
