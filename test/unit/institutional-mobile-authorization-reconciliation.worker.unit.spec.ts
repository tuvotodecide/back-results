import { InstitutionalMobileAuthorizationReconciliationWorker } from '@/modules/institutional-admin-applications/services/institutional-mobile-authorization-reconciliation.worker';

describe('InstitutionalMobileAuthorizationReconciliationWorker', () => {
  const config = { get: jest.fn((key: string) =>
    key === 'app.institutionalAuthorization.reconciliationEnabled' ? 'true' : undefined,
  ) };

  it('reclama sólo solicitudes con userOpHash y deja la exclusión multi-instancia al claim atómico', async () => {
    const applications = {
      findMobileAuthorizationDeliveryRetryBatch: jest.fn().mockResolvedValue([
        { _id: 'delivery-1' },
      ]),
      findMobileAuthorizationReconciliationBatch: jest.fn().mockResolvedValue([
        { _id: 'application-1', mobileAuthorizationUserOpHash: `0x${'a'.repeat(64)}` },
      ]),
      retryMobileAuthorizationDelivery: jest.fn().mockResolvedValue({ processed: true, enqueued: true }),
      processMobileAuthorizationRetry: jest.fn().mockResolvedValue({ processed: true, status: 'PENDING' }),
      recoverFailedMobileAuthorization: jest.fn().mockResolvedValue({ recovered: false }),
    };
    const notificationService = {
      reconcilePendingInstitutionalInvitationDeliveries: jest.fn().mockResolvedValue([]),
      processDueOutbox: jest.fn().mockResolvedValue([]),
    };
    const worker = new InstitutionalMobileAuthorizationReconciliationWorker(applications as any, notificationService as any, config as any);

    await expect(worker.runOnce({ force: true })).resolves.toEqual({ processed: 2 });
    expect(applications.findMobileAuthorizationDeliveryRetryBatch).toHaveBeenCalledWith(10);
    expect(applications.retryMobileAuthorizationDelivery).toHaveBeenCalledWith('delivery-1');
    expect(applications.findMobileAuthorizationReconciliationBatch).toHaveBeenCalledWith(10);
    expect(applications.processMobileAuthorizationRetry).toHaveBeenCalledWith('application-1');
    expect(applications.recoverFailedMobileAuthorization).not.toHaveBeenCalled();
    expect(notificationService.reconcilePendingInstitutionalInvitationDeliveries).toHaveBeenCalledWith(10);
  });

  it('no cuenta una solicitud que otro worker ya reclamó', async () => {
    const applications = {
      findMobileAuthorizationDeliveryRetryBatch: jest.fn().mockResolvedValue([{ _id: 'delivery-1' }]),
      findMobileAuthorizationReconciliationBatch: jest.fn().mockResolvedValue([{ _id: 'application-1' }]),
      retryMobileAuthorizationDelivery: jest.fn().mockResolvedValue({ processed: false, reason: 'NO_CLAIMABLE_DELIVERY' }),
      processMobileAuthorizationRetry: jest.fn().mockResolvedValue({ processed: false, reason: 'NO_CLAIMABLE_OPERATION' }),
      recoverFailedMobileAuthorization: jest.fn().mockResolvedValue({ recovered: false }),
    };
    const notificationService = {
      reconcilePendingInstitutionalInvitationDeliveries: jest.fn().mockResolvedValue([]),
      processDueOutbox: jest.fn().mockResolvedValue([]),
    };
    const worker = new InstitutionalMobileAuthorizationReconciliationWorker(applications as any, notificationService as any, config as any);

    await expect(worker.runOnce({ force: true })).resolves.toEqual({ processed: 0 });
  });

  it('reabre una firma sólo cuando la verificación marca el fallo anterior como reemitible', async () => {
    const applications = {
      findMobileAuthorizationDeliveryRetryBatch: jest.fn().mockResolvedValue([]),
      findMobileAuthorizationReconciliationBatch: jest.fn().mockResolvedValue([{ _id: 'application-1' }]),
      retryMobileAuthorizationDelivery: jest.fn(),
      processMobileAuthorizationRetry: jest.fn().mockResolvedValue({
        processed: true,
        status: 'FAILED',
        reissuable: true,
      }),
      recoverFailedMobileAuthorization: jest.fn().mockResolvedValue({ recovered: true }),
    };
    const notificationService = {
      reconcilePendingInstitutionalInvitationDeliveries: jest.fn().mockResolvedValue([]),
      processDueOutbox: jest.fn().mockResolvedValue([]),
    };
    const worker = new InstitutionalMobileAuthorizationReconciliationWorker(applications as any, notificationService as any, config as any);

    await expect(worker.runOnce({ force: true })).resolves.toEqual({ processed: 1 });
    expect(applications.recoverFailedMobileAuthorization).toHaveBeenCalledWith('application-1');
  });
});
