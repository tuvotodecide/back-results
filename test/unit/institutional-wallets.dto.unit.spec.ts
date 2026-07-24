import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import { ResolveInstitutionalWalletByDniDto } from '@/modules/institutional-wallets/dto/resolve-institutional-wallet-by-dni.dto';

async function validateDto(payload: unknown) {
  return validate(plainToInstance(ResolveInstitutionalWalletByDniDto, payload));
}

describe('ResolveInstitutionalWalletByDniDto', () => {
  it('accepts one trimmed DNI', async () => {
    const dto = plainToInstance(ResolveInstitutionalWalletByDniDto, { dni: ' 12345678 ' });
    await expect(validate(dto)).resolves.toHaveLength(0);
    expect(dto.dni).toBe('12345678');
  });

  it('rejects arrays, CSV, empty, short and nested DNI values', async () => {
    await expect(validateDto({ dni: ['12345678'] })).resolves.not.toHaveLength(0);
    await expect(validateDto({ dni: '123456,876543' })).resolves.not.toHaveLength(0);
    await expect(validateDto({ dni: '   ' })).resolves.not.toHaveLength(0);
    await expect(validateDto({ dni: '1234' })).resolves.not.toHaveLength(0);
    await expect(validateDto({ dni: { value: '12345678' } })).resolves.not.toHaveLength(0);
  });
});
