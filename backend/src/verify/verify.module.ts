import { Module } from '@nestjs/common';
import { VerifyService } from './verify.service';
import { VerifyController } from './verify.controller';
import { CompanionsModule } from '../companions/companions.module';

@Module({
  imports: [CompanionsModule],
  providers: [VerifyService],
  controllers: [VerifyController],
})
export class VerifyModule {}
