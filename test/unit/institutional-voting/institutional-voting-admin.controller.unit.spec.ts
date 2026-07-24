jest.mock('@/modules/institutional-voting/services/institutional-voting.service', () => ({
  InstitutionalVotingService: jest.fn(),
}));
jest.mock('@/modules/tvd/services/tvd-capacity.service', () => ({
  TvdCapacityService: jest.fn(),
}));

import { InstitutionalVotingAdminController } from '@/modules/institutional-voting/controllers/institutional-voting-admin.controller';

describe('InstitutionalVotingAdminController official publication', () => {
  let service: any;
  let controller: InstitutionalVotingAdminController;

  beforeEach(() => {
    service = {
      confirmOfficialPublication: jest.fn().mockResolvedValue({ ok: true }),
      publishEvent: jest.fn().mockResolvedValue({ ok: true }),
    };
    controller = new InstitutionalVotingAdminController(service, {} as any);
  });

  it('recibe solo eventId y deriva institutionId dentro del service para confirmar publicacion', async () => {
    const requester = { sub: 'admin-1' };

    await controller.confirmOfficialPublication(
      'event-1',
      {},
      { user: requester } as any,
    );

    expect(service.confirmOfficialPublication).toHaveBeenCalledWith(
      'event-1',
      {},
      requester,
    );
    expect(service.confirmOfficialPublication.mock.calls[0]).toHaveLength(3);
  });

  it('mantiene el alias publish con solo eventId y usuario autenticado', async () => {
    const requester = { sub: 'admin-1' };

    await controller.publishEvent('event-1', { user: requester } as any);

    expect(service.publishEvent).toHaveBeenCalledWith('event-1', requester);
    expect(service.publishEvent.mock.calls[0]).toHaveLength(2);
  });
});
