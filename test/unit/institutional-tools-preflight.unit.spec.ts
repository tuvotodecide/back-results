import { readFileSync } from 'fs';
import { resolve } from 'path';

describe('Institutional preflight tools (unit)', () => {
  const root = resolve(__dirname, '../..');

  it('preflight institucional usa colecciones reales, es solo lectura y no expone PII completa', () => {
    const source = readFileSync(
      resolve(root, 'tools/preflight-institutional-data.mjs'),
      'utf8',
    );

    expect(source).toContain("users: 'roled_users'");
    expect(source).not.toContain("db.collection('roledusers')");
    expect(source).toContain('readOnly: true');
    expect(source).not.toContain('--apply');
    expect(source).not.toContain('updateOne(');
    expect(source).not.toContain('deleteOne(');
    expect(source).not.toContain('insertOne(');
    expect(source).not.toContain('email: safeId');
    expect(source).not.toContain('dni: safeId');
    expect(source).not.toContain('phoneNumber: safeId');
  });

  it('script de indice wallet exige --apply para escribir y enmascara wallets', () => {
    const source = readFileSync(
      resolve(root, 'tools/manage-institutional-wallet-index.mjs'),
      'utf8',
    );

    expect(source).toContain("const dryRun = !apply");
    expect(source).toContain("command === 'backfill'");
    expect(source).toContain("command === 'create-index'");
    expect(source).toContain('walletFingerprint');
    expect(source).toContain("assignments.createIndex");
    expect(source).toContain("assignments.updateOne");
    expect(source).toContain("if (dryRun)");
  });
});
