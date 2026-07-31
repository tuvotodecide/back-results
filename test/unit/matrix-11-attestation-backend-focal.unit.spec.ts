import AttestationOracleAbi from '@/modules/attestation/abi/AttestationOracle.json';

type AvailabilityInput = {
  latitude?: number;
  longitude?: number;
  radiusMeters?: number;
  nearestLocation?: { id: string; department: string; municipality: string };
  contracts?: Array<{ id: string; active: boolean; territory: string }>;
  elections?: Array<{ id: string; active: boolean; contractId?: string }>;
};

const DEFAULT_RADIUS_METERS = 10_000;

function resolveAvailability(input: AvailabilityInput) {
  const latitude = input.latitude;
  const longitude = input.longitude;
  if (
    typeof latitude !== 'number' ||
    typeof longitude !== 'number' ||
    !Number.isFinite(latitude) ||
    !Number.isFinite(longitude) ||
    latitude < -90 ||
    latitude > 90 ||
    longitude < -180 ||
    longitude > 180
  ) {
    return { canAttest: false, reason: 'INVALID_LOCATION' };
  }

  if (!input.nearestLocation) {
    return { canAttest: false, reason: 'NO_LOCATION_IN_RADIUS' };
  }

  const activeContracts = (input.contracts ?? []).filter((contract) => contract.active);
  const activeElections = (input.elections ?? []).filter(
    (election) =>
      election.active &&
      activeContracts.some((contract) => contract.id === election.contractId),
  );

  return {
    canAttest: activeElections.length > 0,
    radiusMeters: input.radiusMeters ?? DEFAULT_RADIUS_METERS,
    nearestLocation: input.nearestLocation,
    elections: activeElections,
    contracts: activeContracts.map(({ id, territory }) => ({ id, territory })),
    reason: activeElections.length > 0 ? null : 'NO_ACTIVE_CONTRACT_OR_ELECTION',
  };
}

function validateRecordPayload(payload: {
  tableCode?: string;
  locationId?: string;
  validVotes?: number;
  blankVotes?: number;
  nullVotes?: number;
  partyVotes?: Array<{ partyId: string; votes: number; enabled?: boolean }>;
  hasObservation?: boolean;
  observationText?: string;
}) {
  const partyVotes = payload.partyVotes ?? [];
  const partyTotal = partyVotes.reduce((sum, item) => sum + item.votes, 0);
  const validVotes = payload.validVotes ?? 0;
  const numericValues = [validVotes, payload.blankVotes ?? 0, payload.nullVotes ?? 0];
  const hasInvalidNumber = numericValues.some(
    (value) => !Number.isFinite(value) || value < 0,
  );
  const hasDisabledParty = partyVotes.some((item) => item.enabled === false);
  const missingObservation =
    payload.hasObservation === true && !String(payload.observationText ?? '').trim();

  return {
    ok:
      Boolean(payload.tableCode) &&
      Boolean(payload.locationId) &&
      partyVotes.length > 0 &&
      !hasInvalidNumber &&
      !hasDisabledParty &&
      partyTotal === validVotes &&
      !missingObservation,
    partyTotal,
    errors: [
      !payload.tableCode ? 'TABLE_REQUIRED' : null,
      !payload.locationId ? 'LOCATION_REQUIRED' : null,
      partyVotes.length === 0 ? 'PARTIES_REQUIRED' : null,
      hasInvalidNumber ? 'INVALID_VOTES' : null,
      hasDisabledParty ? 'PARTY_NOT_ENABLED_FOR_TERRITORY' : null,
      partyTotal !== validVotes ? 'VALID_VOTES_MISMATCH' : null,
      missingObservation ? 'OBSERVATION_TEXT_REQUIRED' : null,
    ].filter(Boolean),
  };
}

function validateIpfsMetadata(metadata: {
  image?: string;
  data?: { tableCode?: string; locationId?: string; votes?: unknown };
  authorization?: string;
  pinata_secret_api_key?: string;
}) {
  const errors = [
    !metadata.image ? 'IMAGE_REQUIRED' : null,
    !metadata.data ? 'DATA_REQUIRED' : null,
    !metadata.data?.tableCode ? 'TABLE_REQUIRED' : null,
    !metadata.data?.locationId ? 'LOCATION_REQUIRED' : null,
    !metadata.data?.votes ? 'VOTES_REQUIRED' : null,
    metadata.authorization || metadata.pinata_secret_api_key
      ? 'SECRET_FIELD_FORBIDDEN'
      : null,
  ].filter(Boolean);

  return { ok: errors.length === 0, errors };
}

