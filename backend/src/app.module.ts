import { Module } from '@nestjs/common';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { CompanionsModule } from './companions/companions.module';
import { RequestsModule } from './requests/requests.module';
import { AppointmentsModule } from './appointments/appointments.module';
import { ReviewsModule } from './reviews/reviews.module';
import { VerifyModule } from './verify/verify.module';

@Module({
  imports: [
    PrismaModule,
    AuthModule,
    UsersModule,
    CompanionsModule,
    RequestsModule,
    AppointmentsModule,
    ReviewsModule,
    VerifyModule,
  ],
})
export class AppModule {}
