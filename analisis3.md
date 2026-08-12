Auditoría focal — Flujo D3/D4 de invitaciones institucionales

Objetivo

Auditar exclusivamente qué ocurre después de que una persona invitada abre y acepta una invitación institucional, diferenciando correctamente:

D3: persona registrada en Tu Voto Decide, con CI/DNI y wallet, pero sin cuenta administrativa.

D4: persona registrada en Tu Voto Decide y que ya tiene cuenta administrativa.

Esta tarea es únicamente de AUDITORÍA.

No implementar correcciones todavía.

Repositorios a revisar

App móvil

C:\apps\electoral-app

Frontend administrativo

C:\apps\front-results

Backend Results

C:\Users\JOSE\Desktop\block\electoral\backend\back-results

Backend Identity

E:\app\backend-identity

Backend Identity debe revisarse únicamente si hace falta para entender cómo se resuelve CI/DNI, wallet o existencia del usuario.

No modificar ningún repositorio.

No modificar contratos.

Fuente de verdad funcional

Distinción obligatoria

“Registrado en Tu Voto Decide” NO significa “tener cuenta administrativa”.

Una persona puede:

estar registrada en la app
+ tener CI/DNI
+ tener wallet
+ recibir notificaciones móviles

y aun así:

NO tener correo y contraseña para el frontend administrativo

Ese es el caso D3.

D3 — Persona sin cuenta administrativa

La persona:

sí existe en Tu Voto Decide
sí tiene CI/DNI
sí tiene wallet
NO tiene cuenta administrativa

Flujo funcional esperado según la Épica D:

Administrador principal
→ invita por CI/DNI
→ backend verifica persona y wallet
→ llega invitación a la app

Invitado
→ abre invitación
→ ve claramente la institución
→ acepta

Sistema detecta:
→ NO tiene cuenta administrativa

Entonces:
→ debe usar el formulario existente de creación de cuenta administrativa
→ la institución invitante debe estar ya determinada
→ la institución debe mostrarse como solo lectura
→ usuario registra SU correo
→ usuario registra SU contraseña
→ verifica SU correo
→ se crea o continúa la solicitud de acceso
→ PENDING_APPROVAL

No se debe:

crear una institución nueva
crear otro usuario móvil
crear otra identidad
crear otra wallet
permitir cambiar la institución
usar credenciales del administrador que invitó
activar al usuario inmediatamente
ejecutar blockchain antes de aprobación administrativa

D4 — Persona con cuenta administrativa existente

La persona:

sí existe en Tu Voto Decide
sí tiene CI/DNI
sí tiene wallet
sí tiene cuenta administrativa

Flujo esperado:

recibe invitación
→ abre
→ acepta
→ NO registra correo
→ NO registra contraseña
→ NO verifica correo otra vez
→ reutiliza su cuenta existente
→ crea o continúa solicitud para la institución invitante
→ PENDING_APPROVAL

No debe crearse:

otro userId
otro correo
otra contraseña
otra wallet
otra cuenta administrativa

Continuación común D3/D4

Después de llegar a:

PENDING_APPROVAL

debe ocurrir:

Administrador principal de la institución
→ revisa solicitud
→ aprueba o rechaza

Si rechaza:

REJECTED
→ fin
→ sin notificación de firma
→ sin UserOperation
→ sin blockchain

Si aprueba:

PENDING_MOBILE_AUTHORIZATION
→ backend crea solicitud móvil
→ notifica al administrador principal vigente
→ principal revisa institución/persona/wallet
→ acepta y firma
→ UserOperation
→ blockchain
→ reconciliación
→ assignment activo

El superadmin no debe aprobar accesos a instituciones existentes.

Contexto ya confirmado

La invitación institucional actualmente:

se crea
→ se entrega
→ llega a la app
→ aparece en la lista

Payload canónico:

type = INSTITUTIONAL_ADMIN_INVITATION
invitationId
tenantId
deduplicationKey

También existe:

InstitutionalInvitationNotificationCard

y existe flujo ZK / detalle protegido / aceptar-rechazar.

