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

  apiKey: {
    header: process.env.API_KEY_HEADER || 'x-api-key',
    keys: (process.env.API_KEYS || '')
      .split(',')
      .map((k) => k.trim())
      .filter(Boolean),
  },

  // cors: {
  //   origins: (process.env.CORS_ORIGINS ?? 'http://localhost:5173')
  //     .split(',')
  //     .map((s) => s.trim())
  //     .filter(Boolean),
  // },

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
  errorAlerts: {
    to: process.env.ERROR_ALERT_EMAIL_TO || '',
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

  officialPublicationMobileAuth: {
    callbackUrl: process.env.OFFICIAL_PUBLICATION_MOBILE_AUTH_CALLBACK_URL,
    ttlMs: parseInt(
      process.env.OFFICIAL_PUBLICATION_MOBILE_AUTH_TTL_MS || '600000',
      10,
    ),
    pendingTtlMs: parseInt(
      process.env.OFFICIAL_PUBLICATION_MOBILE_AUTH_PENDING_TTL_MS || '180000',
      10,
    ),
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

  tvd: {
    rpcUrl: process.env.TVD_RPC_URL || '',
    chainId: process.env.TVD_CHAIN_ID || '',
    tokenContractAddress: process.env.TVD_TOKEN_CONTRACT_ADDRESS || '',
    assignmentContractAddress: process.env.TVD_ASSIGNMENT_CONTRACT_ADDRESS || '',
    operatorPrivateKey: process.env.TVD_OPERATOR_PRIVATE_KEY || '',
    confirmationsRequired: process.env.TVD_CONFIRMATIONS_REQUIRED || '',
    // Provisional until Paso 3 validates this value against token.decimals().
    decimals: process.env.TVD_DECIMALS,
    accreditationWorkerEnabled:
      process.env.TVD_ACCREDITATION_WORKER_ENABLED || 'false',
    accreditationPollIntervalMs:
      process.env.TVD_ACCREDITATION_POLL_INTERVAL_MS || '5000',
    accreditationBatchSize: process.env.TVD_ACCREDITATION_BATCH_SIZE || '10',
    accreditationLockTtlMs: process.env.TVD_ACCREDITATION_LOCK_TTL_MS || '60000',
    operatorLockTtlMs: process.env.TVD_OPERATOR_LOCK_TTL_MS || '60000',
    accreditationMaxAttempts: process.env.TVD_ACCREDITATION_MAX_ATTEMPTS || '5',
    accreditationRetryBaseMs: process.env.TVD_ACCREDITATION_RETRY_BASE_MS || '5000',
    accreditationReconcileAfterMs:
      process.env.TVD_ACCREDITATION_RECONCILE_AFTER_MS || '15000',
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

  healthChecks: {
    pinataJwt: process.env.PINATA_JWT,
    coinbaseRpc: process.env.BUNDLER_MAIN,
  },

  officialPublicationArtifactEncryptionKey:
    process.env.OFFICIAL_PUBLICATION_ARTIFACT_ENCRYPTION_KEY || '',

  officialPublication: {
    requiredConfirmations:
      process.env.OFFICIAL_PUBLICATION_REQUIRED_CONFIRMATIONS || '1',
    reconciliationEnabled:
      process.env.OFFICIAL_PUBLICATION_RECONCILIATION_ENABLED || 'false',
    reconciliationIntervalMs:
      process.env.OFFICIAL_PUBLICATION_RECONCILIATION_INTERVAL_MS || '10000',
    reconciliationBatchSize:
      process.env.OFFICIAL_PUBLICATION_RECONCILIATION_BATCH_SIZE || '10',
    reconciliationLockMs:
      process.env.OFFICIAL_PUBLICATION_RECONCILIATION_LOCK_MS || '60000',
    maxRetries: process.env.OFFICIAL_PUBLICATION_MAX_RETRIES || '5',
    entryPointAddress:
      process.env.OFFICIAL_PUBLICATION_ENTRY_POINT_ADDRESS || '',
    entryPointVersion:
      process.env.OFFICIAL_PUBLICATION_ENTRY_POINT_VERSION || '0.6',
  },

  contracts: {
    tvdToken: {
      address: process.env.TVD_TOKEN_ADDRESS || '',
      txHash: process.env.TVD_TOKEN_TX_HASH || '',
    },
    coreVesting: {
      address: process.env.CORE_VESTING_ADDRESS || '',
      txHash: process.env.CORE_VESTING_TX_HASH || '',
    },
    multisigWallet: {
      address: process.env.TVD_MULTISIG_WALLET_ADDRESS || '',
      txHash: process.env.TVD_MULTISIG_WALLET_TX_HASH || '',
    },
    institutionalVesting: {
      address: process.env.INSTITUTIONAL_VESTING_ADDRESS || '',
      txHash: process.env.INSTITUTIONAL_VESTING_TX_HASH || '',
    },
    incentiveCampaigns: {
      address: process.env.INCENTIVE_CAMPAIGNS_ADDRESS || '',
      txHash: process.env.INCENTIVE_CAMPAIGNS_TX_HASH || '',
    },
    electoralCredits: {
      address: process.env.TVD_ELECTORAL_CREDITS_ADDRESS || '',
      txHash: process.env.TVD_ELECTORAL_CREDITS_TX_HASH || '',
    },
    voteManager: {
      address: process.env.TVD_VOTE_MANAGER_ADDRESS || '',
      txHash: process.env.TVD_VOTE_MANAGER_TX_HASH || '',
      implementationAddress: process.env.TVD_VOTE_MANAGER_IMPLEMENTATION_ADDRESS || '',
    },
  },

  redEnlace: {
    mode: process.env.RED_ENLACE_MODE || 'mock',
    baseUrl: process.env.RED_ENLACE_BASE_URL || '',
    apiKey: process.env.RED_ENLACE_API_KEY || '',
    callbackToken: process.env.RED_ENLACE_CALLBACK_TOKEN || '',
    webhookSecret: process.env.RED_ENLACE_WEBHOOK_SECRET || '',
    httpTimeoutMs: parseInt(process.env.RED_ENLACE_HTTP_TIMEOUT_MS || '5000', 10),
    qrTtl: process.env.RED_ENLACE_QR_TTL || '00:30:00',
    webhookAuthMode: process.env.RED_ENLACE_WEBHOOK_AUTH_MODE || 'api-key',
    mockVerifyStatus: process.env.RED_ENLACE_MOCK_VERIFY_STATUS || '',
    minAmountMinor: process.env.RED_ENLACE_MIN_AMOUNT_MINOR || '1',
    maxAmountMinor: process.env.RED_ENLACE_MAX_AMOUNT_MINOR || '100000000',
    maxQrImageBytes: process.env.RED_ENLACE_MAX_QR_IMAGE_BYTES || '',
  },
}));
