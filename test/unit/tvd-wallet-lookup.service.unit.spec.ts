import {
  BadGatewayException,
  BadRequestException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { getAddress } from 'viem';
import { TvdWalletLookupService } from '@/modules/tvd/services/tvd-wallet-lookup.service';

const walletA = getAddress('0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
const walletB = getAddress('0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb');
const zeroWallet = '0x0000000000000000000000000000000000000000';

const query = <T>(value: T) => ({
  lean: jest.fn().mockResolvedValue(value),
});

describe('TvdWalletLookupService (unit)', () => {
  let assignmentModel: any;
  let tenantModel: any;
  let userModel: any;
  let httpService: any;
  let configService: any;
  let service: TvdWalletLookupService;

  beforeEach(() => {
    assignmentModel = { find: jest.fn().mockReturnValue(query([])) };
    tenantModel = { find: jest.fn().mockReturnValue(query([])) };
    userModel = { find: jest.fn().mockReturnValue(query([])) };
    httpService = {
      axiosRef: {
        get: jest.fn().mockResolvedValue({
          data: {
            ok: true,
            record: {
              accountAddress: walletA,
              discoverableHash: '0x-sensitive-hash',
              guardianContractAddress: '0x-sensitive-guardian',
            },
          },
        }),
      },
    };
    configService = {
      get: jest.fn((key: string, fallback?: unknown) => {
        if (key === 'app.identity.baseUrl') return 'https://identity.example.test/';
        if (key === 'app.identity.apiKey') return 'identity-secret-key';
        if (key === 'IDENTITY_HTTP_TIMEOUT_MS') return 2500;
        return fallback;
      }),
    };
    service = new TvdWalletLookupService(
      assignmentModel,
      tenantModel,
      userModel,
      httpService,
      configService,
    );
  });

  it('normaliza direcciones EVM validas y rechaza invalidas o direccion cero', () => {
    expect(service.normalizeAccountAddress(walletA.toLowerCase())).toBe(walletA);
    expect(() => service.normalizeAccountAddress('not-a-wallet')).toThrow(
      BadRequestException,
    );
    expect(() => service.normalizeAccountAddress(zeroWallet)).toThrow(
      BadRequestException,
    );
  });

  it('consulta Identity server-to-server y no expone campos sensibles ni API key', async () => {
    const result = await service.lookupAdminWallet(walletA, {
      sub: new Types.ObjectId().toHexString(),
      role: 'ADMIN',
      active: true,
    });

    expect(httpService.axiosRef.get).toHaveBeenCalledWith(
      'https://identity.example.test/registry/by-account',
      expect.objectContaining({
        params: { accountAddress: walletA },
        headers: { 'x-api-key': 'identity-secret-key' },
        timeout: 2500,
      }),
    );
    expect(result).toMatchObject({
      accountAddress: walletA,
      registeredInIdentity: true,
      identityStatus: 'REGISTERED',
      associationStatus: 'UNASSOCIATED',
      canUse: true,
      reasonCode: 'WALLET_AVAILABLE',
      associations: [],
    });
    expect(JSON.stringify(result)).not.toContain('identity-secret-key');
    expect(JSON.stringify(result)).not.toContain('discoverableHash');
    expect(JSON.stringify(result)).not.toContain('guardianContractAddress');
    expect(JSON.stringify(result)).not.toContain('dni');
  });

  it('devuelve contrato seguro cuando Identity reporta wallet no registrada', async () => {
    httpService.axiosRef.get.mockResolvedValueOnce({
      data: { ok: false, error: 'not-found' },
    });

    await expect(service.lookupAdminWallet(walletA, { role: 'ADMIN' })).resolves.toMatchObject({
      registeredInIdentity: false,
      identityStatus: 'NOT_REGISTERED',
      associationStatus: 'UNASSOCIATED',
      canUse: false,
      reasonCode: 'WALLET_NOT_REGISTERED',
    });
  });

  it('normaliza Identity caido o respuesta invalida sin filtrar errores tecnicos', async () => {
    httpService.axiosRef.get.mockRejectedValueOnce(
      new Error('ECONNREFUSED https://internal.example.test secret'),
    );

    await expect(service.lookupAdminWallet(walletA, { role: 'ADMIN' })).rejects.toMatchObject({
      response: expect.objectContaining({
        code: 'TVD_IDENTITY_UNAVAILABLE',
      }),
    });

    httpService.axiosRef.get.mockResolvedValueOnce({ data: { unexpected: true } });
    await expect(service.lookupAdminWallet(walletA, { role: 'ADMIN' })).rejects.toBeInstanceOf(
      BadGatewayException,
    );
  });

  it('clasifica asociacion local operativa sin exponer datos privados del usuario', async () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    const assignmentId = new Types.ObjectId();
    assignmentModel.find.mockReturnValueOnce(
      query([
        {
          _id: assignmentId,
          tenantId,
          userId,
          status: 'APPROVED',
          active: true,
          institutionalRole: 'PRIMARY',
          accountAddress: walletA,
          accountAddressNormalized: walletA.toLowerCase(),
          walletVerifiedAt: new Date('2026-01-01T00:00:00.000Z'),
          walletVerificationSource: 'IDENTITY',
        },
      ]),
    );
    tenantModel.find.mockReturnValueOnce(
      query([{ _id: tenantId, name: 'Tenant A', active: true }]),
    );
    userModel.find.mockReturnValueOnce(query([{ _id: userId, active: true }]));

    const result = await service.lookupAdminWallet(walletA, { role: 'ADMIN' });

    expect(result).toMatchObject({
      associationStatus: 'ASSOCIATED',
      canUse: true,
      reasonCode: 'WALLET_ASSOCIATED',
      associations: [
        {
          tenantId: String(tenantId),
          tenantName: 'Tenant A',
          assignmentId: String(assignmentId),
          userId: String(userId),
          institutionalRole: 'PRIMARY',
          walletStatus: 'VERIFIED',
        },
      ],
    });
    expect(JSON.stringify(result)).not.toContain('password');
    expect(JSON.stringify(result)).not.toContain('email');
    expect(JSON.stringify(result)).not.toContain('dni');
  });

  it('clasifica wallets locales deshabilitadas, incompatibles o inconsistentes', async () => {
    const tenantId = new Types.ObjectId();
    const userId = new Types.ObjectId();
    assignmentModel.find.mockReturnValueOnce(
      query([
        {
          _id: new Types.ObjectId(),
          tenantId,
          userId,
          status: 'APPROVED',
          active: false,
          accountAddress: walletA,
          accountAddressNormalized: walletA.toLowerCase(),
          walletVerifiedAt: new Date(),
          walletVerificationSource: 'IDENTITY',
        },
      ]),
    );
    tenantModel.find.mockReturnValueOnce(
      query([{ _id: tenantId, name: 'Tenant A', active: true }]),
    );
    userModel.find.mockReturnValueOnce(query([{ _id: userId, active: true }]));

    await expect(service.lookupAdminWallet(walletA, { role: 'ADMIN' })).resolves.toMatchObject({
      associationStatus: 'DISABLED',
      canUse: false,
      reasonCode: 'WALLET_DISABLED',
    });

    assignmentModel.find.mockReturnValueOnce(
      query([
        {
          _id: new Types.ObjectId(),
          tenantId,
          userId,
          status: 'PENDING',
          active: true,
          accountAddress: walletA,
          accountAddressNormalized: walletA.toLowerCase(),
        },
      ]),
    );
    tenantModel.find.mockReturnValueOnce(
      query([{ _id: tenantId, name: 'Tenant A', active: true }]),
    );
    userModel.find.mockReturnValueOnce(query([{ _id: userId, active: true }]));

    await expect(service.lookupAdminWallet(walletA, { role: 'ADMIN' })).resolves.toMatchObject({
      associationStatus: 'INCOMPATIBLE',
      canUse: false,
      reasonCode: 'WALLET_INCOMPATIBLE',
    });

    assignmentModel.find.mockReturnValueOnce(
      query([
        {
          _id: new Types.ObjectId(),
          tenantId,
          userId,
          status: 'APPROVED',
          active: true,
          accountAddress: walletA,
          accountAddressNormalized: walletA.toLowerCase(),
        },
        {
          _id: new Types.ObjectId(),
          tenantId,
          userId: new Types.ObjectId(),
          status: 'APPROVED',
          active: true,
          accountAddress: walletA,
          accountAddressNormalized: walletA.toLowerCase(),
        },
      ]),
    );
    tenantModel.find.mockReturnValueOnce(
      query([{ _id: tenantId, name: 'Tenant A', active: true }]),
    );
    userModel.find.mockReturnValueOnce(query([{ _id: userId, active: true }]));

    await expect(service.lookupAdminWallet(walletA, { role: 'ADMIN' })).resolves.toMatchObject({
      associationStatus: 'INCONSISTENT',
      canUse: false,
      reasonCode: 'WALLET_INCONSISTENT',
    });
  });

  it('no consulta Identity si la configuracion server-to-server falta', async () => {
    configService.get.mockImplementation((key: string, fallback?: unknown) => {
      if (key === 'app.identity.baseUrl') return '';
      if (key === 'app.identity.apiKey') return '';
      return fallback;
    });

    await expect(service.lookupAdminWallet(walletB, { role: 'ADMIN' })).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(httpService.axiosRef.get).not.toHaveBeenCalled();
  });
});
