import { BadRequestException } from '@nestjs/common';
import { Types } from 'mongoose';
import { ClientReportsController } from '@/modules/contracts/controllers/client-reports.controller';

describe('ClientReportsController (unit)', () => {
  let clientReportsService: any;
  let contractsService: any;
  let controller: ClientReportsController;

  const userId = new Types.ObjectId().toString();
  const electionId = new Types.ObjectId().toString();
  const contractId = new Types.ObjectId().toString();
  const contract = {
    _id: new Types.ObjectId(contractId),
    electionId: new Types.ObjectId(electionId),
    clientRole: 'MAYOR',
    departmentId: null,
    departmentName: null,
    municipalityId: new Types.ObjectId(),
    municipalityName: 'Cochabamba',
    active: true,
    startDate: new Date('2026-01-01T00:00:00.000Z'),
    endDate: null,
  };

  beforeEach(() => {
    clientReportsService = {
      getDelegateActivityReport: jest.fn(),
      getExecutiveSummary: jest.fn(),
      getAuditMatchReport: jest.fn(),
    };
    contractsService = {
      getClientContract: jest.fn(),
      findActiveContracts: jest.fn(),
    };
    controller = new ClientReportsController(clientReportsService, contractsService);
  });

  it('delegate-activity usa req.contract para usuario territorial y contractId para SUPERADMIN', async () => {
    clientReportsService.getDelegateActivityReport.mockResolvedValueOnce({
      groupBy: 'table',
      data: [],
    });

    await expect(
      controller.getDelegateActivity(
        electionId,
        undefined as any,
        'table',
        { contract: { _id: new Types.ObjectId(contractId) } },
      ),
    ).resolves.toEqual({ groupBy: 'table', data: [] });

    expect(clientReportsService.getDelegateActivityReport).toHaveBeenCalledWith({
      contractId,
      electionId,
      groupBy: 'table',
    });

    await expect(
      controller.getDelegateActivity(
        electionId,
        undefined as any,
        'delegate',
        { user: { role: 'ADMIN' } },
      ),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('executive-summary y audit-match delegan filtros al servicio con shape actual', async () => {
    clientReportsService.getExecutiveSummary.mockResolvedValueOnce({
      summary: { totalAttestations: 0 },
    });
    await expect(
      controller.getExecutiveSummary(electionId, contractId, { user: { role: 'ADMIN' } }),
    ).resolves.toEqual({ summary: { totalAttestations: 0 } });
    expect(clientReportsService.getExecutiveSummary).toHaveBeenCalledWith({
      contractId,
      electionId,
    });

    clientReportsService.getAuditMatchReport.mockResolvedValueOnce({
      total: 0,
      details: [],
    });
    await expect(
      controller.getAuditMatch(
        electionId,
        contractId,
        'La Paz',
        undefined,
        'Achocalla',
        undefined,
        undefined,
        'LP-001',
        { user: { role: 'ADMIN' } },
      ),
    ).resolves.toEqual({ total: 0, details: [] });
    expect(clientReportsService.getAuditMatchReport).toHaveBeenCalledWith({
      contractId,
      electionId,
      department: 'La Paz',
      province: undefined,
      municipality: 'Achocalla',
      electoralSeat: undefined,
      electoralLocation: undefined,
      tableCode: 'LP-001',
    });
  });

  it('my-contract documenta usuario con contrato y usuario sin contrato', async () => {
    contractsService.getClientContract.mockResolvedValueOnce(contract);

    const withContract = await controller.getMyContract(electionId, {
      user: { sub: userId },
    });

    expect(withContract).toEqual(
      expect.objectContaining({
        hasContract: true,
        contract: expect.objectContaining({
          id: contractId,
          role: 'MAYOR',
          territory: expect.objectContaining({
            type: 'municipality',
            municipalityName: 'Cochabamba',
          }),
          active: true,
        }),
      }),
    );

    contractsService.getClientContract.mockResolvedValueOnce(null);
    await expect(
      controller.getMyContract(electionId, { user: { sub: userId } }),
    ).resolves.toEqual({
      hasContract: false,
      message: 'No tiene un contrato activo para esta elección',
    });
  });

  it('my-active-contract usa electionId opcional y documenta empty state', async () => {
    contractsService.getClientContract.mockResolvedValueOnce(contract);
    await expect(
      controller.getMyActiveContract(electionId, { user: { sub: userId } }),
    ).resolves.toEqual(
      expect.objectContaining({
        hasContract: true,
        contract: expect.objectContaining({
          id: contractId,
          electionId,
          role: 'MAYOR',
          active: true,
        }),
      }),
    );

    contractsService.findActiveContracts.mockResolvedValueOnce([]);
    await expect(
      controller.getMyActiveContract(undefined, { user: { sub: userId } }),
    ).resolves.toEqual({ hasContract: false, contract: null });
  });

  it('my-delegates documenta placeholder actual sin implementar lista real', async () => {
    const response = await controller.getMyDelegates(
      electionId,
      undefined as any,
      { contract: { _id: new Types.ObjectId(contractId) } },
    );

    expect(response).toEqual({
      message: 'Ver endpoint /api/v1/delegates/contract/:contractId',
      contractId,
    });
  });
});
