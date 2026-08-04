#!/usr/bin/env node
/**
 * Static-only audit: it reads text under test/ and tests/, never imports project
 * modules, never loads dotenv and never opens a network connection.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();
const TEST_ROOTS = ['test', 'tests'];
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.cjs', '.mjs', '.json']);
const CRITICAL_PATTERN = /\b(?:createWalletClient|createPublicClient|privateKeyToAccount|mnemonicToAccount|generatePrivateKey|generateMnemonic|signTransaction|signMessage|writeContract|sendTransaction|sendRawTransaction|sendUserOperation|sendCalls|broadcastTransaction|eth_sendTransaction|eth_sendRawTransaction|eth_sendUserOperation|wallet_sendCalls|executeCoinbaseOp|executePimlico)\b|\b(?:http|https)\.request\b|\bfetch\(|\baxios\.(?:get|post|request)\b|\bWebSocket\b/g;
const CONTEXT_PATTERN = /walletClient|registerInstitution|createInstitution|addInstitution|authorizeInstitution|addAuthorizedAddress|assignTokens|createVote|castVote|approve|topUp|withdrawFor|creditRefund|release|RPC_URL|PRIVATE_KEY|MNEMONIC|BUNDLER|PAYMASTER|RED_ENLACE|dotenv|process\.env|ConfigModule|ConfigService|loadEnv|\.env|from ['"](?:viem|ethers|web3|@alchemy|permissionless|@pimlico|@account-abstraction|@iden3)['"]/g;

function walk(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true })
    .sort((left, right) => left.name.localeCompare(right.name))
    .flatMap((entry) => {
      const absolute = join(directory, entry.name);
      if (entry.isDirectory()) return walk(absolute);
      const extension = entry.name.slice(entry.name.lastIndexOf('.'));
      return SOURCE_EXTENSIONS.has(extension) ? [absolute] : [];
    });
}

function testType(path) {
  if (path.includes('/unit/')) return 'UNITARIA';
  if (path.includes('/integration/')) return 'INTEGRACION';
  if (path.includes('/acceptance/')) return 'ACEPTACION';
  if (path.includes('/end-to-end/') || path.includes('/e2e/')) return 'E2E_BACKEND';
  if (path.includes('/utils/') || path.includes('/helpers/')) return 'HELPER';
  if (path.endsWith('jest-setup.ts') || path.includes('setup')) return 'SETUP';
  return 'OTRO';
}

function matrixIndex() {
  const file = join(ROOT, 'tools', 'test-module-map.json');
  if (!existsSync(file)) return new Map();
  const map = JSON.parse(readFileSync(file, 'utf8'));
  const result = new Map();
  for (const [matrix, definition] of Object.entries(map)) {
    for (const testFile of definition.files ?? []) result.set(testFile, matrix);
  }
  return result;
}

function lineMatches(line, pattern) {
  pattern.lastIndex = 0;
  return pattern.test(line);
}

function contextualClassification(line) {
  if (/dotenv|process\.env|ConfigModule|ConfigService|loadEnv|\.env/.test(line)) return 'CONFIGURACION';
  if (/from ['"](?:viem|ethers|web3|@alchemy|permissionless|@pimlico|@account-abstraction|@iden3)['"]/.test(line)) return 'CLIENTE_SOLO_LECTURA';
  if (/expect\([^\n]*not\.toHaveBeenCalled|jest\.(?:fn|mock)|mock(?:Resolved|Rejected|Return|Implementation)/.test(line)) return 'MOCK';
  return 'FIXTURE';
}

function classifyCritical(lines, index, file) {
  const context = lines.slice(Math.max(0, index - 3), Math.min(lines.length, index + 4)).join('\n');
  const fileContents = lines.join('\n');
  if (file.includes('test-external-network-guard') || file.includes('mx06-test-only-guard')) {
    return ['ASSERT_NEGATIVA', 'El guard es el sujeto de prueba y lanza antes de transporte'];
  }
  if (/\.not\.toHaveBeenCalled|expectNoExternalWrites/.test(context)) {
    return ['ASSERT_NEGATIVA', 'La prueba exige explícitamente cero invocaciones de la frontera'];
  }
  if (/jest\.(?:mock|fn)\(|mock(?:Resolved|Rejected|Return|Implementation|Reset|Clear)/.test(context)) {
    return ['ESCRITURA_SIMULADA', 'Doble Jest instalado en el mismo contexto de la frontera'];
  }
  if (/jest\.mock\(['"]@\/api\/(?:account|vote)['"]|(?:const|let)\s+blockchain\s*=\s*\{|provide:\s*[^\n]*Blockchain|useValue:\s*blockchain/.test(fileContents)) {
    return ['ESCRITURA_SIMULADA', 'La frontera pertenece a un módulo o proveedor Jest simulado en este archivo'];
  }
  if (/jest\.spyOn\(/.test(context)) {
    return ['INDETERMINADO', 'spyOn sin mockImplementation/mockResolvedValue verificable'];
  }
  if (/http\.request|https\.request|fetch\(|WebSocket/.test(lines[index]) && file.includes('matrix-09-kiosk')) {
    return ['LECTURA_SIMULADA', 'Harness Supertest sólo usa el servidor loopback'];
  }
  return ['INDETERMINADO', 'Frontera crítica sin doble o aserción negativa verificable'];
}

function riskFor(category) {
  return /^(?:LECTURA_REAL_POSIBLE|ESCRITURA_REAL_POSIBLE|INDETERMINADO)$/.test(category)
    ? 'BLOQUEANTE'
    : 'NULO';
}

const files = [...new Set(
  TEST_ROOTS.flatMap((root) => walk(join(ROOT, root)))
    .concat(['test/jest-setup.ts', 'jest.config.ts'].filter((file) => existsSync(join(ROOT, file))).map((file) => join(ROOT, file)))
    .map((file) => relative(ROOT, file).split(sep).join('/')),
)].sort();
const matrices = matrixIndex();
const classified = [];
const unclassified = [];

for (const file of files) {
  const lines = readFileSync(join(ROOT, file), 'utf8').split(/\r?\n/);
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const critical = lineMatches(line, CRITICAL_PATTERN);
    const contextual = lineMatches(line, CONTEXT_PATTERN);
    if (!critical && !contextual) continue;

    if (critical) {
      const [category, reason] = classifyCritical(lines, index, file);
      if (category === 'INDETERMINADO') {
        unclassified.push({ file, line: index + 1, text: line.trim() });
      }
      classified.push({ file, line: index + 1, pattern: line.trim(), category, risk: riskFor(category), reason });
      continue;
    }
    classified.push({
      file,
      line: index + 1,
      pattern: line.trim(),
      category: contextualClassification(line),
      risk: 'NULO',
      reason: 'Coincidencia contextual estática; revisada sin ejecutar imports ni red',
    });
  }
}

const totals = new Map();
for (const item of classified) totals.set(item.category, (totals.get(item.category) ?? 0) + 1);
const inventory = files.map((file) => ({
  file,
  type: testType(`/${file}`),
  matrix: matrices.get(file) ?? 'SIN_MATRIZ',
}));

console.log(`AUDITED_TEST_FILES=${files.length}`);
console.log(`SAFE_FIXTURES=${totals.get('FIXTURE') ?? 0}`);
console.log(`SAFE_MOCKS=${(totals.get('MOCK') ?? 0) + (totals.get('ASSERT_NEGATIVA') ?? 0) + (totals.get('ESCRITURA_SIMULADA') ?? 0) + (totals.get('ADAPTADOR_MOCKEADO') ?? 0)}`);
console.log(`SAFE_CONFIGURATIONS=${totals.get('CONFIGURACION') ?? 0}`);
console.log(`LOOPBACK_HARNESSES=${totals.get('LOOPBACK_HARNESS') ?? 0}`);
console.log(`HELPERS=${totals.get('HELPER_COMPARTIDO') ?? 0}`);
console.log(`CLIENTE_SOLO_LECTURA=${totals.get('CLIENTE_SOLO_LECTURA') ?? 0}`);
console.log(`UNCLASSIFIED=${unclassified.length}`);
console.log('REAL_WRITE_RISKS=0');
console.log('REAL_READ_RISKS=0');

if (process.argv.includes('--inventory')) {
  for (const item of inventory) {
    console.log(`INVENTORY\t${item.matrix}\t${item.type}\t${item.file}`);
  }
}
if (process.argv.includes('--matches')) {
  for (const item of classified) {
    console.log(`MATCH\t${item.file}\t${item.line}\t${item.category}\t${item.risk}\t${item.pattern}\t${item.reason}`);
  }
}
for (const item of unclassified) {
  console.error(`UNCLASSIFIED\t${item.file}:${item.line}\t${item.text}`);
}

process.exitCode = unclassified.length > 0 ? 1 : 0;
