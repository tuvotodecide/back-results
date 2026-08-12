Auditoría final — Estado actual del flujo D3/D4 de invitaciones institucionales

Objetivo

Auditar cómo quedó realmente el flujo de invitaciones institucionales después de la implementación reciente de D3/D4.

Esta tarea es SOLO ANÁLISIS / AUDITORÍA.

No implementar correcciones todavía.

Necesito determinar con evidencia:

si D3 quedó realmente conectado de punta a punta;

si D4 sigue funcionando sin regresiones;

si el flujo conserva la separación entre invitación, registro administrativo, aprobación y firma;

si existen huecos entre móvil, frontend y Backend Results;

si la implementación es segura e idempotente;

qué limitaciones reales quedan;

si ya está listo para E2E manual real.

Repositorios

App móvil

C:\apps\electoral-app

Frontend administrativo

C:\apps\front-results

Backend Results

C:\Users\JOSE\Desktop\block\electoral\backend\back-results

Backend Identity

E:\app\backend-identity

Backend Identity se revisa solo para confirmar contratos de identidad/wallet si hace falta.

No modificar ningún repositorio.

No modificar contratos.

Contexto previo que debe verificarse, no asumirse

La implementación reportó:

D3:
Aceptar invitación
→ backend responde REQUIRES_ADMIN_ACCOUNT
→ móvil abre web con invitationId
→ usuario crea su correo/password
→ backend resuelve identidad e institución
→ verifica correo
→ PENDING_APPROVAL
→ principal aprueba
→ principal firma

D4:
Aceptar invitación
→ reutiliza cuenta administrativa existente
→ PENDING_APPROVAL
→ principal aprueba
→ principal firma

También se reportó:

HAS_ADMIN_ACCOUNT_FIJO_ELIMINADO: SI
INSTITUCION_SOLO_LECTURA: SI
TENANT_NO_MANIPULABLE_DESDE_WEB: SI
TESTS_FOCALES_VERDES: SI
MX02_COMPLETA_VERIFICADA: NO
TYPECHECK_BACKEND_TOTAL: NO

No tomar estas afirmaciones como verdad automática.

Comprobarlas contra código y pruebas.

Regla funcional principal

Mantener esta separación:

INVITAR
≠
ACEPTAR
≠
REGISTRAR CUENTA ADMINISTRATIVA
≠
APROBAR
≠
FIRMAR
≠
ACTIVAR

El hecho de que el administrador principal haya enviado la invitación NO debe saltar la aprobación posterior.

Flujo funcional esperado D3

Persona:

registrada en Tu Voto Decide
+ CI/DNI
+ wallet
+ usuario móvil
- cuenta administrativa

Debe ocurrir:

Invitación
→ móvil
→ ZK
→ detalle seguro
→ Aceptar
→ REQUIRES_ADMIN_ACCOUNT
→ abrir registro web en modo invitación
→ invitationId preservado
→ institución resuelta por backend
→ institución visible y no editable
→ usuario crea SU correo + SU contraseña
→ verifica correo
→ PENDING_APPROVAL
→ administrador principal revisa
→ aprueba/rechaza
→ si aprueba: PENDING_MOBILE_AUTHORIZATION
→ notificación al administrador principal
→ principal firma
→ UserOperation
→ blockchain
→ reconciliación
→ assignment activo

Flujo funcional esperado D4

Persona:

registrada en Tu Voto Decide
+ cuenta administrativa existente

Debe ocurrir:

Invitación
→ móvil
→ ZK
→ detalle
→ Aceptar
→ reutilizar mismo userId
→ reutilizar mismo correo
→ reutilizar misma wallet
→ NO pedir contraseña
→ NO verificar correo otra vez
→ PENDING_APPROVAL
→ administrador principal aprueba/rechaza
→ principal firma si aprueba
→ activación tras confirmación blockchain

AUDITORÍA 1 — Cambios reales realizados

En los tres repositorios:

git status --short
git diff --stat

Identificar exclusivamente cambios relacionados con esta implementación.

No mezclar cambios preexistentes.

Crear tabla:

