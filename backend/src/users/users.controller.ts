import { Controller, Get, Param, UseGuards, Request } from '@nestjs/common';
import { UsersService } from './users.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@UseGuards(JwtAuthGuard)
@Controller('users')
export class UsersController {
  constructor(private users: UsersService) {}

  @Get('me')
  me(@Request() req) {
    return this.users.findById(req.user.id);
  }

  @Get(':id')
  findOne(@Param('id') id: string) {
    return this.users.findById(id);
  }
}
