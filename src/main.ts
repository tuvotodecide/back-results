import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { ConfigService } from '@nestjs/config';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import { json, urlencoded, text } from 'express';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bodyParser: false });

  const config = app.get(ConfigService);
  const port = config.get<number>('app.port') ?? 3000;

  // Mantener esta configuración HTTP exactamente como está hasta validar
  // compatibilidad con frontend, integraciones y despliegues existentes.
  app.enableCors({
    origin: true,
    credentials: true,
    methods: ['GET', 'HEAD', 'PUT', 'PATCH', 'POST', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'x-kiosk-token',
      'Cache-Control',
      'cache-control',
      'Pragma',
      'Last-Event-ID',
    ],
    exposedHeaders: ['Content-Disposition'],
    maxAge: 86400,
  });

  app.use(json({ limit: '8mb' }));
  app.use(urlencoded({ extended: true, limit: '8mb' }));
  app.use(text({ type: 'text/plain', limit: '8mb' }));

  // Este pipe global ya forma parte del comportamiento observable actual.
  // Cualquier ajuste aquí requiere validación funcional previa.
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // Swagger refleja el comportamiento actual; no introduce cambios funcionales.
  const swaggerCfg = new DocumentBuilder()
    .setTitle('Resultados API')
    .setDescription('API de resultados electorales')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
      },
      'bearer',
    )
    .addSecurityRequirements('bearer')
    .build();

  const document = SwaggerModule.createDocument(app, swaggerCfg);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
    customSiteTitle: 'Resultados – API Docs',
  });

  await app.listen(port, '0.0.0.0');
}
bootstrap();