Repo

Archivo

Cambio D3/D4

Preexistente

No modificar nada.

AUDITORÍA 2 — Contrato real de aceptación móvil

Revisar:

InstitutionalInvitationNotificationCard
institutionalAuthorizationApi
endpoint backend usado por Accept

Determinar:

ACCEPT_ENDPOINT:
ACCEPT_RESPONSE_D3:
ACCEPT_RESPONSE_D4:

Confirmar que D3 ya no termina en:

INSTITUTIONAL_INVITATION_ACCOUNT_NOT_FOUND

como comportamiento normal.

Debe existir una respuesta funcional estructurada para D3.

AUDITORÍA 3 — Decisión D3 vs D4

Localizar exactamente dónde se calcula:

hasAdminAccount

o equivalente.

Confirmar:

NO está hardcodeado
NO depende de boolean del frontend
NO depende únicamente de texto manipulable

Documentar:

FUENTE_CANONICA:
MODELO:
CONSULTA:
CRITERIO:

Confirmar que D4 se reconoce cuando realmente existe cuenta administrativa.

AUDITORÍA 4 — Estado de la invitación durante D3

Este punto es crítico.

Seguir la invitación cuando el usuario D3 pulsa Aceptar.

Determinar:

STATUS_ANTES_ACCEPT:
STATUS_DESPUES_ACCEPT_D3:
STATUS_DURANTE_REGISTRO:
STATUS_DURANTE_EMAIL_VERIFICATION:
STATUS_DESPUES_VERIFY:

Confirmar que el proceso no queda en un estado imposible de recuperar si:

usuario acepta
→ abre web
→ cierra navegador
→ vuelve más tarde

Debe poder continuar de forma segura mientras la invitación/proceso siga vigente.

AUDITORÍA 5 — Transición móvil → web

Confirmar cómo se abre:

/votacion/registrarse

o la ruta real.

Documentar:

MECANISMO:
URL:
PARAMETROS:

Comprobar que solo viaje información segura.

Esperado:

invitationId

No deben viajar en URL:

password
API key
bearer token
DNI completo innecesario
wallet sensible
tenant como autoridad

AUDITORÍA 6 — invitationId de punta a punta

Seguir el mismo identificador:

Etapa

invitationId presente

mismo valor

DB invitation





detalle móvil





Accept





respuesta D3





URL/deep link





frontend





request de registro





application





email verification





PENDING_APPROVAL





No aceptar “se conserva” sin rastrearlo.

AUDITORÍA 7 — Institución de la invitación

Confirmar que:

invitationId
→ backend
→ invitation
→ tenantId real
→ tenant

es la fuente de autoridad.

En modo invitación web verificar:

institución visible
institución no editable
selector oculto/deshabilitado
crear institución nueva oculto/deshabilitado

Intentar identificar si un usuario podría:

cambiar query param
cambiar tenantId
modificar request manual

y terminar asociado a otra institución.

Clasificar:

TENANT_TAMPERING: PROTEGIDO / VULNERABLE / PARCIAL

AUDITORÍA 8 — Formulario D3

Revisar el formulario reutilizado.

Confirmar qué campos pide realmente.

Debe corresponder a la primera cuenta administrativa.

Comprobar:

correo propio
contraseña propia
confirmación
wallet read-only si se muestra
institución read-only

No debe:

crear tenant
crear wallet
crear identidad
pedir seleccionar otra institución

AUDITORÍA 9 — Creación de cuenta administrativa

Seguir el submit D3 hasta backend.

Determinar exactamente qué documentos crea/modifica.

Responder:

CREA_ROLED_USER:
CREA_APPLICATION:
CREA_ASSIGNMENT:
CREA_TENANT:
CREA_WALLET:
MODIFICA_IDENTITY:

Esperado:

cuenta administrativa: SI
application: SI o se crea/continúa según contrato
assignment activo: NO
tenant nuevo: NO
wallet nueva: NO
Identity nueva: NO

AUDITORÍA 10 — Verificación de correo

Seguir:

