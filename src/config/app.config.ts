/* eslint-disable prettier/prettier */
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',

  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/electoral_db',
    username: process.env.MONGODB_USERNAME,
    password: process.env.MONGODB_PASSWORD,
  },
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'yo-custodio-2025-secret',
    expirationTime: process.env.JWT_EXPIRATION_TIME || '24h',
  },

  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:3000')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '300', 10),
    max: parseInt(process.env.CACHE_MAX || '100', 10),
  },
  apiKey: {
    header: process.env.API_KEY_HEADER || 'x-api-key',
    keys: (process.env.API_KEYS ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
}));
