import { DirectPushService } from '@/modules/notifications/services/direct-push.service';

describe('DirectPushService (unit)', () => {
  let firebaseMessaging: { send: jest.Mock };
  let service: DirectPushService;

  beforeEach(() => {
    firebaseMessaging = {
      send: jest.fn().mockResolvedValue('mock-message-id'),
    };
    service = new DirectPushService({
      messaging: jest.fn(() => firebaseMessaging),
    } as any);
  });

  it('no llama Firebase cuando no hay tokens', async () => {
    await service.sendToTokens([], { title: 'Titulo', body: 'Mensaje' }, { type: 'generic' });

    expect(firebaseMessaging.send).not.toHaveBeenCalled();
  });

  it('envía un mensaje por token usando Firebase mock', async () => {
    await service.sendToTokens(
      ['token-1', 'token-2'],
      { title: 'Conteo iniciado', body: 'Hay una novedad' },
      { type: 'announce_count', locationId: 'loc-1' },
    );

    expect(firebaseMessaging.send).toHaveBeenCalledTimes(2);
    expect(firebaseMessaging.send).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        token: 'token-1',
        notification: { title: 'Conteo iniciado', body: 'Hay una novedad' },
        data: { type: 'announce_count', locationId: 'loc-1' },
        android: { priority: 'high' },
        apns: { headers: { 'apns-priority': '10' } },
      }),
    );
    expect(firebaseMessaging.send).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        token: 'token-2',
      }),
    );
  });

  it('maneja error de Firebase sin propagar servicios reales', async () => {
    const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    firebaseMessaging.send.mockRejectedValueOnce(new Error('fcm failed'));

    await expect(
      service.sendToTokens(
        ['token-error'],
        { title: 'Titulo', body: 'Mensaje' },
        { type: 'generic' },
      ),
    ).resolves.toBeUndefined();

    expect(firebaseMessaging.send).toHaveBeenCalledTimes(1);
    expect(consoleSpy).toHaveBeenCalledWith('FCM error (direct push)', expect.any(Error));

    consoleSpy.mockRestore();
  });
});
