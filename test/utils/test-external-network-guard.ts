import { createRequire } from 'node:module';

const runtimeRequire = createRequire(__filename);

type MutableNodeModule = Record<PropertyKey, unknown>;
type NetworkFunction = (...args: unknown[]) => unknown;
type RestorePatch = () => void;
type WebSocketConstructor = new (...args: unknown[]) => unknown;

const httpModule = runtimeRequire('node:http') as unknown as MutableNodeModule;
const httpsModule = runtimeRequire('node:https') as unknown as MutableNodeModule;
const netModule = runtimeRequire('node:net') as unknown as MutableNodeModule;
const tlsModule = runtimeRequire('node:tls') as unknown as MutableNodeModule;

const SENSITIVE_ENVIRONMENT_KEY = /(?:PRIVATE(?:_|$)|MNEMONIC|(?:^|_)RPC(?:_|$)|BUNDLER|PAYMASTER|RED_ENLACE_(?:API_KEY|BASE_URL|CALLBACK_TOKEN|WEBHOOK_SECRET)|GEMINI_(?:API_KEY|BASE_URL)|IDENTITY_(?:API_KEY|BASE_URL)|RESOLVER(?:_|$))/i;
const KNOWN_SENSITIVE_ENVIRONMENT_KEYS = [
  'PRIVATE_KEY',
  'MNEMONIC',
  'RPC_URL',
  'BLOCKCHAIN_RPC_URL',
  'BUNDLER_URL',
  'PAYMASTER_URL',
  'RED_ENLACE_API_KEY',
  'GEMINI_API_KEY',
  'IDENTITY_API_KEY',
  'FB_PRIVATE_KEY',
  'NFT_PARTICIPATION_PRIVATE_KEY',
  'BLOCKCHAIN_PRIVATE_KEY',
  'TVD_OPERATOR_PRIVATE_KEY',
  'TVD_RPC_URL',
  'ZK_AUTH_RPC_URL',
  'RESOLVER_KEY',
  'RESOLVER_PK',
] as const;
const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', 'localhost']);

export type ExternalWriteBoundary = Record<
  'writeContract' | 'sendTransaction' | 'sendRawTransaction' | 'sendUserOperation' | 'executeCoinbaseOp' | 'registerInstitution' | 'createInstitution' | 'assignTokens' | 'createVote' | 'castVote' | 'approve' | 'topUp',
  jest.Mock
>;

let activeRestore: (() => void) | null = null;

function requireFunction(value: unknown, label: string): NetworkFunction {
  if (typeof value !== 'function') {
    throw new Error(`${label} is not a function`);
  }

  return value as NetworkFunction;
}

function patchFunction(
  target: MutableNodeModule,
  key: PropertyKey,
  replacement: NetworkFunction,
): RestorePatch {
  const descriptor = Object.getOwnPropertyDescriptor(target, key);

  if (!descriptor) {
    throw new Error(`Missing property ${String(key)}`);
  }

  if ('value' in descriptor && descriptor.configurable) {
    Object.defineProperty(target, key, { ...descriptor, value: replacement });
  } else if ('value' in descriptor && descriptor.writable) {
    const changed = Reflect.set(target, key, replacement);
    if (!changed) {
      throw new Error(`Cannot patch ${String(key)}`);
    }
  } else {
    throw new Error(`Property ${String(key)} is not patchable`);
  }

  let restored = false;
  return () => {
    if (restored) return;
    Object.defineProperty(target, key, descriptor);
    restored = true;
  };
}

function hostFromTarget(target: unknown): string | undefined {
  const normalizeHost = (value: string) => value.replace(/^\[|\]$/g, '').toLowerCase();
  if (target instanceof URL) return normalizeHost(target.hostname);
  if (typeof target === 'string') {
    try {
      return normalizeHost(new URL(target).hostname);
    } catch {
      return undefined;
    }
  }
  if (!target || typeof target !== 'object') return undefined;
  const candidate = target as { hostname?: unknown; host?: unknown; socketPath?: unknown };
  if (typeof candidate.socketPath === 'string' && candidate.socketPath.length > 0) {
    return 'localhost';
  }
  const host = typeof candidate.hostname === 'string'
    ? candidate.hostname
    : typeof candidate.host === 'string'
      ? candidate.host.startsWith('[')
        ? candidate.host.slice(1, candidate.host.indexOf(']'))
        : candidate.host === '::1'
          ? candidate.host
          : candidate.host.split(':')[0]
      : undefined;
  return host ? normalizeHost(host) : undefined;
}

export function isAllowedTestLoopbackTarget(target: unknown) {
  const host = hostFromTarget(target);
  return host !== undefined && LOOPBACK_HOSTS.has(host);
}

