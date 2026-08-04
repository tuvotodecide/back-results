import 'reflect-metadata';
import {
  installTestExternalNetworkGuard,
  restoreTestExternalNetworkGuard,
} from './utils/test-external-network-guard';

process.env.NODE_ENV = 'test';
installTestExternalNetworkGuard();

jest.mock('dotenv', () => {
  const dotenv = jest.requireActual('dotenv') as unknown as Record<string, unknown>;
  const noRealEnvFile = () => ({ parsed: {} });
  return {
    ...dotenv,
    config: noRealEnvFile,
    configDotenv: noRealEnvFile,
  };
});

afterAll(() => {
  restoreTestExternalNetworkGuard();
});

jest.setTimeout(120000);

const g: unknown = globalThis;
if (!(g as { fetch?: unknown }).fetch) {
  (g as { fetch?: unknown }).fetch = jest.fn(async () => {
    throw new Error('no configurado para este test');
  });
}