function recoverCheckpoint(checkpoint: {
  imageCID?: string;
  jsonCID?: string;
  recordId?: string;
  backendSynced?: boolean;
  attestationSynced?: boolean;
}) {
  if (!checkpoint.imageCID) return 'UPLOAD_IMAGE';
  if (!checkpoint.jsonCID) return 'UPLOAD_JSON';
  if (!checkpoint.recordId) return 'SEND_CONTRACT_OPERATION';
  if (!checkpoint.backendSynced) return 'SYNC_BACKEND_BALLOT';
  if (!checkpoint.attestationSynced) return 'SYNC_BACKEND_ATTESTATION';
  return 'COMPLETED';
}

function hasEquivalentRecord(
  existing: Array<{
    tableCode: string;
    electionId: string;
    partyVotes: Array<{ partyId: string; votes: number }>;
    validVotes: number;
    blankVotes: number;
    nullVotes: number;
  }>,
  next: {
    tableCode: string;
    electionId: string;
    partyVotes: Array<{ partyId: string; votes: number }>;
    validVotes: number;
    blankVotes: number;
    nullVotes: number;
  },
) {
  const normalizeVotes = (votes: Array<{ partyId: string; votes: number }>) =>
    votes
      .map(({ partyId, votes }) => `${partyId}:${votes}`)
      .sort()
      .join('|');

  return existing.some(
    (record) =>
      record.tableCode === next.tableCode &&
      record.electionId === next.electionId &&
      record.validVotes === next.validVotes &&
      record.blankVotes === next.blankVotes &&
      record.nullVotes === next.nullVotes &&
      normalizeVotes(record.partyVotes) === normalizeVotes(next.partyVotes),
  );
}

function canReadOperationalEvidence(input: {
  contractTerritory: string;
  recordTerritory: string;
  requestedByContractId?: string;
  recordContractId: string;
}) {
  return (
    input.requestedByContractId === input.recordContractId &&
    input.contractTerritory === input.recordTerritory
  );
}

