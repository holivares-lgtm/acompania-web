import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { AppModule } from './app.module';

process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  process.exit(1);
});

async function bootstrap() {
  console.log('[BOOT] Starting NestJS application...');

  const missing = ['DATABASE_URL', 'JWT_SECRET'].filter((k) => !process.env[k]);
  if (missing.length) {
    console.error('[BOOT] Missing required env vars:', missing.join(', '));
    process.exit(1);
  }

  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') ?? '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE,OPTIONS',
    credentials: true,
  });

  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
  app.setGlobalPrefix('api');

  const port = process.env.PORT ?? 3000;
  await app.listen(port, '0.0.0.0');
  console.log(`[BOOT] Application running on port ${port}`);
}

bootstrap().catch((err) => {
  console.error('[FATAL] Bootstrap failed:', err);
  process.exit(1);
});
