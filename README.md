# Back Results Backend

Backend NestJS del sistema electoral. Expone APIs HTTP, flujos de autenticación, procesos de resultados, integraciones institucionales y rutas ligadas a componentes ZK/on-chain.

## Arranque

1. Instalar dependencias:

```bash
pnpm install
```

2. Crear variables de entorno a partir de `.env.example`.

3. Ejecutar el backend:

```bash
pnpm start
```

Comandos útiles:

```bash
pnpm start:dev
pnpm start:debug
pnpm build
```

## Configuración

- La carga principal de configuración se centraliza en [src/config/app.config.ts](/mnt/c/Users/JOSE/Desktop/block/electoral/backend/back-results/src/config/app.config.ts).
- El template de variables está en [.env.example](/mnt/c/Users/JOSE/Desktop/block/electoral/backend/back-results/.env.example).
- Las variables del archivo de ejemplo reflejan las usadas por los paths activos del backend. No incluye variables legacy que no estén conectadas al bootstrap/config actual.
- Los defaults documentados deben preservarse si no existe validación funcional explícita para cambiarlos.

## Swagger

- Documentación OpenAPI: `/api/docs`
- La documentación debe reflejar exactamente lo que ya responde la API; no es una fuente para redefinir contratos.

## Testing y CI

Comandos disponibles:

```bash
pnpm test
pnpm test:unit
pnpm test:integration
pnpm test:e2e
pnpm test:acceptance
pnpm test:cov
```

Verificación rápida antes de merge:

```bash
pnpm build
pnpm test:unit
pnpm test:integration
```

Si CI ya cubre suites completas, usar localmente al menos `build` y la suite afectada por el cambio.

## Mocks y Endpoints de Testing

`MocksModule` esta deshabilitado por defecto y solo se importa cuando `ENABLE_MOCKS=true`.

Con la flag habilitada se montan estos endpoints no productivos de seed/testing:

- `POST /testing/seed`
- `POST /testing/seed-audit-demo`
- `DELETE /testing/cleanup`
- `GET /testing/stats`

Uso local o de pruebas que necesite esos endpoints:

```bash
ENABLE_MOCKS=true
pnpm start:dev
```

No habilitar `ENABLE_MOCKS=true` en despliegues productivos salvo validacion operativa explicita.

Los endpoints compatibles con Pinata siguen montados fuera de `ENABLE_MOCKS` porque forman parte del contrato actualmente consumido:

- `POST /api/v1/pinning/pinFileToIPFS`
- `POST /api/v1/pinning/pinJSONToIPFS`
- `GET /api/v1/data/pinList`

## Ejecución Local

Checklist mínima:

```bash
cp .env.example .env
pnpm install
pnpm build
pnpm start:dev
```

Para cambios no funcionales o transversales, validar al menos:

```bash
pnpm build
pnpm test:unit
```

## Límites Arquitectónicos

No todo este backend debe tratarse como un CRUD NestJS convencional. Existen decisiones deliberadas vinculadas a ZK, account abstraction y flujos on-chain.

- Documento de referencia: [docs/zk-onchain-boundaries.md](/mnt/c/Users/JOSE/Desktop/block/electoral/backend/back-results/docs/zk-onchain-boundaries.md)
- Antes de tocar guards, autorización, callbacks ZK, rutas públicas, payloads o integraciones on-chain, se requiere validación funcional humana.
- `MocksModule` y los endpoints de seed/testing solo deben habilitarse con `ENABLE_MOCKS=true`.

## Notas Operativas

- El backend usa MongoDB y puede activar Redis solo si hay `REDIS_HOST`.
- Firebase Admin requiere `FB_PROJECT_ID`, `FB_CLIENT_EMAIL` y `FB_PRIVATE_KEY`.
- Los secretos on-chain deben inyectarse por entorno; no deben permanecer hardcodeados en el código fuente.
- Si una mejora parece “mejor NestJS” pero puede cambiar rutas, payloads, guards o validaciones efectivas, queda fuera de alcance.
