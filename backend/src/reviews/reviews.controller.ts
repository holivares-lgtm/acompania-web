import { Controller, Post, Get, Body, Param, UseGuards, Request } from '@nestjs/common';
import { ReviewsService } from './reviews.service';
import { CreateReviewDto } from './dto/create-review.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';

@Controller('reviews')
export class ReviewsController {
  constructor(private reviews: ReviewsService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Request() req, @Body() dto: CreateReviewDto) {
    return this.reviews.create(req.user.id, dto);
  }

  @Get('profile/:profileId')
  findByProfile(@Param('profileId') profileId: string) {
    return this.reviews.findByProfile(profileId);
  }
}
