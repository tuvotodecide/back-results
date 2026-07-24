import { NestFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { getAddress, isAddress, zeroAddress } from 'viem';
import { AppConfigModule } from '../../src/config/app-config.module';

type DiagnosticStatus = 'PRESENTE' | 'AUSENTE' | 'VACIA';

const keys = [
  {
    label: 'app.contracts.electoralCredits.address',
    env: 'TVD_ELECTORAL_CREDITS_ADDRESS',
  },
  {
    label: 'app.contracts.voteManager.address',
    env: 'TVD_VOTE_MANAGER_ADDRESS',
  },
  {
    label: 'app.contracts.voteManager.implementationAddress',
    env: 'TVD_VOTE_MANAGER_IMPLEMENTATION_ADDRESS',
  },
] as const;

const classify = (value: unknown): DiagnosticStatus => {
  if (value === undefined || value === null) return 'AUSENTE';
  if (String(value).trim().length === 0) return 'VACIA';
  return 'PRESENTE';
};

const inspectAddress = (value: unknown) => {
  const raw = String(value ?? '').trim();
  const valid = isAddress(raw);
  return {
    status: classify(value),
    value: raw,
    isAddress: valid,
    zeroAddress: valid ? getAddress(raw) === zeroAddress : false,
  };
};

async function main() {
  const app = await NestFactory.createApplicationContext(AppConfigModule, {
    logger: false,
  });
  try {
    const config = app.get(ConfigService);
    const diagnostics = Object.fromEntries(
      keys.map((key) => [key.label, inspectAddress(config.get(key.label))]),
    );

    console.log(
      JSON.stringify(
        {
          NODE_ENV: process.env.NODE_ENV || null,
          cwd: process.cwd(),
          envFilePath: '.env',
          namespace: 'app',
          variables: Object.fromEntries(keys.map((key) => [key.env, key.label])),
          diagnostics,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
}

main().catch((error) => {
  console.error(
    JSON.stringify(
      {
        error: 'ELECTORAL_CREDITS_CONFIG_DIAGNOSTIC_FAILED',
        message: error instanceof Error ? error.message : 'Unknown error',
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
});