export function prepareTestExternalNetworkEnvironment() {
  process.env.NODE_ENV = 'test';
  process.env.RED_ENLACE_MODE = 'mock';
  for (const key of KNOWN_SENSITIVE_ENVIRONMENT_KEYS) delete process.env[key];
  for (const key of Object.keys(process.env)) {
    if (SENSITIVE_ENVIRONMENT_KEY.test(key)) delete process.env[key];
  }
}

function assertLoopback(operation: string, target: unknown) {
  if (!isAllowedTestLoopbackTarget(target)) {
    throw new Error(`TEST_EXTERNAL_NETWORK_BLOCKED ${operation}`);
  }
}

/**
 * Blocks every network boundary used by tests except an explicitly addressed
 * loopback server. It never opens a connection while deciding whether to block.
 */
export function installTestExternalNetworkGuard() {
  prepareTestExternalNetworkEnvironment();
  if (activeRestore) return activeRestore;

  const originalFetch = globalThis.fetch;
  const originalHttpRequest = requireFunction(httpModule.request, 'http.request');
  const originalHttpsRequest = requireFunction(httpsModule.request, 'https.request');
  const originalNetConnect = requireFunction(netModule.connect, 'net.connect');
  const originalTlsConnect = requireFunction(tlsModule.connect, 'tls.connect');
  const webSocketScope = globalThis as unknown as { WebSocket?: WebSocketConstructor };
  const originalWebSocket = webSocketScope.WebSocket;

  (globalThis as { fetch: typeof fetch }).fetch = (async (input: unknown, ...args: unknown[]) => {
    assertLoopback('fetch', input);
    if (!originalFetch) throw new Error('TEST_ONLY original fetch is unavailable');
    return (originalFetch as unknown as (...callArgs: unknown[]) => unknown)(input, ...args);
  }) as unknown as typeof fetch;
  const blockedHttpRequest = (...args: unknown[]) => {
    assertLoopback('http.request', args[0]);
    return originalHttpRequest(...args);
  };
  const blockedHttpsRequest = (...args: unknown[]) => {
    assertLoopback('https.request', args[0]);
    return originalHttpsRequest(...args);
  };
  const blockedNetConnect = (...args: unknown[]) => {
    assertLoopback('net.connect', args[0]);
    return originalNetConnect(...args);
  };
  const blockedTlsConnect = (...args: unknown[]) => {
    assertLoopback('tls.connect', args[0]);
    return originalTlsConnect(...args);
  };

  const restoreHttp = patchFunction(httpModule, 'request', blockedHttpRequest);
  const restoreHttps = patchFunction(httpsModule, 'request', blockedHttpsRequest);
  const restoreNet = patchFunction(netModule, 'connect', blockedNetConnect);
  const restoreTls = patchFunction(tlsModule, 'connect', blockedTlsConnect);
  if (originalWebSocket) {
    webSocketScope.WebSocket = function blockedWebSocket(target: unknown, ...args: unknown[]) {
      assertLoopback('WebSocket', target);
      return Reflect.construct(originalWebSocket, [target, ...args]);
    } as unknown as WebSocketConstructor;
  }

  let restored = false;
  const cleanup = () => {
    if (restored) return;
    restored = true;
    (globalThis as { fetch: typeof fetch }).fetch = originalFetch;
    restoreTls();
    restoreNet();
    restoreHttps();
    restoreHttp();
    webSocketScope.WebSocket = originalWebSocket;
    if (activeRestore === cleanup) activeRestore = null;
  };
  activeRestore = cleanup;
  return cleanup;
}

export function restoreTestExternalNetworkGuard() {
  activeRestore?.();
}

export function createBlockedExternalWriteBoundary(): ExternalWriteBoundary {
  const blocked = (operation: string) => jest.fn(() => {
    throw new Error(`TEST_EXTERNAL_NETWORK_BLOCKED ${operation}`);
  });
  return {
    writeContract: blocked('writeContract'),
    sendTransaction: blocked('sendTransaction'),
    sendRawTransaction: blocked('sendRawTransaction'),
    sendUserOperation: blocked('sendUserOperation'),
    executeCoinbaseOp: blocked('executeCoinbaseOp'),
    registerInstitution: blocked('registerInstitution'),
    createInstitution: blocked('createInstitution'),
    assignTokens: blocked('assignTokens'),
    createVote: blocked('createVote'),
    castVote: blocked('castVote'),
    approve: blocked('approve'),
    topUp: blocked('topUp'),
  };
}

export function expectNoExternalWrites(boundary: ExternalWriteBoundary) {
  Object.values(boundary).forEach((writer) => expect(writer).not.toHaveBeenCalled());
}