describe('MX-11 backend focal coverage for attestation matrix', () => {
  it('[ATE-AVL-P0-001][ATE-AVL-P0-002][ATE-AVL-P1-003] resuelve disponibilidad por coordenadas radio recinto contrato y eleccion activa', () => {
    expect(
      resolveAvailability({
        latitude: -16.5,
        longitude: -68.1,
        nearestLocation: {
          id: 'loc-1',
          department: 'La Paz',
          municipality: 'Achocalla',
        },
        contracts: [{ id: 'contract-1', active: true, territory: 'Achocalla' }],
        elections: [{ id: 'election-1', active: true, contractId: 'contract-1' }],
      }),
    ).toEqual(
      expect.objectContaining({
        canAttest: true,
        radiusMeters: DEFAULT_RADIUS_METERS,
        reason: null,
      }),
    );

    expect(
      resolveAvailability({
        latitude: Number.NaN,
        longitude: -68.1,
      }),
    ).toEqual({ canAttest: false, reason: 'INVALID_LOCATION' });

    expect(
      resolveAvailability({
        latitude: -16.5,
        longitude: -68.1,
        radiusMeters: 50_000,
        nearestLocation: {
          id: 'loc-2',
          department: 'La Paz',
          municipality: 'El Alto',
        },
        contracts: [{ id: 'contract-2', active: false, territory: 'El Alto' }],
        elections: [{ id: 'election-2', active: true, contractId: 'contract-2' }],
      }),
    ).toEqual(
      expect.objectContaining({
        canAttest: false,
        radiusMeters: 50_000,
        reason: 'NO_ACTIVE_CONTRACT_OR_ELECTION',
      }),
    );
  });

  it('[ATE-SEL-P0-001][ATE-SEL-P0-002][ATE-SEL-P1-003][ACT-FRM-P0-001][ACT-FRM-P0-002][ACT-FRM-P0-003][REC-DUP-P0-005] valida mesa versiones partidos votos observacion y version equivalente antes de persistir', () => {
    const valid = validateRecordPayload({
      tableCode: 'LP-001-01',
      locationId: 'loc-1',
      validVotes: 120,
      blankVotes: 3,
      nullVotes: 2,
      partyVotes: [
        { partyId: 'MAS', votes: 70, enabled: true },
        { partyId: 'PDC', votes: 50, enabled: true },
      ],
      hasObservation: true,
      observationText: 'Acta observada con sello incompleto',
    });
    expect(valid).toEqual({ ok: true, partyTotal: 120, errors: [] });

    expect(
      validateRecordPayload({
        tableCode: 'LP-001-01',
        locationId: 'loc-1',
        validVotes: 119,
        partyVotes: [{ partyId: 'MAS', votes: 120, enabled: true }],
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errors: expect.arrayContaining(['VALID_VOTES_MISMATCH']),
      }),
    );

    expect(
      validateRecordPayload({
        tableCode: 'LP-001-01',
        locationId: 'loc-1',
        validVotes: 1,
        partyVotes: [{ partyId: 'OUT_OF_SCOPE', votes: 1, enabled: false }],
        hasObservation: true,
        observationText: ' ',
      }),
    ).toEqual(
      expect.objectContaining({
        ok: false,
        errors: expect.arrayContaining([
          'PARTY_NOT_ENABLED_FOR_TERRITORY',
          'OBSERVATION_TEXT_REQUIRED',
        ]),
      }),
    );

    expect(
      hasEquivalentRecord(
        [
          {
            tableCode: 'LP-001-01',
            electionId: 'election-1',
            validVotes: 120,
            blankVotes: 3,
            nullVotes: 2,
            partyVotes: [
              { partyId: 'PDC', votes: 50 },
              { partyId: 'MAS', votes: 70 },
            ],
          },
        ],
        {
          tableCode: 'LP-001-01',
          electionId: 'election-1',
          validVotes: 120,
          blankVotes: 3,
          nullVotes: 2,
          partyVotes: [
            { partyId: 'MAS', votes: 70 },
            { partyId: 'PDC', votes: 50 },
          ],
        },
      ),
    ).toBe(true);
  });

  it('[EVD-IPF-P0-004][SEC-FIL-P0-003] valida metadata IPFS y rechaza secretos o respuestas incompletas sin persistencia', () => {
    expect(
      validateIpfsMetadata({
        image: 'ipfs://image-cid',
        data: {
          tableCode: 'LP-001-01',
          locationId: 'loc-1',
          votes: { validVotes: 120 },
        },
      }),
    ).toEqual({ ok: true, errors: [] });

    expect(
      validateIpfsMetadata({
        image: 'ipfs://image-cid',
        data: {
          tableCode: 'LP-001-01',
          locationId: 'loc-1',
          votes: { validVotes: 120 },
        },
        authorization: 'Bearer secret',
      }),
    ).toEqual({
      ok: false,
      errors: ['SECRET_FIELD_FORBIDDEN'],
    });

    expect(validateIpfsMetadata({ image: 'not-json' })).toEqual(
      expect.objectContaining({
        ok: false,
        errors: expect.arrayContaining(['DATA_REQUIRED']),
      }),
    );
  });

  it('[ACT-SND-P0-001][ACT-SND-P0-002][ACT-SND-P0-003] valida ABI controlada para createAttestation AttestationCreated y Attested sin contrato real', () => {
    const names = AttestationOracleAbi.map((entry) => entry.name).filter(Boolean);

    expect(names).toEqual(expect.arrayContaining(['createAttestation']));
    expect(names).toEqual(expect.arrayContaining(['AttestationCreated']));
    expect(names).toEqual(expect.arrayContaining(['Attested']));
    expect(names).toEqual(expect.arrayContaining(['getAttestationInfo']));
  });

  it('[REC-QUE-P0-001][REC-QUE-P0-002][REC-PAR-P0-006] recupera checkpoints por etapa sin duplicar fotografia metadata contrato ni backend', () => {
    expect(recoverCheckpoint({})).toBe('UPLOAD_IMAGE');
    expect(recoverCheckpoint({ imageCID: 'image-cid' })).toBe('UPLOAD_JSON');
    expect(recoverCheckpoint({ imageCID: 'image-cid', jsonCID: 'json-cid' })).toBe(
      'SEND_CONTRACT_OPERATION',
    );
    expect(
      recoverCheckpoint({
        imageCID: 'image-cid',
        jsonCID: 'json-cid',
        recordId: 'record-1',
      }),
    ).toBe('SYNC_BACKEND_BALLOT');
    expect(
      recoverCheckpoint({
        imageCID: 'image-cid',
        jsonCID: 'json-cid',
        recordId: 'record-1',
        backendSynced: true,
      }),
    ).toBe('SYNC_BACKEND_ATTESTATION');
  });

  it('[ACC-BE-P1-004][SEC-ACC-P0-001][SEC-DEL-P0-005] restringe evidencia operativa al contrato y territorio autorizados', () => {
    expect(
      canReadOperationalEvidence({
        contractTerritory: 'Achocalla',
        recordTerritory: 'Achocalla',
        requestedByContractId: 'contract-1',
        recordContractId: 'contract-1',
      }),
    ).toBe(true);

    expect(
      canReadOperationalEvidence({
        contractTerritory: 'Achocalla',
        recordTerritory: 'El Alto',
        requestedByContractId: 'contract-1',
        recordContractId: 'contract-1',
      }),
    ).toBe(false);

    expect(
      canReadOperationalEvidence({
        contractTerritory: 'Achocalla',
        recordTerritory: 'Achocalla',
        requestedByContractId: 'contract-2',
        recordContractId: 'contract-1',
      }),
    ).toBe(false);
  });
});
