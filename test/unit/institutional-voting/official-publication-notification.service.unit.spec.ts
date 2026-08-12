import { Types } from 'mongoose';
import { OfficialPublicationNotificationService } from '@/modules/institutional-voting/services/publication/official-publication-notification.service';

describe('OfficialPublicationNotificationService', () => {
  const eventId = new Types.ObjectId();
  const tenantId = new Types.ObjectId();
  const signerUserId = new Types.ObjectId();
  const assignmentId = new Types.ObjectId();
  const mobileUserId = new Types.ObjectId();
  const request: any = {
    requestId: 'request-1',
    status: 'PENDING_APPROVAL',
    eventId,
    tenantId,
    signerUserId,
    assignmentId,
    institutionId: 'institution-1',
    smartAccountAddress: '0xabc0000000000000000000000000000000000000',
  };
  const event: any = {
    _id: eventId,
    name: 'Eleccion oficial',
    publishDeadline: new Date('2099-01-01T06:00:00.000Z'),
    votingStart: new Date('2099-01-01T12:00:00.000Z'),
    votingEnd: new Date('2099-01-01T18:00:00.000Z'),
    resultsPublishAt: new Date('2099-01-01T20:00:00.000Z'),
  };

  let fb: any;
  let sendMock: jest.Mock;
  let models: any;
  let service: OfficialPublicationNotificationService;

  beforeEach(() => {
    sendMock = jest.fn().mockResolvedValue('fcm-message-1');
    fb = {
      messaging: jest.fn(() => ({
        send: sendMock,
      })),
    };
    models = {
      outbox: {
        findOneAndUpdate: jest.fn().mockResolvedValue({
          _id: new Types.ObjectId(),
          notificationId: 'opub_request-1',
          deduplicationKey: `OFFICIAL_PUBLICATION_REQUEST:request-1:${signerUserId}`,
          requestId: 'request-1',
          eventId,
          recipientTopic: `user_${mobileUserId}`,
          title: 'Confirmacion de publicacion',
          body: 'body',
          data: { type: 'OFFICIAL_PUBLICATION_REQUEST' },
          attemptCount: 1,
        }),
        find: jest.fn(() => ({
          sort: jest.fn(() => ({
            limit: jest.fn(() => ({
              lean: jest.fn().mockResolvedValue([]),
            })),
          })),
        })),
        updateOne: jest.fn().mockResolvedValue({ modifiedCount: 1 }),
        updateMany: jest.fn().mockResolvedValue({ modifiedCount: 0 }),
      },
      event: {
        findById: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue(event),
        })),
      },
      application: { findById: jest.fn() },
      invitation: {
        findById: jest.fn(),
        find: jest.fn(() => ({
          sort: jest.fn(() => ({
            limit: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
          })),
        })),
      },
      tenant: { findById: jest.fn() },
      roledUser: {
        findOne: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue({
            _id: signerUserId,
            dni: ' 123-456 ',
          }),
        })),
      },
      assignment: {
        findOne: jest.fn(() => ({
          lean: jest.fn().mockResolvedValue({
            _id: assignmentId,
            accountAddressNormalized: request.smartAccountAddress,
          }),
        })),
      },
      user: {
        findOne: jest.fn().mockResolvedValue({
          _id: mobileUserId,
          dni: '123456',
        }),
      },
      userNotification: {
        exists: jest.fn().mockResolvedValue(null),
        create: jest.fn().mockResolvedValue({}),
      },
      notificationLog: {
        exists: jest.fn().mockResolvedValue(null),
        findOneAndUpdate: jest.fn().mockResolvedValue({}),
      },
    };

    service = new OfficialPublicationNotificationService(
      fb,
      models.outbox,
      models.event,
      models.application,
      models.invitation,
      models.tenant,
      models.roledUser,
      models.assignment,
      models.user,
      models.userNotification,
      models.notificationLog,
    );
  });

  it('resuelve el signer y crea historial/outbox sin exponer carnet en payload FCM', async () => {
    const result = await service.enqueueForRequest(request);

    expect(result.enqueued).toBe(true);
    expect(models.roledUser.findOne).toHaveBeenCalledWith(
      { _id: signerUserId, active: true },
      { dni: 1, name: 1 },
    );
    expect(models.assignment.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: signerUserId,
        accountAddressNormalized: request.smartAccountAddress,
      }),
    );
    expect(models.user.findOne).toHaveBeenCalledWith({
      dni: '123456',
      active: { $ne: false },
    });
    expect(models.userNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: mobileUserId,
        dni: '123456',
        topic: `user_${mobileUserId}`,
        data: expect.objectContaining({
          type: 'OFFICIAL_PUBLICATION_REQUEST',
          requestId: 'request-1',
          route: 'OfficialPublicationRequest',
        }),
      }),
    );
    const data = models.userNotification.create.mock.calls[0][0].data;
    expect(data).not.toHaveProperty('dni');
    expect(data).not.toHaveProperty('carnet');
    expect(data).not.toHaveProperty('callData');
    expect(data).not.toHaveProperty('callDataHash');
    expect(data).not.toHaveProperty('smartAccountAddress');
    expect(data).not.toHaveProperty('institutionId');
  });

  it('usa el canal personal del signer aunque el requester sea otro administrador', async () => {
    const requesterA = new Types.ObjectId();

    await service.enqueueForRequest({
      ...request,
      requestedByUserId: requesterA,
      signerUserId,
    });

    expect(models.userNotification.create).toHaveBeenCalledWith(
      expect.objectContaining({
        userId: mobileUserId,
        topic: `user_${mobileUserId}`,
        data: expect.objectContaining({
          deduplicationKey: `OFFICIAL_PUBLICATION_REQUEST:request-1:${signerUserId}`,
        }),
      }),
    );
    expect(models.userNotification.create).not.toHaveBeenCalledWith(
      expect.objectContaining({
        userId: requesterA,
      }),
    );
  });

  it('no fabrica usuario movil ni envia FCM cuando el DNI del signer no esta registrado', async () => {
    models.user.findOne.mockResolvedValueOnce(null);

    const result = await service.enqueueForRequest(request);

    expect(result).toEqual({
      enqueued: false,
      skipped: 'mobile_user_not_found',
    });
    expect(models.userNotification.create).not.toHaveBeenCalled();
    expect(models.outbox.findOneAndUpdate).not.toHaveBeenCalled();
    expect(sendMock).not.toHaveBeenCalled();
  });

  it('recupera una autorización institucional cuando el usuario móvil aparece después, sin duplicar el outbox', async () => {
    const applicationId = new Types.ObjectId();
    const application = {
      _id: applicationId,
      tenantId,
      status: 'PENDING_MOBILE_AUTHORIZATION',
      mobileAuthorizationAction: 'ADD_AUTHORIZED_ADDRESS',
    };
    models.application.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(application) });
    models.tenant.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: tenantId, name: 'Tenant' }) });
    models.assignment.findOne.mockReturnValue({ lean: jest.fn().mockResolvedValue({
      _id: assignmentId,
      userId: signerUserId,
      accountAddress: request.smartAccountAddress,
    }) });
    models.user.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ _id: mobileUserId, dni: '123456' });

    await expect(service.enqueueForInstitutionalAuthorization(String(applicationId))).resolves.toEqual({
      enqueued: false,
      skipped: 'mobile_user_not_found',
    });
    await expect(service.enqueueForInstitutionalAuthorization(String(applicationId))).resolves.toMatchObject({
      enqueued: true,
      deduplicationKey: `MOBILE_AUTHORIZATION_REQUESTED:${applicationId}:${signerUserId}`,
    });
    await expect(service.enqueueForInstitutionalAuthorization(String(applicationId))).resolves.toMatchObject({
      enqueued: true,
      deduplicationKey: `MOBILE_AUTHORIZATION_REQUESTED:${applicationId}:${signerUserId}`,
    });

    expect(models.outbox.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(models.outbox.findOneAndUpdate.mock.calls[0][0]).toEqual(
      models.outbox.findOneAndUpdate.mock.calls[1][0],
    );
  });

  it('crea una entrega de invitación sin token y la dirige al usuario móvil invitado', async () => {
    const invitationId = new Types.ObjectId();
    models.invitation.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({
      _id: invitationId,
      tenantId,
      dni: '123456',
      accountAddress: request.smartAccountAddress,
      status: 'PENDING',
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    }) });
    models.tenant.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: tenantId, name: 'Tenant' }) });

    const result = await service.enqueueForInstitutionalInvitation(String(invitationId));

    expect(result).toMatchObject({
      enqueued: true,
      deduplicationKey: `INSTITUTIONAL_ADMIN_INVITATION:${invitationId}:${mobileUserId}`,
    });
    expect(models.outbox.findOneAndUpdate).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        $setOnInsert: expect.objectContaining({
          recipientTopic: `user_${mobileUserId}`,
          type: 'INSTITUTIONAL_ADMIN_INVITATION',
          data: expect.objectContaining({ invitationId: String(invitationId) }),
        }),
      }),
      expect.anything(),
    );
    const data = models.outbox.findOneAndUpdate.mock.calls.at(-1)[1].$setOnInsert.data;
    expect(data).not.toHaveProperty('token');
    expect(data).not.toHaveProperty('invitationToken');
  });

  it('crea una nueva generación de entrega al reenviar una invitación ya enviada', async () => {
    const invitationId = new Types.ObjectId();
    models.invitation.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({
      _id: invitationId,
      tenantId,
      dni: '123456',
      accountAddress: request.smartAccountAddress,
      status: 'PENDING',
      noticeCount: 2,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    }) });
    models.tenant.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: tenantId, name: 'Tenant' }) });

    await expect(service.enqueueForInstitutionalInvitation(String(invitationId), {
      deliveryAttempt: 2,
    })).resolves.toMatchObject({
      enqueued: true,
      notificationId: `iinvite_${invitationId}_2`,
      deduplicationKey: `INSTITUTIONAL_ADMIN_INVITATION:${invitationId}:${mobileUserId}:delivery:2`,
    });

    const inserted = models.outbox.findOneAndUpdate.mock.calls.at(-1)[1].$setOnInsert;
    expect(inserted).toMatchObject({
      invitationId,
      tenantId,
      recipientMobileUserId: mobileUserId,
      deliveryAttempt: 2,
      data: expect.objectContaining({ invitationId: String(invitationId), deliveryAttempt: '2' }),
    });
  });

  it('recupera la invitación original cuando aparece la identidad móvil, sin requerir cuenta administrativa', async () => {
    const invitationId = new Types.ObjectId();
    const invitation = {
      _id: invitationId,
      tenantId,
      dni: '123456',
      accountAddress: request.smartAccountAddress,
      status: 'PENDING',
      noticeCount: 1,
      expiresAt: new Date('2099-01-01T00:00:00.000Z'),
    };
    models.invitation.find.mockReturnValue({
      sort: jest.fn(() => ({
        limit: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([invitation]) })),
      })),
    });
    models.invitation.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue(invitation) });
    models.tenant.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({ _id: tenantId, name: 'Tenant' }) });
    models.user.findOne
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ _id: mobileUserId, dni: '123456' });

    await expect(service.reconcilePendingInstitutionalInvitationDeliveries()).resolves.toEqual([
      expect.objectContaining({ invitationId: String(invitationId), enqueued: false, skipped: 'invited_mobile_identity_not_found' }),
    ]);
    await expect(service.reconcilePendingInstitutionalInvitationDeliveries()).resolves.toEqual([
      expect.objectContaining({ invitationId: String(invitationId), enqueued: true }),
    ]);
    await expect(service.reconcilePendingInstitutionalInvitationDeliveries()).resolves.toEqual([
      expect.objectContaining({ invitationId: String(invitationId), enqueued: true }),
    ]);

    expect(models.outbox.findOneAndUpdate).toHaveBeenCalledTimes(2);
    expect(models.outbox.findOneAndUpdate.mock.calls[0][0]).toEqual(
      models.outbox.findOneAndUpdate.mock.calls[1][0],
    );
  });

  it('no reconsidera invitaciones accepted, rejected o vencidas para entrega tardía', async () => {
    models.invitation.find.mockReturnValue({
      sort: jest.fn(() => ({
        limit: jest.fn(() => ({ lean: jest.fn().mockResolvedValue([]) })),
      })),
    });

    await expect(service.reconcilePendingInstitutionalInvitationDeliveries(4)).resolves.toEqual([]);
    expect(models.invitation.find).toHaveBeenCalledWith({
      status: 'PENDING',
      expiresAt: { $gt: expect.any(Date) },
    });
    expect(models.outbox.findOneAndUpdate).not.toHaveBeenCalled();
  });

  it('procesa el outbox enviando FCM al topic personal y registra log SENT', async () => {
    const item: any = {
      _id: new Types.ObjectId(),
      notificationId: 'opub_request-1',
      deduplicationKey: `OFFICIAL_PUBLICATION_REQUEST:request-1:${signerUserId}`,
      requestId: 'request-1',
      eventId,
      recipientTopic: `user_${mobileUserId}`,
      title: 'Confirmacion de publicacion',
      body: 'Tienes que confirmar la publicacion oficial de "Eleccion oficial".',
      data: {
        type: 'OFFICIAL_PUBLICATION_REQUEST',
        requestId: 'request-1',
      },
      attemptCount: 1,
      nextAttemptAt: new Date(),
    };
    models.outbox.findOneAndUpdate.mockResolvedValueOnce(item);

    const result = await service.processOne('opub_request-1');

    expect(result).toMatchObject({ processed: true, status: 'SENT' });
    expect(sendMock).toHaveBeenCalledWith(
      expect.objectContaining({
        topic: `user_${mobileUserId}`,
        data: expect.objectContaining({
          type: 'OFFICIAL_PUBLICATION_REQUEST',
          requestId: 'request-1',
        }),
      }),
    );
    expect(models.notificationLog.findOneAndUpdate).toHaveBeenLastCalledWith(
      { 'data.deduplicationKey': item.deduplicationKey },
      expect.objectContaining({
        $set: expect.objectContaining({
          status: 'SENT',
          topic: `user_${mobileUserId}`,
        }),
      }),
      expect.objectContaining({ upsert: true }),
    );
  });

  it('no marca una invitación SENT cuando Firebase falla', async () => {
    const invitationId = new Types.ObjectId();
    const item: any = {
      _id: new Types.ObjectId(),
      notificationId: `iinvite_${invitationId}`,
      deduplicationKey: `INSTITUTIONAL_ADMIN_INVITATION:${invitationId}:${mobileUserId}`,
      invitationId,
      recipientMobileUserId: mobileUserId,
      recipientTopic: `user_${mobileUserId}`,
      type: 'INSTITUTIONAL_ADMIN_INVITATION',
      title: 'Invitación institucional',
      body: 'Body',
      data: { type: 'INSTITUTIONAL_ADMIN_INVITATION', invitationId: String(invitationId) },
      attemptCount: 1,
      nextAttemptAt: new Date(),
    };
    models.outbox.findOneAndUpdate.mockResolvedValueOnce(item);
    models.invitation.findById.mockReturnValue({ lean: jest.fn().mockResolvedValue({
      _id: invitationId, dni: '123456', status: 'PENDING', expiresAt: new Date('2099-01-01'),
    }) });
    sendMock.mockRejectedValueOnce(new Error('fcm unavailable'));

    await expect(service.processOne(item.notificationId)).resolves.toMatchObject({
      processed: true,
      status: 'FAILED_RETRYABLE',
    });
    expect(models.outbox.updateOne).toHaveBeenCalledWith(
      { _id: item._id },
      expect.objectContaining({ $set: expect.objectContaining({ status: 'FAILED_RETRYABLE' }) }),
    );
  });

  it('no reenvia FCM si ya existe log SENT para la misma deduplicacion', async () => {
    const item: any = {
      _id: new Types.ObjectId(),
      notificationId: 'opub_request-1',
      deduplicationKey: `OFFICIAL_PUBLICATION_REQUEST:request-1:${signerUserId}`,
      requestId: 'request-1',
      eventId,
      recipientTopic: `user_${mobileUserId}`,
      title: 'Confirmacion de publicacion',
      body: 'Body',
      data: {
        type: 'OFFICIAL_PUBLICATION_REQUEST',
        requestId: 'request-1',
      },
      attemptCount: 1,
      nextAttemptAt: new Date(),
    };
    models.outbox.findOneAndUpdate.mockResolvedValueOnce(item);
    models.notificationLog.exists.mockResolvedValueOnce({ _id: new Types.ObjectId() });

    const result = await service.processOne('opub_request-1');

    expect(result).toMatchObject({
      processed: true,
      status: 'SENT',
      skipped: 'already_sent',
    });
    expect(sendMock).not.toHaveBeenCalled();
  });
});
