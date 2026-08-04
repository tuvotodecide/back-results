import { createRequire } from 'node:module';

import {
  createBlockedExternalWriteBoundary,
  expectNoExternalWrites,
  installTestExternalNetworkGuard,
  isAllowedTestLoopbackTarget,
  prepareTestExternalNetworkEnvironment,
  restoreTestExternalNetworkGuard,
} from '../utils/test-external-network-guard';

const runtimeRequire = createRequire(__filename);
type MutableNodeModule = Record<PropertyKey, unknown>;
type NetworkFunction = (...args: unknown[]) => unknown;
const httpModule = runtimeRequire('node:http') as unknown as MutableNodeModule;
const httpsModule = runtimeRequire('node:https') as unknown as MutableNodeModule;
const netModule = runtimeRequire('node:net') as unknown as MutableNodeModule;
const tlsModule = runtimeRequire('node:tls') as unknown as MutableNodeModule;

function moduleFunction(module: MutableNodeModule, key: PropertyKey): NetworkFunction {
  const value = module[key];
  if (typeof value !== 'function') throw new Error(`${String(key)} is not a function`);
  return value as NetworkFunction;
}

describe('test external network guard', () => {
  it('bloquea fetch externo sin invocar una red real', async () => {
    await expect(globalThis.fetch('https://example.invalid/audit')).rejects.toThrow(
      'TEST_EXTERNAL_NETWORK_BLOCKED fetch',
    );
  });

  it('bloquea HTTP, HTTPS, net y TLS externos antes de abrir una conexión', () => {
    expect(() => moduleFunction(httpModule, 'request')({ hostname: 'sepolia.base.org' })).toThrow('TEST_EXTERNAL_NETWORK_BLOCKED http.request');
    expect(() => moduleFunction(httpsModule, 'request')({ hostname: 'bundler.synthetic.invalid' })).toThrow('TEST_EXTERNAL_NETWORK_BLOCKED https.request');
    expect(() => moduleFunction(netModule, 'connect')({ host: 'paymaster.synthetic.invalid', port: 443 })).toThrow('TEST_EXTERNAL_NETWORK_BLOCKED net.connect');
    expect(() => moduleFunction(tlsModule, 'connect')({ host: 'example.invalid', port: 443 })).toThrow('TEST_EXTERNAL_NETWORK_BLOCKED tls.connect');
  });

  it('bloquea WebSocket externo antes de iniciar handshake', () => {
    const WebSocketCtor = (globalThis as {
      WebSocket?: new (target: string) => unknown;
    }).WebSocket;
    if (!WebSocketCtor) return;

    expect(() => new WebSocketCtor('wss://sepolia.base.org/ws')).toThrow(
      'TEST_EXTERNAL_NETWORK_BLOCKED WebSocket',
    );
  });

  it('permite de forma explícita destinos loopback sin abrirlos', () => {
    expect(isAllowedTestLoopbackTarget({ hostname: '127.0.0.1' })).toBe(true);
    expect(isAllowedTestLoopbackTarget({ hostname: 'localhost' })).toBe(true);
    expect(isAllowedTestLoopbackTarget({ hostname: '::1' })).toBe(true);
    expect(isAllowedTestLoopbackTarget({ hostname: 'example.invalid' })).toBe(false);
  });

  it('restaura fetch y los cuatro descriptors CommonJS con cleanup idempotente', () => {
    restoreTestExternalNetworkGuard();
    const originalFetch = globalThis.fetch;
    const originalHttpRequest = Object.getOwnPropertyDescriptor(httpModule, 'request');
    const originalHttpsRequest = Object.getOwnPropertyDescriptor(httpsModule, 'request');
    const originalNetConnect = Object.getOwnPropertyDescriptor(netModule, 'connect');
    const originalTlsConnect = Object.getOwnPropertyDescriptor(tlsModule, 'connect');

    const cleanup = installTestExternalNetworkGuard();
    expect(Object.getOwnPropertyDescriptor(httpModule, 'request')?.value).not.toBe(originalHttpRequest?.value);
    expect(Object.getOwnPropertyDescriptor(httpsModule, 'request')?.value).not.toBe(originalHttpsRequest?.value);
    expect(Object.getOwnPropertyDescriptor(netModule, 'connect')?.value).not.toBe(originalNetConnect?.value);
    expect(Object.getOwnPropertyDescriptor(tlsModule, 'connect')?.value).not.toBe(originalTlsConnect?.value);

    cleanup();
    cleanup();

    expect(globalThis.fetch).toBe(originalFetch);
    expect(Object.getOwnPropertyDescriptor(httpModule, 'request')).toEqual(originalHttpRequest);
    expect(Object.getOwnPropertyDescriptor(httpsModule, 'request')).toEqual(originalHttpsRequest);
    expect(Object.getOwnPropertyDescriptor(netModule, 'connect')).toEqual(originalNetConnect);
    expect(Object.getOwnPropertyDescriptor(tlsModule, 'connect')).toEqual(originalTlsConnect);

    installTestExternalNetworkGuard();
  });

  it('elimina secretos del proceso y conserva writers bloqueados como doubles', () => {
    process.env.TVD_OPERATOR_PRIVATE_KEY = 'synthetic-test-value';
    process.env.GEMINI_API_KEY = 'synthetic-gemini-key';
    process.env.IDENTITY_API_KEY = 'synthetic-identity-key';
    process.env.RED_ENLACE_API_KEY = 'synthetic-red-enlace-key';
    prepareTestExternalNetworkEnvironment();
    expect(process.env.TVD_OPERATOR_PRIVATE_KEY).toBeUndefined();
    expect(process.env.GEMINI_API_KEY).toBeUndefined();
    expect(process.env.IDENTITY_API_KEY).toBeUndefined();
    expect(process.env.RED_ENLACE_API_KEY).toBeUndefined();

    const writers = createBlockedExternalWriteBoundary();
    expect(() => writers.writeContract()).toThrow('TEST_EXTERNAL_NETWORK_BLOCKED writeContract');
    expect(writers.writeContract).toHaveBeenCalledTimes(1);
    writers.writeContract.mockClear();
    expect(() => writers.sendRawTransaction({ method: 'eth_sendRawTransaction' })).toThrow('TEST_EXTERNAL_NETWORK_BLOCKED sendRawTransaction');
    expect(() => writers.sendUserOperation({ method: 'eth_sendUserOperation' })).toThrow('TEST_EXTERNAL_NETWORK_BLOCKED sendUserOperation');
    expect(() => writers.executeCoinbaseOp()).toThrow('TEST_EXTERNAL_NETWORK_BLOCKED executeCoinbaseOp');
    expect(writers.sendRawTransaction).toHaveBeenCalledTimes(1);
    expect(writers.sendUserOperation).toHaveBeenCalledTimes(1);
    expect(writers.executeCoinbaseOp).toHaveBeenCalledTimes(1);
    writers.sendRawTransaction.mockClear();
    writers.sendUserOperation.mockClear();
    writers.executeCoinbaseOp.mockClear();
    expectNoExternalWrites(writers);
  });
});