No volver a auditar desde cero FCM.

El foco comienza en:

Aceptar invitación

Auditoría 1 — Qué hace realmente el botón Aceptar

Localizar en móvil:

InstitutionalInvitationNotificationCard

Identificar:

archivo
función del botón Aceptar
endpoint llamado
payload enviado
respuesta esperada
navegación posterior

Responder:

ACCEPT_HANDLER:
ACCEPT_ENDPOINT:
ACCEPT_PAYLOAD:
ACCEPT_RESPONSE:
NEXT_ACTION:

Auditoría 2 — ¿Dónde se decide D3 vs D4?

Buscar exactamente dónde se determina si la persona:

TIENE cuenta administrativa
NO TIENE cuenta administrativa

Identificar la fuente real de verdad.

No asumir que basta con:

email != null

si existe un modelo o endpoint canónico.

Responder:

HAS_ADMIN_ACCOUNT_SOURCE:
MODEL:
SERVICE:
ENDPOINT:
FIELD_OR_RULE:

Auditoría 3 — Estado actual de D3

Para una persona sin cuenta administrativa, seguir el flujo real:

Aceptar invitación
→ ?

Clasificar exactamente:

A. crea PENDING_APPROVAL directamente
B. abre formulario administrativo
C. intenta abrir formulario pero pierde contexto
D. devuelve una URL/deep link
E. queda bloqueado
F. todavía no está implementado
G. otro

Responder:

D3_CURRENT_BEHAVIOR:

Auditoría 4 — Formulario administrativo existente

En front-results, localizar el formulario que actualmente crea una primera cuenta administrativa.

Identificar:

ROUTE:
COMPONENT:
FIELDS:
SUBMIT_ENDPOINT:
EMAIL_VERIFICATION_FLOW:

Determinar si ese formulario ya soporta:

institución existente
invitationId
tenantId
modo invitación
institución solo lectura

Responder:

FORM_EXISTS: SI/NO
INVITATION_MODE_EXISTS: SI/NO
TENANT_CONTEXT_SUPPORTED: SI/NO
INSTITUTION_READONLY_SUPPORTED: SI/NO

Auditoría 5 — ¿La institución ya puede venir precargada?

Seguir cómo el formulario obtiene hoy la institución.

Determinar si usa:

route params
query params
state
API
tenant selector
invitationId

Responder:

CURRENT_INSTITUTION_SOURCE:

Después comprobar si sería posible que:

invitationId
→ backend
→ invitation
→ tenantId
→ institución

sea la fuente real de la institución.

No implementar.

Auditoría 6 — No confiar en nombre libre de empresa

Comprobar si existe algún flujo actual que pueda hacer algo como:

?institutionName=Empresa CDF

y confiar en ese nombre para asociar la solicitud.

Si existe, marcarlo.

La autoridad correcta debe ser:

invitationId
→ tenantId validado
→ institución real

Responder:

INSTITUTION_BOUND_BY_INVITATION: SI/NO/PARCIAL

Auditoría 7 — Transición app móvil → frontend administrativo

Determinar si la app ya tiene mecanismo para abrir el frontend:

Linking.openURL
deep link
browser
webview
otro

Identificar ejemplos existentes.

Responder:

EXISTING_MOBILE_TO_WEB_PATTERN:
FILE:
FUNCTION:

No crear uno nuevo.

Auditoría 8 — Conservación de invitationId

Seguir el mismo invitationId desde:

notificación
→ detalle móvil
→ aceptar
→ navegación / URL / request
→ frontend administrativo
→ submit
→ verificación de correo
→ creación de solicitud

Crear tabla:

Etapa

invitationId presente

mismo valor

notificación





detail





accept





transición móvil-web





formulario





submit





verificación email





solicitud final





Este punto es obligatorio.

Auditoría 9 — Registro administrativo D3

Determinar exactamente qué crea el formulario:

user administrativo
credenciales
application
assignment
otros

Comprobar que NO cree:

institución nueva
wallet nueva
identidad nueva

Responder:

CREATES_ADMIN_ACCOUNT:
CREATES_APPLICATION:
CREATES_ASSIGNMENT:
CREATES_TENANT:
CREATES_WALLET:

Auditoría 10 — Verificación de correo

Seguir el flujo real:

registro
→ email verification
→ callback/confirmación
→ solicitud institucional

Determinar si el contexto:

invitationId
tenantId

sobrevive.

Responder:

EMAIL_VERIFICATION_PRESERVES_INVITATION: SI/NO/PARCIAL

Auditoría 11 — Estado final D3

Confirmar cuál es el estado real después de:

correo creado
contraseña creada
correo verificado

Esperado:

PENDING_APPROVAL

Responder:

D3_FINAL_STATUS:

Si hoy crea otro estado, documentarlo.

Auditoría 12 — Estado actual D4

Para una persona con cuenta administrativa:

seguir:

Aceptar
→ ?

Confirmar que no pida:

nuevo correo
nueva contraseña
nueva verificación

Responder:

D4_CURRENT_BEHAVIOR:
REUSES_USER_ID:
REUSES_EMAIL:
REUSES_WALLET:
FINAL_STATUS:

Auditoría 13 — Multiinstitución

Para D4, verificar que aceptar una invitación nueva:

no modifica
no reemplaza
no elimina

las relaciones existentes.

Comprobar:

mismo userId
mismo correo
misma contraseña
misma wallet
nueva relación institucional

Auditoría 14 — Aprobación posterior

Confirmar que D3 y D4 converjan en:

PENDING_APPROVAL

y que la solicitud aparezca al:

administrador principal

de la institución activa.

No al superadmin.

Responder:

APPROVER_ROLE:
REQUEST_VISIBLE_TO:

Auditoría 15 — Autorización móvil posterior

Sin ejecutar blockchain real, seguir el código:

principal aprueba
→ PENDING_MOBILE_AUTHORIZATION
→ notificación móvil
→ principal firma
→ blockchain
→ reconciliación
→ activo

Confirmar que el invitado NO firma su propia incorporación.

Responder:

MOBILE_AUTH_RECIPIENT:
MOBILE_AUTH_SIGNER:

Auditoría 16 — Estados D16

Verificar qué estados existen y cómo se traducen actualmente.

Como mínimo buscar soporte para:

Invitación pendiente
Registro pendiente
Verificación correo pendiente
Pendiente aprobación
Rechazada
Pendiente firma
Procesando blockchain
Activo
Expirada
Error recuperable

Responder tabla:

Estado funcional

Estado técnico real

UI existente

Auditoría 17 — Tests existentes

Buscar pruebas relacionadas con:

D3
D4
invitation accept
admin account registration
email verification
invitationId preservation
multi-tenant
PENDING_APPROVAL

No crear tests.

Reportar:

Escenario

Test

Cobertura

PASS/NO EJECUTADO

Auditoría 18 — Huecos reales

Clasificar los resultados.

Para D3

Una opción:

D3_COMPLETO
D3_PARCIAL
D3_NO_IMPLEMENTADO

Para D4

Una opción:

D4_COMPLETO
D4_PARCIAL
D4_NO_IMPLEMENTADO

No implementar

Esta auditoría NO debe:

modificar móvil
modificar frontend
modificar backend
modificar Identity
modificar tests
crear rutas
crear formularios
crear endpoints
cambiar estados

Solo identificar qué existe y qué falta.

Git

En cada repositorio revisado:

git status --short
git diff --stat

No:

reset
restore
checkout
stash
clean
commit
push

Preservar cambios preexistentes.

Entregable final

A. RESULTADO

Una opción:

D3_D4_AUDITADOS
AUDITORIA_PARCIAL
BLOQUEADO_POR_FALTA_DE_EVIDENCIA

B. RESUMEN EJECUTIVO

Máximo 12 líneas.

Explicar:

qué existe
qué falta
qué está conectado
qué no está conectado

C. D3 — SIN CUENTA ADMINISTRATIVA

