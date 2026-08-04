const SENSITIVE_ENV_KEYS = [
  'BLOCKCHAIN_PRIVATE_KEY',
  'TVD_OPERATOR_PRIVATE_KEY',
  'NFT_PARTICIPATION_PRIVATE_KEY',
  'TVD_RPC_URL',
  'ZK_AUTH_RPC_URL',
] as const;

export type Mx06ExternalWriteBoundary = {
  writeContract: jest.Mock;
  sendTransaction: jest.Mock;
  sendRawTransaction: jest.Mock;
  sendUserOperation: jest.Mock;
  registerInstitution: jest.Mock;
  createInstitution: jest.Mock;
  assignTokens: jest.Mock;
  createVote: jest.Mock;
  approve: jest.Mock;
  topUp: jest.Mock;
};

/**
 * Keeps MX-06 focal harnesses deterministic even when Jest loaded a developer
 * .env. This changes only the test process; it never edits an env file.
 */
export function prepareMx06TestOnlyEnvironment() {
  process.env.NODE_ENV = 'test';
  process.env.RED_ENLACE_MODE = 'mock';
  for (const key of SENSITIVE_ENV_KEYS) delete process.env[key];
  (globalThis as { fetch?: unknown }).fetch = jest.fn(async () => {
    throw new Error('MX-06 TEST_ONLY blocked external fetch');
  });
}

export function assertMx06TestOnlyEnvironment() {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('MX-06 requires NODE_ENV=test');
  }
  if (String(process.env.RED_ENLACE_MODE).toLowerCase() !== 'mock') {
    throw new Error('MX-06 requires RED_ENLACE_MODE=mock');
  }
  const exposed = SENSITIVE_ENV_KEYS.filter((key) => process.env[key]?.trim());
  if (exposed.length > 0) {
    throw new Error(`MX-06 test process exposes protected configuration: ${exposed.join(', ')}`);
  }
}

export function createMx06ExternalWriteBoundary(): Mx06ExternalWriteBoundary {
  const blocked = (operation: string) => jest.fn(() => {
    throw new Error(`MX-06 TEST_ONLY blocked external write: ${operation}`);
  });
  return {
    writeContract: blocked('writeContract'),
    sendTransaction: blocked('sendTransaction'),
    sendRawTransaction: blocked('sendRawTransaction'),
    sendUserOperation: blocked('sendUserOperation'),
    registerInstitution: blocked('registerInstitution'),
    createInstitution: blocked('createInstitution'),
    assignTokens: blocked('assignTokens'),
    createVote: blocked('createVote'),
    approve: blocked('approve'),
    topUp: blocked('topUp'),
  };
}

export function expectNoMx06ExternalWrites(boundary: Mx06ExternalWriteBoundary) {
  Object.values(boundary).forEach((writer) => {
    expect(writer).not.toHaveBeenCalled();
  });
}
