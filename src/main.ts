import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3000;
  const origins = config.get<string[]>('app.cors.origins') ?? [];

  app.enableCors({
    origin: origins,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger
  const swaggerCfg = new DocumentBuilder()
    .setTitle('Resultados API')
    .setDescription('API de resultados electorales')
    .setVersion('1.0')
    .addApiKey(
      {
        type: 'apiKey',
        name: config.get('app.apiKey.header') || 'x-api-key',
        in: 'header',
      },
      'X-API-Key',
    )
    .addSecurityRequirements('X-API-Key')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerCfg);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'Resultados – API Docs',
  });

  await app.listen(port, '0.0.0.0');
}
bootstrap();