ESTADO: COMPLETO/PARCIAL/NO_IMPLEMENTADO
ACCEPT_ACTUAL:
FORM_EXISTENTE:
MODO_INVITACION:
INSTITUCION_PRECARGADA:
INSTITUCION_SOLO_LECTURA:
EMAIL_PASSWORD:
EMAIL_VERIFICATION:
FINAL_STATUS:

D. D4 — CON CUENTA ADMINISTRATIVA

ESTADO: COMPLETO/PARCIAL/NO_IMPLEMENTADO
ACCEPT_ACTUAL:
PIDE_EMAIL: SI/NO
PIDE_PASSWORD: SI/NO
REPITE_VERIFICACION: SI/NO
REUTILIZA_USER_ID: SI/NO
REUTILIZA_WALLET: SI/NO
FINAL_STATUS:

E. FORMULARIO ADMINISTRATIVO EXISTENTE

ROUTE:
COMPONENT:
FIELDS:
ENDPOINT:
EMAIL_VERIFICATION:
REUTILIZABLE_PARA_D3: SI/NO

F. CONTEXTO DE INSTITUCIÓN

INVITATION_ID_PRESERVADO:
TENANT_ID_PRESERVADO:
INSTITUCION_RESUELTA_DESDE_BACKEND:
NOMBRE_EDITABLE:
RIESGO_DE_MANIPULACION:

G. TRANSICIÓN MÓVIL → FRONTEND

MECANISMO_EXISTENTE:
SE_REUTILIZA_HOY:
SOPORTA_INVITATION_ID:

H. FLUJO REAL ENCONTRADO

D3

...

D4

...

I. PUNTO EXACTO QUE FALTA

Para cada gap:

GAP:
ARCHIVO:
FUNCION:
CAPA:
EVIDENCIA:

J. APROBACIÓN Y FIRMA POSTERIOR

PENDING_APPROVAL:
APRUEBA:
PENDING_MOBILE_AUTHORIZATION:
FIRMA:
ACTIVACION:

K. TESTS EXISTENTES

Tabla completa.

L. TESTS QUE FALTAN

Solo listar.

No crearlos.

M. ARCHIVOS QUE HABRÍA QUE MODIFICAR

Separar:

MOBILE:
FRONTEND:
BACKEND:
IDENTITY:

Solo candidatos respaldados por evidencia.

N. PLAN DE IMPLEMENTACIÓN POSTERIOR

Dar un plan mínimo y ordenado, pero NO implementarlo.

Separar:

OBLIGATORIO
RECOMENDADO
NO NECESARIO

O. CONFIRMACIÓN FINAL

D3_COMPLETO: SI/NO
D4_COMPLETO: SI/NO
FORMULARIO_EXISTENTE_REUTILIZABLE: SI/NO
INSTITUCION_PUEDE_PRECARGARSE_DESDE_INVITACION: SI/NO
INVITATION_ID_SE_CONSERVA: SI/NO
PENDING_APPROVAL_CORRECTO: SI/NO
MULTIINSTITUCION_CORRECTA: SI/NO
CAMBIOS_MOVIL: 0
CAMBIOS_FRONTEND: 0
CAMBIOS_BACKEND: 0
CAMBIOS_IDENTITY: 0
TESTS_MODIFICADOS: 0
COMMITS_REALIZADOS: 0
AUDITORIA_SOLAMENTE: SI

Principio final

No asumir que D3 está implementado ni asumir que falta.

Primero comprobar:

Aceptar invitación
        ↓
¿tiene cuenta administrativa?
        │
        ├── NO
        │   → ¿ya existe redirección al registro administrativo?
        │   → ¿se reutiliza el formulario?
        │   → ¿institución viene de invitationId?
        │   → ¿correo/password + verificación?
        │   → ¿PENDING_APPROVAL?
        │
        └── SÍ
            → ¿omite registro?
            → ¿reutiliza cuenta?
            → ¿PENDING_APPROVAL?

La auditoría debe terminar indicando con evidencia qué parte exacta existe y qué parte exacta falta.

NO IMPLEMENTAR NADA EN ESTA TAREA.