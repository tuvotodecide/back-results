# Institutional Voting E2E (RED suite)

Esta suite define contratos E2E del nuevo dominio de votacion institucional.

## Objetivo

- Especificar el comportamiento esperado antes de implementar el dominio.
- Mantener pruebas en rojo hasta que exista la implementacion real.

## Ejecutar solo esta suite

```bash
npm run test:e2e -- --testPathPattern=test/end-to-end/institutional-voting.e2e.spec.ts
```

## Ejecutar toda la carpeta end-to-end

```bash
npm run test:e2e
```

## Notas

- No modifica codigo de produccion.
- Usa helpers/fixtures en `test/utils` y `test/fixtures.institutional-voting.ts`.
- Incluye escenarios pendientes (`it.todo`) donde la especificacion depende de endpoints aun no definidos.