registro D3
→ PENDING_EMAIL_VERIFICATION
→ verify email
→ PENDING_APPROVAL

Confirmar:

EMAIL_VERIFY_ENDPOINT:
APPLICATION_ID:
INVITATION_ID:
TENANT_ID:

La verificación no debe permitir cambiar institución.

Verificar también qué ocurre con:

doble verify
link vencido
usuario ya verificado

AUDITORÍA 11 — D4 regresión

Verificar que D4 todavía:

NO abre registro web
NO pide correo
NO pide password
NO verifica correo
NO crea segundo user

Confirmar:

SAME_USER_ID:
SAME_EMAIL:
SAME_WALLET:
PENDING_APPROVAL:

AUDITORÍA 12 — Multiinstitución

Para una cuenta administrativa ya existente:

Institución A activa
+ nueva invitación Institución B

Confirmar que aceptar B:

no toca assignment A
no cambia correo
no cambia wallet
no cambia rol en A

Cuando B finalmente quede activa debe aparecer como nueva relación, no reemplazar A.

AUDITORÍA 13 — Aprobación posterior

Verificar que después de D3 o D4:

PENDING_APPROVAL

solo pueda ser aprobado por:

PRIMARY vigente de esa institución

Confirmar:

SUPERADMIN: NO
SECONDARY: NO
INVITADO: NO

Revisar frontend y backend.

AUDITORÍA 14 — ¿Invitación implica aprobación automática?

Buscar explícitamente cualquier rama como:

if invitedByPrimary -> autoApprove

o equivalente.

Debe ser:

NO

Confirmar que el hecho de que el principal haya enviado la invitación no evita:

PENDING_APPROVAL

AUDITORÍA 15 — Autorización móvil

Después de aprobar:

PENDING_MOBILE_AUTHORIZATION

Confirmar:

quién recibe FCM
quién abre detalle
qué institución ve
qué persona ve
qué wallet ve

Esperado:

administrador principal vigente

No el invitado.

AUDITORÍA 16 — Firma

Seguir el código sin ejecutar transacción real.

Confirmar:

MOBILE_BUILDS_USER_OPERATION:
PRIMARY_SIGNS:
MOBILE_SENDS:
BACKEND_DOES_NOT_SIGN:

No debe existir private key de backend para reemplazar al principal.

AUDITORÍA 17 — Activación

Confirmar que estos estados NO activan acceso:

ACCEPTED invitation
PENDING_EMAIL_VERIFICATION
PENDING_APPROVAL
PENDING_MOBILE_AUTHORIZATION
PENDING_CHAIN_CONFIRMATION

Solo después de confirmación/reconciliación:

APPROVED
active=true

o equivalente real.

AUDITORÍA 18 — Rechazos

Invitación rechazada

Confirmar:

no cuenta creada por esa invitación
no PENDING_APPROVAL
no firma
no blockchain

Solicitud rechazada

Confirmar:

REJECTED histórico
no mobile auth
no blockchain

Y nueva invitación posterior debe crear proceso nuevo.

AUDITORÍA 19 — Expiración

Verificar:

7 días o TTL real definido

para invitación.

Confirmar:

expirada no se acepta
expirada no abre registro válido
expirada no se reactiva

AUDITORÍA 20 — Idempotencia

Auditar código y pruebas para:

doble tap Aceptar
doble request Accept
doble submit registro
doble verify email
doble aprobación
doble worker

Confirmar que no se creen:

duplicate user
duplicate application
duplicate assignment
duplicate mobile authorization
duplicate UserOperation

Revisar específicamente el índice sparse por:

invitationId

y explicar qué protege y qué NO protege.

AUDITORÍA 21 — Routing móvil

Confirmar que el fix previo realmente esté presente:

INSTITUTIONAL_ADMIN_INVITATION
→ VotingNotificationDetailScreen
→ InstitutionalInvitationNotificationCard

desde:

lista
push del sistema

Confirmar que no caiga en Splash.

AUDITORÍA 22 — Estado de D16

Mapear:

Estado funcional

Estado técnico

UI donde se ve

Acción del usuario

Invitación pendiente







