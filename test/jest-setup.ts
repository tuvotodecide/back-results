import 'reflect-metadata';

const g: any = globalThis as any;
if (!g.fetch) {
  g.fetch = jest.fn(async () => {
    throw new Error('no configurado para este test');
  });
}
