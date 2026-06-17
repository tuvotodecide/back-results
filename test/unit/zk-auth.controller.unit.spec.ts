import { Test, TestingModule } from '@nestjs/testing';

jest.mock('@/modules/zk-auth/services/zk-auth.service', () => ({
  ZkAuthService: class ZkAuthService {},
}));

import { ZkAuthController } from '@/modules/zk-auth/controllers/zk-auth.controller';
import { ZkAuthService } from '@/modules/zk-auth/services/zk-auth.service';

describe('ZkAuthController (unit)', () => {
  let controller: ZkAuthController;
  let zkAuthService: {
    getAuthRequest: jest.Mock;
    getVoteRequest: jest.Mock;
    zkAuthCallback: jest.Mock;
  };

  beforeEach(async () => {
    zkAuthService = {
      getAuthRequest: jest.fn().mockReturnValue({
        apiKey: 'api-key-1',
        request: { id: 'auth-request' },
      }),
      getVoteRequest: jest.fn().mockReturnValue({
        request: { id: 'vote-request' },
      }),
      zkAuthCallback: jest.fn().mockResolvedValue({
        body: { scope: [] },
      }),
    };

    const moduleRef: TestingModule = await Test.createTestingModule({
      controllers: [ZkAuthController],
      providers: [{ provide: ZkAuthService, useValue: zkAuthService }],
    }).compile();

    controller = moduleRef.get(ZkAuthController);
  });

  it('requestApiKey delega a ZkAuthService y retorna apiKey/request', async () => {
    await expect(controller.requestApiKey()).resolves.toEqual({
      apiKey: 'api-key-1',
      request: { id: 'auth-request' },
    });
    expect(zkAuthService.getAuthRequest).toHaveBeenCalledTimes(1);
  });

  it('requestVoteAuth delega a ZkAuthService y retorna request', async () => {
    await expect(controller.requestVoteAuth()).resolves.toEqual({
      request: { id: 'vote-request' },
    });
    expect(zkAuthService.getVoteRequest).toHaveBeenCalledTimes(1);
  });

  it('zkAuthCallback delega sessionId y proof al service', async () => {
    await expect(
      controller.zkAuthCallback('session-1', 'mock-proof'),
    ).resolves.toEqual({
      body: { scope: [] },
    });
    expect(zkAuthService.zkAuthCallback).toHaveBeenCalledWith(
      'session-1',
      'mock-proof',
    );
  });

  it('propaga errores controlados del service mockeado', async () => {
    zkAuthService.zkAuthCallback.mockRejectedValueOnce(new Error('callback failed'));

    await expect(
      controller.zkAuthCallback('session-1', 'mock-proof'),
    ).rejects.toThrow('callback failed');
  });
});
