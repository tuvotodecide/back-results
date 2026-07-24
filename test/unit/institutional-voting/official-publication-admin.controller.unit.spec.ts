import { OfficialPublicationAdminController } from '@/modules/institutional-voting/controllers/official-publication-admin.controller';

describe('OfficialPublicationAdminController', () => {
  let api: any;
  let controller: OfficialPublicationAdminController;
  const requester = { sub: 'admin-1' };

  beforeEach(() => {
    api = {
      createAdminRequest: jest.fn().mockResolvedValue({ request: { requestId: 'r1' } }),
      getActiveAdminRequest: jest.fn().mockResolvedValue({ request: null }),
      getAdminRequest: jest.fn().mockResolvedValue({ request: { requestId: 'r1' } }),
      cancelAdminRequest: jest.fn().mockResolvedValue({ request: { status: 'CANCELLED' } }),
      confirmOfficialPublication: jest.fn(),
      publishEvent: jest.fn(),
    };
    controller = new OfficialPublicationAdminController(api);
  });

  it('crea solicitud usando solo eventId y el servicio nuevo de preparacion', async () => {
    await controller.createOrGetRequest('event-1', { user: requester } as any);

    expect(api.createAdminRequest).toHaveBeenCalledWith('event-1', requester);
    expect(api.confirmOfficialPublication).not.toHaveBeenCalled();
    expect(api.publishEvent).not.toHaveBeenCalled();
  });

  it('consulta activa y por requestId sin exponer endpoints de chain confirmed', async () => {
    await controller.getActiveRequest('event-1', { user: requester } as any);
    await controller.getRequest('request-1', { user: requester } as any);

    expect(api.getActiveAdminRequest).toHaveBeenCalledWith('event-1', requester);
    expect(api.getAdminRequest).toHaveBeenCalledWith('request-1', requester);
    expect((controller as any).markChainConfirmed).toBeUndefined();
    expect((controller as any).markCompleted).toBeUndefined();
  });

  it('cancela mediante accion especifica sin recibir status arbitrario', async () => {
    await controller.cancelRequest(
      'request-1',
      { reasonCode: 'USER_CANCELLED', status: 'CHAIN_CONFIRMED' } as any,
      { user: requester } as any,
    );

    expect(api.cancelAdminRequest).toHaveBeenCalledWith(
      'request-1',
      requester,
      expect.objectContaining({ reasonCode: 'USER_CANCELLED' }),
    );
  });
});
