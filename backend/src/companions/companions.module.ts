import { Module } from '@nestjs/common';
import { CompanionsService } from './companions.service';
import { CompanionsController } from './companions.controller';

@Module({
  providers: [CompanionsService],
  controllers: [CompanionsController],
  exports: [CompanionsService],
})
export class CompanionsModule {}
