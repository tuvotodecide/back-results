export const institutionalVotingFixtures = {
  event: {
    name: 'Eleccion Directiva 2026',
    objective: 'Elegir directiva institucional',
    votingStart: '2026-07-10T08:00:00-04:00',
    votingEnd: '2026-07-10T18:00:00-04:00',
    resultsPublishAt: '2026-07-10T20:00:00-04:00',
  },
  rolePresident: {
    name: 'Presidente',
  },
  optionBlue: {
    name: 'Frente Azul',
    color: '#0057FF',
    logoUrl: 'https://cdn.example.com/frente-azul.png',
    candidates: [
      {
        name: 'Ana Perez',
        photoUrl: 'https://cdn.example.com/candidates/ana.png',
        roleName: 'Presidente',
      },
    ],
  },
  optionGreen: {
    name: 'Frente Verde',
    color: '#00A65A',
    logoUrl: 'https://cdn.example.com/frente-verde.png',
    candidates: [
      {
        name: 'Luis Gomez',
        photoUrl: 'https://cdn.example.com/candidates/luis.png',
        roleName: 'Presidente',
      },
    ],
  },
  padronCsv: `carnet\n123456\n123.456\n 123-456 \n\nABC-789\n`,
  nullifiersForPadron: [
    'nullifier-123456',
    'nullifier-123.456',
    'nullifier-123-456',
    'nullifier-ABC-789',
  ],
  carnet: {
    normalizedSource: ' 123.456- ',
    normalizedExpected: '123456',
    notEmpadronado: 'NO-999',
    empadronado: 'ABC-789',
  },
  participation: {
    idempotencyKey: 'idem-evt-001-user-001',
  },
  resultsSnapshot: {
    txHash: '0xabc123',
    blockNumber: '123456',
    roles: [
      {
        roleName: 'Presidente',
        total: 10,
        ranking: [
          { optionName: 'Frente Azul', votes: 6, percentage: 60 },
          { optionName: 'Frente Verde', votes: 4, percentage: 40 },
        ],
        winners: [{ optionName: 'Frente Azul', votes: 6, percentage: 60 }],
      },
    ],
  },
  news: {
    title: 'Convocatoria oficial',
    body: 'Se publica la convocatoria institucional.',
    imageUrl: 'https://cdn.example.com/news/convocatoria.png',
    link: 'https://example.com/institucional/convocatoria',
  },
};
