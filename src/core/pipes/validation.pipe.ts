/* eslint-disable prettier/prettier */
import { ValidationPipe as NestValidationPipe } from '@nestjs/common';

export const GlobalValidationPipe = new NestValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: {
    enableImplicitConversion: true,
  },
});
