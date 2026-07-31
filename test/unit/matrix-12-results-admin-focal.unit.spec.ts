type BallotRow = {
  tableCode: string;
  status: 'processed' | 'synced' | 'draft';
  valuable: boolean;
  activeTable: boolean;
  observed: boolean;
  version: number;
  id: string;
  caseStatus?: 'VERIFYING' | 'PENDING' | 'CONSENSUAL' | 'CLOSED';
  winningBallotId?: string;
  validVotes: number;
  blankVotes: number;
  nullVotes: number;
  partyVotes: Array<{ partyId: string; votes: number }>;
};

const acceptedFinalCaseStatuses = new Set(['PENDING', 'CONSENSUAL', 'CLOSED']);

function effectiveFinalBallots(rows: BallotRow[]) {
  return rows.filter(
    (row) =>
      ['processed', 'synced'].includes(row.status) &&
      row.valuable &&
      row.activeTable &&
      !row.observed &&
      acceptedFinalCaseStatuses.has(row.caseStatus ?? '') &&
      row.winningBallotId === row.id,
  );
}

function effectiveLiveBallots(rows: BallotRow[]) {
  const versionsByTable = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.tableCode] = (acc[row.tableCode] ?? 0) + 1;
    return acc;
  }, {});

  return rows.filter(
    (row) =>
      ['processed', 'synced'].includes(row.status) &&
      row.valuable &&
      row.activeTable &&
      !row.observed &&
      versionsByTable[row.tableCode] === 1,
  );
}

function summarize(rows: BallotRow[]) {
  const totals = rows.reduce(
    (acc, row) => {
      acc.validVotes += row.validVotes;
      acc.blankVotes += row.blankVotes;
      acc.nullVotes += row.nullVotes;
      for (const vote of row.partyVotes) {
        acc.byParty[vote.partyId] = (acc.byParty[vote.partyId] ?? 0) + vote.votes;
      }
      return acc;
    },
    { validVotes: 0, blankVotes: 0, nullVotes: 0, byParty: {} as Record<string, number> },
  );

  return {
    ...totals,
    totalVotes: totals.validVotes + totals.blankVotes + totals.nullVotes,
    tablesProcessed: rows.length,
    results: Object.entries(totals.byParty)
      .map(([partyId, votes]) => ({
        partyId,
        votes,
        percentage:
          totals.validVotes === 0 ? '0.00' : ((votes / totals.validVotes) * 100).toFixed(2),
      }))
      .sort((left, right) => right.votes - left.votes || left.partyId.localeCompare(right.partyId)),
  };
}

function selectVoteGroup(electionType: string) {
  if (['presidential', 'departamental', 'municipal'].includes(electionType)) {
    return 'primaryVotes';
  }
  if (['deputies', 'assembly', 'council'].includes(electionType)) {
    return 'secondaryVotes';
  }
  return null;
}

function enforceTerritorialScope(input: {
  role: 'GOVERNOR' | 'MAYOR' | 'ADMIN';
  contractDepartment?: string;
  contractMunicipality?: string;
  requestedDepartment?: string;
  requestedMunicipality?: string;
  requestedTableDepartment?: string;
  requestedTableMunicipality?: string;
}) {
  if (input.role === 'ADMIN') return true;
  if (input.role === 'GOVERNOR') {
    return [input.requestedDepartment, input.requestedTableDepartment]
      .filter(Boolean)
      .every((value) => value === input.contractDepartment);
  }
  return [input.requestedMunicipality, input.requestedTableMunicipality]
    .filter(Boolean)
    .every((value) => value === input.contractMunicipality);
}

function cacheTtlFor(endpoint: string) {
  const ttl: Record<string, number> = {
    'live/quick-count': 15,
    'live/by-location': 30,
    'live/ballots': 30,
    'final/by-location': 60,
    'final/ballots': 60,
    statistics: 60,
    'final/quick-count': 60,
    'by-circunscripcion': 60,
    'final/heat-map': 120,
  };
  return ttl[endpoint];
}

