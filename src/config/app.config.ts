/* eslint-disable prettier/prettier */
import { registerAs } from '@nestjs/config';

export default registerAs('app', () => ({
  port: parseInt(process.env.PORT || '3000', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  version: process.env.npm_package_version || '1.0.0',

  database: {
    uri: process.env.MONGODB_URI || 'mongodb://localhost:27017/electoral_db',
    username: process.env.MONGODB_USERNAME ?? '',
    password: process.env.MONGODB_PASSWORD ?? '',
  },
  redis: {
    host: process.env.REDIS_HOST?.trim() || '',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD,
  },
  jwt: {
    secret: process.env.JWT_SECRET || 'yo-custodio-2025-secret',
    expirationTime: process.env.JWT_EXPIRATION_TIME || '24h',
  },

  cors: {
    origins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },

  cache: {
    ttl: parseInt(process.env.CACHE_TTL || '300', 10),
    max: parseInt(process.env.CACHE_MAX || '100', 10),
  },

  mail: {
    logoUrl: process.env.EMAIL_LOGO_URL || '',
    verificationBaseUrl: process.env.EMAIL_VERIFICATION_BASE_URL || '',
    verificationTokenTTLHours: parseInt(
      process.env.EMAIL_VERIFICATION_TOKEN_TTL_HOURS || '24',
      10,
    ),
    passwordResetBaseUrl: process.env.PASSWORD_RESET_BASE_URL || '',
    passwordResetTokenTTLHours: parseInt(
      process.env.PASSWORD_RESET_TOKEN_TTL_HOURS || '2',
      10,
    ),
    smtp: {
      region: process.env.SES_REGION || 'us-east-1',
      accessKeyId: process.env.SES_ACCESS_KEY_ID || '',
      secretAccessKey: process.env.SES_SECRET_ACCESS_KEY || '',
      from: process.env.SES_FROM_MAIL || 'noreply@example.com',
    },
  },

  zkAuth: {
    zkAuthTtl: parseInt(process.env.ZK_AUTH_API_KEY_TTL || '86400', 10), // 24 hours
    callbackUrl: process.env.ZK_AUTH_CALLBACK_URL,
    voteCallbackUrl: process.env.VOTE_CALLBACK_URL,
    audience: process.env.VERIFIER_DID,
    rpcUrl: process.env.ZK_AUTH_RPC_URL,
    network: process.env.ZK_AUTH_NETWORK,
    stateContract: process.env.ZK_AUTH_STATE_CONTRACT,
    ipfsGatewayUrl: process.env.IPFS_GATEWAY_URL || 'https://ipfs.io',
    credContext: process.env.VOTE_CRED_CONTEXT,
    credSchema: process.env.VOTE_CRED_SCHEMA,
    credType: process.env.VOTE_CRED_TYPE,
  },

  identity: {
    baseUrl: process.env.IDENTITY_BASE_URL,
    apiKey: process.env.IDENTITY_API_KEY,
  },

  issuer: {
    baseUrl: process.env.ISSUER_BASE_URL,
    username: process.env.ISSUER_USERNAME,
    password: process.env.ISSUER_PASSWORD,
    did: process.env.ISSUER_DID,
  },

  blockchain: {
    chain: process.env.CHAIN || 'base-sepolia',
    operationChainKey: process.env.CHAINA || '',
    participationPrivateKey: process.env.NFT_PARTICIPATION_PRIVATE_KEY || '',
    privateKey: process.env.BLOCKCHAIN_PRIVATE_KEY || '',
  },

  ai: {
    gemini: {
      apiKey: process.env.GEMINI_API_KEY || '',
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
    },
  },

  firebase: {
    projectId: process.env.FB_PROJECT_ID || '',
    clientEmail: process.env.FB_CLIENT_EMAIL || '',
    privateKey: (process.env.FB_PRIVATE_KEY || '').replace(/\\n/g, '\n'),
  },
}));
