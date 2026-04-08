import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';

// Load environment variables for tests so modules that read process.env have defaults.
loadEnv();

jest.setTimeout(120000);

const g: any = globalThis as any;
if (!g.fetch) {
  g.fetch = jest.fn(async () => {
    throw new Error('no configurado para este test');
  });
}