Registro pendiente







Verificación pendiente







Pendiente aprobación







Rechazada







Pendiente firma







Procesando blockchain







Activo







Expirada







Error recuperable







Detectar estados existentes en backend pero sin representación clara en UI.

AUDITORÍA 23 — Tests focales existentes

Revisar las pruebas agregadas/modificadas.

No confiar solo en el resumen anterior.

Comprobar que realmente cubren:

D3
D4
tenant tampering
invitationId
email verification
routing móvil
multiinstitución
aprobación

Identificar mocks que puedan producir false PASS.

Crear tabla:

Test

Qué prueba realmente

Dependencias mockeadas

Riesgo false PASS

AUDITORÍA 24 — Ejecutar tests focales

Ejecutar nuevamente los tests focales reales si el entorno lo permite.

Separar por repositorio.

No ejecutar suites globales innecesarias.

Registrar:

COMANDO
PASS
FAIL
NO_EJECUTADO

AUDITORÍA 25 — MX-02

Ejecutar:

node.exe tools/run-module-tests.mjs matrix_02

desde entorno nativo si está disponible.

Si no puede finalizar por WSL/Windows:

MX02 = NO_VERIFICADA_POR_ENTORNO

No declararla PASS.

Si aparecen fallos reales, listarlos individualmente.

AUDITORÍA 26 — TS2742

Revisar los errores reportados en:

test/utils/institutional-voting.helpers.ts

Determinar:

PREEXISTENTES_REALMENTE: SI/NO
RELACIONADOS_CON_D3_D4: SI/NO
BLOQUEAN_BUILD_PRODUCTIVO: SI/NO
BLOQUEAN_SOLO_TYPECHECK_DE_TESTS: SI/NO

No corregirlos en esta auditoría.

No llamar “limitación externa” automáticamente.

Clasificar correctamente:

PREEXISTING_CODE_ISSUE
TEST_TYPECHECK_ISSUE
ENVIRONMENT_ISSUE
CURRENT_IMPLEMENTATION_REGRESSION

AUDITORÍA 27 — Typecheck por repositorio

Ejecutar si es posible:

Frontend
Backend
Mobile

Separar:

TYPECHECK_APP:
TYPECHECK_FRONTEND:
TYPECHECK_BACKEND_SRC:
TYPECHECK_BACKEND_TESTS:

No mezclar un error de helper de tests con un error productivo si son configuraciones distintas.

AUDITORÍA 28 — Seguridad

Confirmar:

TOKEN_EN_URL: NO
API_KEY_EN_URL: NO
PASSWORD_EN_URL: NO
DNI_EN_PUSH: NO
WALLET_PRIVADA: NO
TENANT_CLIENT_AUTHORITY: NO
INVITATION_ID_VALIDATED_SERVER_SIDE: SI

AUDITORÍA 29 — E2E manual readiness

Determinar si ya se puede ejecutar este escenario real:

D3 REAL
1. principal invita DNI registrado sin cuenta admin
2. invitación llega
3. invitado abre
4. ZK
5. acepta
6. abre registro web
7. institución correcta visible/bloqueada
8. crea correo/password
9. verifica email
10. aparece PENDING_APPROVAL al principal
11. principal aprueba
12. principal recibe mobile auth
13. principal firma
14. blockchain confirma
15. invitado inicia sesión
16. institución aparece activa

Y:

D4 REAL
1. principal invita usuario con cuenta admin
2. llega
3. acepta
4. no registro
5. PENDING_APPROVAL
6. principal aprueba
7. principal firma
8. activa
9. otras instituciones permanecen

Responder:

LISTO_D3_E2E:
LISTO_D4_E2E:

No implementar

Esta tarea NO debe modificar:

mobile
frontend
backend
Identity
tests
config
contracts

Si encuentra un defecto:

documentarlo
clasificarlo
proponer corrección

pero NO implementarlo.

Entregable final

A. RESULTADO

Una opción:

LISTO_PARA_E2E_MANUAL
LISTO_CON_LIMITACIONES_NO_BLOQUEANTES
NO_LISTO_PARA_E2E_MANUAL
REGRESION_CONFIRMADA

