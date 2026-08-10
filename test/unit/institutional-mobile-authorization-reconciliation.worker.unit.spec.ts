import { InstitutionalMobileAuthorizationReconciliationWorker } from '@/modules/institutional-admin-applications/services/institutional-mobile-authorization-reconciliation.worker';

describe('InstitutionalMobileAuthorizationReconciliationWorker', () => {
  const config = { get: jest.fn((key: string) =>
    key === 'app.institutionalAuthorization.reconciliationEnabled' ? 'true' : undefined,
  ) };

  it('reclama sólo solicitudes con userOpHash y deja la exclusión multi-instancia al claim atómico', async () => {
    const applications = {
      findMobileAuthorizationReconciliationBatch: jest.fn().mockResolvedValue([
        { _id: 'application-1', mobileAuthorizationUserOpHash: `0x${'a'.repeat(64)}` },
      ]),
      processMobileAuthorizationRetry: jest.fn().mockResolvedValue({ processed: true, status: 'PENDING' }),
    };
    const worker = new InstitutionalMobileAuthorizationReconciliationWorker(applications as any, config as any);

    await expect(worker.runOnce({ force: true })).resolves.toEqual({ processed: 1 });
    expect(applications.findMobileAuthorizationReconciliationBatch).toHaveBeenCalledWith(10);
    expect(applications.processMobileAuthorizationRetry).toHaveBeenCalledWith('application-1');
  });

  it('no cuenta una solicitud que otro worker ya reclamó', async () => {
    const applications = {
      findMobileAuthorizationReconciliationBatch: jest.fn().mockResolvedValue([{ _id: 'application-1' }]),
      processMobileAuthorizationRetry: jest.fn().mockResolvedValue({ processed: false, reason: 'NO_CLAIMABLE_OPERATION' }),
    };
    const worker = new InstitutionalMobileAuthorizationReconciliationWorker(applications as any, config as any);

    await expect(worker.runOnce({ force: true })).resolves.toEqual({ processed: 0 });
  });
});