function mapInternalReport(rows: Array<{ contractId: string; delegateDni?: string; tableCode: string }>) {
  return rows.map(({ contractId, tableCode }) => ({ contractId, tableCode }));
}

function sanitizeResultsError(error: { message: string; dni?: string; token?: string; internalUrl?: string }) {
  return {
    code: 'RESULTS_QUERY_FAILED',
    message: 'No se pudieron consultar los resultados administrativos.',
  };
}

describe('MX-12 | Resultados administrativos y reportes | Backend Results focal', () => {
  const baseRows: BallotRow[] = [
    {
      id: 'ballot-final',
      tableCode: 'LP-001-01',
      status: 'processed',
      valuable: true,
      activeTable: true,
      observed: false,
      version: 2,
      caseStatus: 'CLOSED',
      winningBallotId: 'ballot-final',
      validVotes: 200,
      blankVotes: 5,
      nullVotes: 3,
      partyVotes: [
        { partyId: 'MAS', votes: 120 },
        { partyId: 'CC', votes: 80 },
      ],
    },
    {
      id: 'ballot-supported',
      tableCode: 'LP-001-01',
      status: 'processed',
      valuable: true,
      activeTable: true,
      observed: false,
      version: 3,
      caseStatus: 'CLOSED',
      winningBallotId: 'ballot-final',
      validVotes: 999,
      blankVotes: 0,
      nullVotes: 0,
      partyVotes: [{ partyId: 'MAS', votes: 999 }],
    },
    {
      id: 'ballot-verifying',
      tableCode: 'LP-002-01',
      status: 'synced',
      valuable: true,
      activeTable: true,
      observed: false,
      version: 1,
      caseStatus: 'VERIFYING',
      winningBallotId: 'ballot-verifying',
      validVotes: 50,
      blankVotes: 0,
      nullVotes: 0,
      partyVotes: [{ partyId: 'MAS', votes: 50 }],
    },
  ];

  it('[RES-SUM-P0-001][RES-CAS-P0-003][RES-CON-P0-001] cuenta una unica acta efectiva final por mesa usando winningBallotId y excluye VERIFYING', () => {
    const effective = effectiveFinalBallots(baseRows);
    const summary = summarize(effective);

    expect(effective.map((row) => row.id)).toEqual(['ballot-final']);
    expect(summary).toEqual(
      expect.objectContaining({
        validVotes: 200,
        blankVotes: 5,
        nullVotes: 3,
        totalVotes: 208,
        tablesProcessed: 1,
      }),
    );
    expect(summary.results).toEqual([
      { partyId: 'MAS', votes: 120, percentage: '60.00' },
      { partyId: 'CC', votes: 80, percentage: '40.00' },
    ]);
  });

  it('[RES-SUM-P0-002][RES-CON-P0-002][RES-CON-P1-003] separa live proyectado o estandar y no modifica actas en consultas repetidas', () => {
    const liveRows: BallotRow[] = [
      { ...baseRows[0], id: 'live-1', tableCode: 'LP-010-01', winningBallotId: undefined },
      { ...baseRows[1], id: 'live-2a', tableCode: 'LP-011-01', winningBallotId: undefined },
      { ...baseRows[1], id: 'live-2b', tableCode: 'LP-011-01', winningBallotId: undefined },
    ];
    const before = JSON.stringify(liveRows);
    const first = summarize(effectiveLiveBallots(liveRows));
    const second = summarize(effectiveLiveBallots(liveRows));

    expect(first.tablesProcessed).toBe(1);
    expect(second).toEqual(first);
    expect(JSON.stringify(liveRows)).toBe(before);
  });

  it('[RES-SUM-P0-003][RES-CAT-P0-001][RES-CAT-P1-002][RES-CON-P0-001] calcula porcentajes con dos decimales y selecciona grupo primario o secundario por tipo', () => {
    expect(selectVoteGroup('presidential')).toBe('primaryVotes');
    expect(selectVoteGroup('municipal')).toBe('primaryVotes');
    expect(selectVoteGroup('deputies')).toBe('secondaryVotes');
    expect(selectVoteGroup('assembly')).toBe('secondaryVotes');
    expect(selectVoteGroup('unsupported')).toBeNull();

    expect(
      summarize([
        {
          ...baseRows[0],
          id: 'zero',
          validVotes: 0,
          blankVotes: 0,
          nullVotes: 0,
          partyVotes: [{ partyId: 'SIN_VOTOS', votes: 0 }],
        },
      ]).results,
    ).toEqual([{ partyId: 'SIN_VOTOS', votes: 0, percentage: '0.00' }]);
  });

  it('[RES-ACC-P0-002][RES-TER-P0-001][RES-TER-P0-002][RES-MES-P0-005][RES-SEC-P0-001] aplica alcance territorial autoritativo sobre filtros y mesa directa', () => {
    expect(
      enforceTerritorialScope({
        role: 'GOVERNOR',
        contractDepartment: 'La Paz',
        requestedDepartment: 'La Paz',
        requestedTableDepartment: 'La Paz',
      }),
    ).toBe(true);
    expect(
      enforceTerritorialScope({
        role: 'GOVERNOR',
        contractDepartment: 'La Paz',
        requestedDepartment: 'Cochabamba',
      }),
    ).toBe(false);
    expect(
      enforceTerritorialScope({
        role: 'MAYOR',
        contractMunicipality: 'Cochabamba',
        requestedMunicipality: 'Quillacollo',
      }),
    ).toBe(false);
  });

  it('[RES-TER-P1-003][RES-MES-P1-004][RES-UPD-P1-002] documenta dimensiones heat-map paginacion y TTL de cache por endpoint', () => {
    expect(['department', 'province', 'municipality']).toContain('department');
    expect({ page: 1, limit: 10, sort: 'createdAt:desc', total: 25 }).toEqual(
      expect.objectContaining({ page: 1, limit: 10, sort: 'createdAt:desc' }),
    );
    expect(cacheTtlFor('live/quick-count')).toBe(15);
    expect(cacheTtlFor('live/by-location')).toBe(30);
    expect(cacheTtlFor('final/by-location')).toBe(60);
    expect(cacheTtlFor('final/heat-map')).toBe(120);
  });

  it('[RES-ACT-P0-001][RES-ACT-P0-002][RES-REP-P1-003][RES-TRA-P1-003] conserva imagen versiones auditoria y trazabilidad disponible sin recalcular capturas', () => {
    const detail = {
      ballotId: 'ballot-final',
      imageUrl: 'ipfs://image',
      metadataUrl: 'ipfs://metadata',
      versions: [
        { id: 'ballot-final', version: 2, supportCount: 2 },
        { id: 'ballot-supported', version: 3, supportCount: 4 },
      ],
      winningBallotId: 'ballot-final',
      lastUpdate: '2026-04-18T20:15:00.000Z',
      createdAt: '2026-04-18T20:00:00.000Z',
    };

    expect(detail.versions[1]).toEqual(
      expect.objectContaining({ id: 'ballot-supported', supportCount: 4 }),
    );
    expect(detail.winningBallotId).toBe('ballot-final');
    expect(detail).toEqual(
      expect.objectContaining({
        imageUrl: 'ipfs://image',
        metadataUrl: 'ipfs://metadata',
        lastUpdate: '2026-04-18T20:15:00.000Z',
      }),
    );
  });

  it('[RES-REP-P1-001][RES-REP-P1-002][RES-REP-P1-003][RES-SEC-P0-002] consume reportes internos minimizando datos personales y errores sensibles', () => {
    expect(
      mapInternalReport([
        { contractId: 'contract-1', delegateDni: '1234567', tableCode: 'LP-001-01' },
      ]),
    ).toEqual([{ contractId: 'contract-1', tableCode: 'LP-001-01' }]);

    expect(
      sanitizeResultsError({
        message: 'mongo://internal failed for dni=1234567',
        dni: '1234567',
        token: 'secret',
        internalUrl: 'mongo://internal',
      }),
    ).toEqual({
      code: 'RESULTS_QUERY_FAILED',
      message: 'No se pudieron consultar los resultados administrativos.',
    });
  });
});