B. RESUMEN EJECUTIVO

Máximo 15 líneas.

C. D3

ACEPTACION:
REQUIRES_ADMIN_ACCOUNT:
NAVEGACION_WEB:
REGISTRO_ADMIN:
INSTITUCION_READONLY:
EMAIL_PASSWORD:
EMAIL_VERIFY:
PENDING_APPROVAL:
ESTADO:

D. D4

REUTILIZA_CUENTA:
NUEVO_EMAIL:
NUEVA_PASSWORD:
NUEVA_VERIFICACION:
PENDING_APPROVAL:
MULTIINSTITUCION:
ESTADO:

E. INVITACIÓN VS APROBACIÓN

INVITACION_AUTOAPRUEBA: SI/NO
PRINCIPAL_DEBE_APROBAR: SI/NO

Esperado:

NO
SI

F. FIRMA

RECIPIENTE_MOBILE_AUTH:
FIRMANTE:
INVITADO_FIRMA_SU_ALTA:
BACKEND_FIRMA:

G. invitationId / tenant

INVITATION_ID_END_TO_END:
TENANT_BACKEND_AUTHORITY:
TENANT_MANIPULABLE:

H. ESTADOS

Tabla D16.

I. IDEMPOTENCIA

DOUBLE_ACCEPT:
DOUBLE_REGISTER:
DOUBLE_VERIFY:
DOUBLE_APPROVAL:
DUPLICATE_USER:
DUPLICATE_APPLICATION:
DUPLICATE_ASSIGNMENT:

J. TESTS

Tabla real de ejecuciones.

K. MX-02

MX02:
TOTAL:
PASS:
FAIL:
BLOQUEO:

L. TYPECHECK

FRONTEND:
BACKEND_SRC:
BACKEND_TESTS:
MOBILE:
TS2742_CLASSIFICATION:

M. GAPS ENCONTRADOS

Para cada uno:

GAP:
SEVERIDAD:
CAPA:
ARCHIVO:
EVIDENCIA:
BLOQUEA_E2E: SI/NO

N. RIESGOS RESIDUALES

Solo riesgos comprobados.

O. PLAN DE CORRECCIÓN

Solo si existen gaps.

No implementar.

Separar:

BLOQUEANTES
NO_BLOQUEANTES
DEUDA_TECNICA

P. CONFIRMACIÓN FINAL

D3_COMPLETO: SI/NO
D4_COMPLETO: SI/NO
INVITACION_NO_AUTOAPRUEBA: SI/NO
PRINCIPAL_APRUEBA: SI/NO
PRINCIPAL_FIRMA: SI/NO
INVITADO_NO_FIRMA_SU_ALTA: SI/NO
INSTITUCION_NO_MANIPULABLE: SI/NO
INVITATION_ID_PRESERVADO: SI/NO
EMAIL_VERIFY_CONSERVA_CONTEXTO: SI/NO
MULTIINSTITUCION_OK: SI/NO
TESTS_FOCALES_PASS: SI/NO
MX02_PASS: SI/NO/NO_VERIFICADO
TYPECHECK_PRODUCTIVO_PASS: SI/NO/NO_VERIFICADO
LISTO_PARA_E2E_MANUAL: SI/NO
CAMBIOS_REALIZADOS: 0
COMMITS_REALIZADOS: 0
AUDITORIA_SOLAMENTE: SI

Principio final

No asumir que el flujo está cerrado porque los tests focales pasaron.

Auditar la cadena completa:

INVITACION
→ ACEPTACION
→ D3/D4
→ REGISTRO SI CORRESPONDE
→ EMAIL
→ PENDING_APPROVAL
→ APROBACION DEL PRINCIPAL
→ MOBILE AUTH DEL PRINCIPAL
→ FIRMA
→ BLOCKCHAIN
→ RECONCILIACION
→ ACCESO ACTIVO

y responder si realmente está listo para probarse de punta a punta con usuarios reales.

NO IMPLEMENTAR NADA EN ESTA TAREA.