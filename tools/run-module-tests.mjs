import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const rootDir = join(__dirname, '..');
const mapPath = join(__dirname, 'test-module-map.json');
const moduleMap = JSON.parse(readFileSync(mapPath, 'utf8'));
const moduleName = process.argv[2];
const extraArgs = process.argv.slice(3);

function printUsage() {
  console.error('Usage: node tools/run-module-tests.mjs <module|all|list|check> [jest args...]');
  console.error(`Modules: ${Object.keys(moduleMap).join(', ')}`);
}

function allFiles() {
  return Object.values(moduleMap).flatMap((entry) => entry.files);
}

function discoverSpecFiles(dir, base = dir) {
  const entries = readdirSync(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...discoverSpecFiles(fullPath, base));
      continue;
    }

    const relative = fullPath.slice(rootDir.length + 1).replaceAll('\\', '/');
    if (/(\.spec\.ts|\.test\.ts|-spec\.ts)$/.test(relative)) files.push(relative);
  }

  return files;
}

function checkMapping() {
  const files = allFiles();
  const duplicates = files.filter((file, index) => files.indexOf(file) !== index);
  const missing = files.filter((file) => !existsSync(join(rootDir, file)));
  const discovered = [
    ...discoverSpecFiles(join(rootDir, 'src')),
    ...discoverSpecFiles(join(rootDir, 'test')),
  ].sort();
  const unassigned = discovered.filter((file) => !files.includes(file));
  const stale = files.filter((file) => !discovered.includes(file));

  if (duplicates.length > 0) {
    console.error('Duplicate test files in module map:');
    for (const file of [...new Set(duplicates)]) console.error(`- ${file}`);
  }

  if (missing.length > 0) {
    console.error('Missing test files in module map:');
    for (const file of missing) console.error(`- ${file}`);
  }

  if (unassigned.length > 0) {
    console.error('Unassigned discovered test files:');
    for (const file of unassigned) console.error(`- ${file}`);
  }

  if (stale.length > 0) {
    console.error('Mapped files that are not discovered as tests:');
    for (const file of stale) console.error(`- ${file}`);
  }

  if (duplicates.length > 0 || missing.length > 0 || unassigned.length > 0 || stale.length > 0) {
    process.exit(1);
  }

  console.log(`Module map OK: ${files.length} unique test files assigned.`);
}

function runJest(files) {
  if (files.length === 0) {
    console.error('No test files configured for this module.');
    process.exit(1);
  }

  const jestBin = join(rootDir, 'node_modules', 'jest', 'bin', 'jest.js');
  const args = [
    jestBin,
    '-c',
    './jest.config.ts',
    '--testRegex',
    '.*(\\.spec\\.ts|\\.test\\.ts|-spec\\.ts)$',
    '--runInBand',
    '--runTestsByPath',
    ...files,
    ...extraArgs,
  ];

  const result = spawnSync(process.execPath, args, {
    cwd: rootDir,
    stdio: 'inherit',
    shell: false,
  });

  process.exit(result.status ?? 1);
}

if (!moduleName) {
  printUsage();
  process.exit(1);
}

if (moduleName === 'list') {
  for (const [key, entry] of Object.entries(moduleMap)) {
    console.log(`${key}: ${entry.name} (${entry.files.length} files)`);
  }
  process.exit(0);
}

if (moduleName === 'check') {
  checkMapping();
  process.exit(0);
}

if (moduleName === 'all') {
  checkMapping();
  runJest(allFiles());
}

const entry = moduleMap[moduleName];
if (!entry) {
  printUsage();
  process.exit(1);
}

checkMapping();
console.log(`Running ${entry.name}: ${entry.files.length} test files`);
runJest(entry.files);
