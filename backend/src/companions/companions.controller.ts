import { Controller, Get, Put, Post, Body, Param, Query, UseGuards, Request } from '@nestjs/common';
import { CompanionsService } from './companions.service';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('companions')
export class CompanionsController {
  constructor(private companions: CompanionsService) {}

  @Get()
  findAll(@Query() query: { location?: string; tags?: string; available?: string }) {
    return this.companions.findAll(query);
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getMyProfile(@Request() req) {
    return this.companions.getMyProfile(req.user.id);
  }

  @Put('me')
  @UseGuards(JwtAuthGuard)
  updateMyProfile(@Request() req, @Body() dto: UpdateProfileDto) {
    return this.companions.updateMyProfile(req.user.id, dto);
  }

  @Put('me/availability')
  @UseGuards(JwtAuthGuard)
  updateAvailability(
    @Request() req,
    @Body() body: { slots: { dayOfWeek: number; slotStart: number; slotEnd: number }[] },
  ) {
    return this.companions.updateAvailability(req.user.id, body.slots);
  }

  @Post('me/photos')
  @UseGuards(JwtAuthGuard)
  addPhoto(@Request() req, @Body() body: { url: string }) {
    return this.companions.addPhoto(req.user.id, body.url);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.companions.findOne(id);
  }
}
