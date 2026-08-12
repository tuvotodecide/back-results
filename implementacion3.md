Prompt — Implementar flujo completo D3/D4 de invitaciones institucionales y verificarlo hasta quedar verde

Objetivo

Implementar de punta a punta el flujo de invitaciones institucionales definido por D3 y D4, reutilizando lo que ya existe y sin crear arquitecturas paralelas.

La implementación debe cubrir:

persona registrada en Tu Voto Decide pero sin cuenta administrativa;

persona registrada en Tu Voto Decide y con cuenta administrativa existente;

aceptación de invitación;

registro administrativo cuando corresponda;

verificación de correo;

creación de solicitud PENDING_APPROVAL;

aprobación por el administrador principal;

autorización móvil del administrador principal;

firma/UserOperation;

reconciliación;

activación final del nuevo administrador.

Además, al terminar cada bloque, debes auditar tu propia implementación, ejecutar pruebas focales y corregir cualquier fallo encontrado hasta obtener evidencia real de que el flujo está consistente.

No declarar PASS por razonamiento. PASS requiere ejecución o evidencia verificable.

Repositorios

App móvil

C:\apps\electoral-app

Frontend administrativo

C:\apps\front-results

Backend Results

C:\Users\JOSE\Desktop\block\electoral\backend\back-results

Backend Identity

E:\app\backend-identity

Backend Identity debe permanecer sin cambios salvo evidencia inequívoca de que existe un defecto real allí.

No modificar contratos.

Fuente de verdad funcional

Regla esencial

Estar registrado en Tu Voto Decide NO significa tener cuenta administrativa.

Una persona puede tener:

CI/DNI
wallet
usuario móvil
identidad válida

y todavía NO tener:

correo administrativo
contraseña administrativa
acceso al frontend administrativo

Ese es D3.

Muy importante — invitación NO equivale a aprobación ni firma

Aunque el administrador principal haya enviado personalmente la invitación:

INVITAR
≠
APROBAR
≠
FIRMAR

El flujo debe conservar las etapas separadas.

La invitación significa:

"quiero que esta persona pueda iniciar el proceso para incorporarse"

Después de aceptar:

la solicitud queda PENDING_APPROVAL

El administrador principal todavía debe realizar la decisión administrativa.

Después, si aprueba:

PENDING_MOBILE_AUTHORIZATION

y recién entonces el administrador principal firma desde su teléfono.

No saltar esas etapas.

No convertir:

invitación aceptada

directamente en:

administrador activo

Flujo final esperado — D3

Persona:

registrada en Tu Voto Decide
+ CI/DNI válido
+ wallet válida
+ usuario móvil
- cuenta administrativa

Flujo:

Administrador principal
→ busca por CI/DNI
→ backend confirma identidad
→ backend obtiene wallet automáticamente
→ crea invitación para institución existente
→ llega push al invitado

Invitado
→ abre notificación
→ ve institución
→ ZK valida identidad
→ abre detalle seguro
→ pulsa Aceptar

Backend detecta:
→ NO tiene cuenta administrativa

Resultado:
→ NO marcar todavía el proceso como alta administrativa final
→ devolver una respuesta estructurada de tipo:
   REQUIRES_ADMIN_ACCOUNT
→ app muestra una acción clara:
   "Crear cuenta administrativa"
→ app abre el frontend administrativo
   usando el mecanismo existente
→ registro entra en MODO_INVITACIÓN
→ invitationId preservado
→ backend resuelve tenant desde la invitación
→ institución visible y bloqueada
→ no existe selector de institución
→ no existe opción "crear nueva institución"
→ usuario registra SU correo
→ usuario registra SU contraseña
→ verifica SU correo
→ backend crea/continúa la solicitud ligada a la invitación
→ estado PENDING_APPROVAL
→ invitation ACCEPTED según el punto seguro e idempotente definido por la implementación

Luego:

Administrador principal
→ ve la solicitud
→ Aprobar / Rechazar

Si rechaza:

REJECTED
→ sin autorización móvil
→ sin firma
→ sin blockchain
→ sin acceso

Si aprueba:

PENDING_MOBILE_AUTHORIZATION
→ backend crea autorización móvil
→ notifica al administrador principal vigente
→ principal abre app
→ revisa institución + persona + wallet
→ acepta/firma
→ app construye UserOperation
→ app envía UserOperation
→ blockchain procesa
→ backend reconcilia
→ assignment APPROVED + active

Después:

Invitado
→ entra al frontend con SU correo y SU contraseña
→ administra la institución según su rol

Flujo final esperado — D4

Persona:

registrada en Tu Voto Decide
+ wallet válida
+ cuenta administrativa existente

Flujo:

Administrador principal
→ invita por CI/DNI
→ llega push

Invitado
→ abre
→ ZK
→ detalle
→ Aceptar

Backend detecta:
→ YA tiene cuenta administrativa

Entonces:
→ NO registro web
→ NO nuevo correo
→ NO nueva contraseña
→ NO nueva verificación
→ reutilizar mismo userId
→ reutilizar misma wallet
→ conservar relaciones con otras instituciones
→ invitation ACCEPTED
→ application PENDING_APPROVAL

Luego usa exactamente la misma aprobación y firma descritas arriba.

Contexto ya existente que debe preservarse

Ya existen, según auditoría previa:

FCM de invitaciones
outbox y reintentos
reenvío después de SENT
alta tardía del destinatario
INSTITUTIONAL_ADMIN_INVITATION
InstitutionalInvitationNotificationCard
ZK institucional
detalle seguro
D4
PENDING_APPROVAL
precedencia REJECTED histórico → proceso nuevo PENDING
aprobación administrativa
autorización móvil
reconciliación
multiinstitución

No reimplementar estos componentes si funcionan.

Extenderlos de manera mínima.

Problemas confirmados que deben resolverse

GAP 1 — D3 no existe

Actualmente:

Aceptar invitación
→ acceptInvitationFromMobile()
→ busca RoledUser
→ exige email/cuenta administrativa
→ INSTITUTIONAL_INVITATION_ACCOUNT_NOT_FOUND

Debe transformarse en un flujo funcional D3.

GAP 2 — hasAdminAccount no puede estar fijo

Auditoría:

getMobileInvitationRequest
→ hasAdminAccount: true fijo

Corregir para que sea resultado real del backend.

No confiar en:

boolean enviado por cliente
email suelto del frontend

Usar la fuente canónica existente para determinar si existe cuenta administrativa.

GAP 3 — formulario web sin modo invitación

Ruta actual:

/votacion/registrarse

Componente:

RegisterVotacionPage

Actualmente es genérico.

Debe poder reutilizarse como:

MODO_INVITACION

sin crear un segundo formulario completo.

1. Primero reconstruir el contrato actual

Antes de editar, abrir y documentar:

InstitutionalInvitationNotificationCard.js
institutionalAuthorizationApi.js
RegisterVotacionPage.tsx
registerPrefill.ts
VerifyVotacionPage.tsx
institutional-admin-applications.service.ts
institutional-admin-applications.controller.ts
DTOs relacionados
schemas de invitation/application

Responder internamente:

CURRENT_ACCEPT_CONTRACT:
CURRENT_REGISTER_CONTRACT:
CURRENT_VERIFY_EMAIL_CONTRACT:
CURRENT_INVITATION_STATES:
CURRENT_APPLICATION_STATES:

No implementar hasta entender las transiciones actuales.

2. Definir una respuesta backend explícita para D3/D4

El backend debe ser autoridad.

Al aceptar/consultar una invitación válida, debe poder distinguir:

HAS_ADMIN_ACCOUNT
REQUIRES_ADMIN_ACCOUNT

o nombres equivalentes coherentes con el proyecto.

No usar errores genéricos para D3 normal.

D3 no es un error técnico.

Debe ser un estado funcional esperado.

Ejemplo conceptual:

{
  "status": "REQUIRES_ADMIN_ACCOUNT",
  "invitationId": "...",
  "tenant": {
    "id": "...",
    "name": "Empresa CDF"
  }
}

No copiar esta estructura si ya existe un DTO equivalente.

Adaptarse a las convenciones reales del proyecto.

No exponer secretos.

3. Seguridad de invitationId

La fuente de autoridad debe ser:

invitationId
→ invitation persistida
→ DNI/persona invitada
→ wallet invitada
→ tenantId real

Backend debe validar:

invitación existe
PENDING
no expirada
no cancelada
persona autenticada corresponde
wallet corresponde
tenant corresponde a la invitación

Frontend NO puede decidir el tenant final.

4. No pasar tenant manipulable como autoridad

La transición móvil → web puede transportar:

invitationId

y, si sirve para UX:

institutionName

pero backend NO debe confiar en el nombre ni en un tenantId arbitrario del cliente.

Al cargar modo invitación:

frontend
→ consulta backend con invitationId
→ backend devuelve institución real

5. App móvil — D3

En:

InstitutionalInvitationNotificationCard

después de ZK/detalle:

Si backend indica:

REQUIRES_ADMIN_ACCOUNT

mostrar una acción funcional clara.

Ejemplo UX:

Para aceptar la invitación debes crear tu cuenta administrativa.

Institución:
Empresa CDF

[Crear cuenta administrativa]

No mostrar:

INSTITUTIONAL_INVITATION_ACCOUNT_NOT_FOUND

como error genérico.

6. App móvil → frontend

Reutilizar el patrón de apertura web existente:

Linking.openURL

o el mecanismo real encontrado.

No inventar otro esquema si no es necesario.

Abrir la ruta real:

/votacion/registrarse

en modo invitación.

Puede utilizarse:

invitationId

como identificador opaco, según seguridad del contrato.

No poner:

API key
bearer token
DNI completo
wallet sensible
secretos

en la URL.

7. Frontend — modo invitación

RegisterVotacionPage debe detectar de forma segura que está en modo invitación.

En ese modo:

NO mostrar selección nueva/existente
NO permitir elegir otra institución
NO permitir escribir nombre de institución
NO permitir modificar wallet

Mostrar:

Institución
Empresa CDF

como dato:

solo lectura

La asociación real se obtiene desde backend usando invitationId.

8. Qué debe pedir D3

Reutilizar los campos actuales necesarios para crear la primera cuenta administrativa:

correo administrativo
contraseña
confirmación de contraseña

y cualquier dato personal realmente requerido por el contrato actual.

No volver a crear:

wallet
identidad
usuario móvil
tenant

No permitir que una persona registre un correo perteneciente a otra cuenta.

9. No duplicar cuenta administrativa

Antes de finalizar D3 volver a validar que no apareció una cuenta administrativa durante el proceso.

Condición de carrera:

usuario abre D3
→ antes de submit se crea cuenta administrativa por otra vía

El backend debe resolver de forma idempotente:

si ahora ya existe cuenta
→ reutilizarla
→ no crear otra

10. Estado de invitación durante D3

Elegir la transición basándose en los estados actuales y seguridad.

No marcar la invitación como completada irreversiblemente antes de que D3 tenga una continuación válida.

Debe poder representar:

invitación aceptada pero registro administrativo pendiente

o mantener PENDING con estado de aplicación asociado si esa es la arquitectura existente.

No inventar un estado si puede representarse con los estados ya existentes.

Pero debe cumplirse D16:

Registro pendiente
Verificación de correo pendiente

deben poder distinguirse.

11. Crear/continuar application D3

El registro administrativo desde invitación debe estar ligado a:

invitationId
tenantId
user identity
wallet

No crear una solicitud genérica que luego intente volver a localizar la invitación por nombre.

Debe existir trazabilidad directa.

12. Verificación de correo

Preservar el mecanismo actual.

Durante:

registro
→ PENDING_EMAIL_VERIFICATION
→ verify email

debe conservarse en backend la relación con:

invitationId
tenantId

El enlace/código de verificación NO debe permitir cambiar institución.

Después:

PENDING_EMAIL_VERIFICATION
→ PENDING_APPROVAL

13. D4 no debe sufrir regresión

Mantener:

Aceptar
→ invitation ACCEPTED
→ application PENDING_APPROVAL

sin:

registro
password
email nuevo
verificación nueva

Agregar/regenerar pruebas D4 si hace falta.

14. Aprobación — no saltarla porque el principal ya invitó

Este punto es obligatorio.

Aunque el mismo administrador principal haya creado la invitación:

INVITACION
→ ACEPTACION
→ PENDING_APPROVAL

y debe realizar después la aprobación administrativa.

Razón funcional:

la invitación autoriza iniciar el proceso
la aprobación confirma la incorporación ya completado el registro del invitado
la firma autoriza la wallet on-chain

Mantener las tres etapas independientes.

15. Quién aprueba

Para institución existente:

ADMINISTRADOR PRINCIPAL VIGENTE

No:

SUPERADMIN
ADMIN SECUNDARIO
INVITADO

Comprobar esto en backend y frontend.

16. Quién firma

Después de aprobar:

administrador principal vigente

debe recibir la solicitud móvil.

El invitado NO firma su propia incorporación.

Backend no firma con private key del servidor.

17. Activación final

No activar assignment cuando:

invitación aceptada
correo verificado
solicitud aprobada
firma enviada

Activar únicamente después de:

confirmación/reconciliación blockchain

Estado final:

APPROVED
active = true

según modelo real.

18. Multiinstitución

D4 y D3 después de completar la cuenta deben conservar:

mismo userId
mismo correo
misma contraseña
mismo DNI
misma wallet

Una nueva institución genera una nueva relación/assignment, no un nuevo usuario.

No modificar relaciones previas.

19. Rechazo

Rechazo de invitación

invitation REJECTED
→ no registro administrativo por esa invitación
→ no solicitud activa
→ no firma
→ no blockchain

Rechazo de solicitud

application REJECTED
→ proceso cerrado
→ historial conservado
→ no firma
→ no blockchain

Una invitación/solicitud nueva posterior debe crear un proceso nuevo.

20. Expiración

Invitación vencida:

NO aceptar
NO continuar registro
NO reactivar

Debe requerir invitación nueva.

21. Idempotencia y concurrencia

Probar:

doble tap Aceptar
dos requests Accept concurrentes
doble submit de registro
doble verify email
doble aprobación
worker concurrente

No deben aparecer:

dos users
dos applications
dos assignments
dos invitaciones
dos autorizaciones móviles
dos UserOperations

22. Routing de invitación

Si la corrección previa todavía no está aplicada, garantizar también:

INSTITUTIONAL_ADMIN_INVITATION
→ VotingNotificationDetailScreen
→ InstitutionalInvitationNotificationCard

desde:

lista
push del sistema

Preservar invitationId.

23. No introducir RPC real en tests

Los tests de este flujo no deben llamar:

Base Sepolia
RPC externo
Firebase real
Identity real si existe mock contractual

Usar doubles únicamente en límites externos que no sean el objeto bajo prueba.

No mockear la lógica funcional D3/D4.

Tests mínimos obligatorios

Backend — D3

D3-01 invitación válida de persona sin cuenta devuelve REQUIRES_ADMIN_ACCOUNT
D3-02 no crea PENDING_APPROVAL antes del registro completo si el contrato así lo exige
D3-03 invitationId resuelve tenant real
D3-04 tenant manipulado es ignorado/rechazado
D3-05 persona incorrecta rechazada
D3-06 wallet incorrecta rechazada
D3-07 invitación expirada rechazada
D3-08 registro crea/reutiliza una única cuenta administrativa
D3-09 solicitud queda vinculada a invitationId
D3-10 verificación de correo termina en PENDING_APPROVAL
D3-11 no crea tenant
D3-12 no crea wallet

Backend — D4

D4-01 cuenta existente se reutiliza
D4-02 no crea usuario duplicado
D4-03 no cambia email/password
D4-04 no repite verificación
D4-05 application PENDING_APPROVAL
D4-06 otras instituciones intactas

Frontend

WEB-D3-01 modo invitación carga institución desde backend
WEB-D3-02 institución solo lectura
WEB-D3-03 no aparece selector
WEB-D3-04 no aparece crear nueva institución
WEB-D3-05 invitationId se conserva
WEB-D3-06 correo/password funcionan
WEB-D3-07 verify email conserva vínculo
WEB-D3-08 manipular tenant/query no cambia institución

Mobile

MOB-D3-01 aceptar D3 muestra crear cuenta administrativa
MOB-D3-02 abre registro correcto
MOB-D3-03 invitationId preservado
MOB-D4-01 aceptar D4 no abre registro
MOB-D4-02 muestra pendiente de aprobación
MOB-ROUTE-01 lista abre invitación
MOB-ROUTE-02 push abre invitación

Continuación

FLOW-01 PENDING_APPROVAL visible al principal
FLOW-02 principal puede aprobar
FLOW-03 rechazo no crea mobile auth
FLOW-04 aprobación crea exactamente una mobile auth
FLOW-05 destinatario es principal vigente
FLOW-06 invitado no puede firmarse a sí mismo
FLOW-07 assignment no activo antes de confirmación

LOOP OBLIGATORIO DE VERIFICACIÓN

No terminar después de escribir código.

Seguir este ciclo:

IMPLEMENTAR
→ revisar diff
→ ejecutar tests focales
→ analizar TODOS los FAIL
→ clasificar:
   código productivo
   harness
   fixture
   entorno
→ corregir únicamente lo demostrado
→ volver a ejecutar
→ repetir

Continuar hasta que ocurra una de estas dos condiciones:

A. todos los tests focales y matrices afectadas PASS

o:

B. existe un bloqueo externo real que no puede resolverse desde el código

No detenerse en el primer FAIL.

No declarar limitación si el fallo es corregible dentro del alcance.

Autoauditoría después de quedar verde

Después de los tests, releer el código modificado como auditor.

Intentar encontrar:

tenant manipulable
invitationId perdido
D3 tratado como error
D4 pidiendo credenciales
doble usuario
doble application
activación prematura
superadmin aprobando institución existente
invitado firmando
secreto en URL/push
RPC real en tests
false PASS

Si encuentras un problema:

corregir
→ volver a pruebas
→ volver a autoauditar

Validaciones por repositorio

Ejecutar pruebas focales primero.

Luego las matrices afectadas reales del repositorio.

No ejecutar globales innecesarios.

Como mínimo, si aplica:

Backend Results:
- tests D3/D4
- MX-02
- typecheck

Frontend:
- registro institucional
- modo invitación
- matriz correspondiente
- typecheck

Mobile:
- routing
- card
- navegación al registro
- matriz/módulo correspondiente

Si algún runner tiene un bloqueo WSL/Windows:

NO reportar FAIL funcional

Reportar:

NO_VERIFICADO_POR_ENTORNO

y dar el comando exacto para PowerShell nativo.

Pero ejecutar todo lo posible desde el entorno disponible.

Worktree

Los repositorios pueden contener numerosos cambios preexistentes.

Antes:

git status --short
git diff --stat

No:

git reset
git restore
git checkout
git stash
git clean
commit
push

No modificar cambios ajenos.

No hacer

NO feature flag nuevo salvo que el proyecto ya tenga uno y sea obligatorio.
NO rollout/piloto como sustituto de completar el flujo.
NO nueva arquitectura de invitaciones.
NO nuevo formulario duplicado si RegisterVotacionPage es reutilizable.
NO cambiar contratos.
NO cambiar Identity sin evidencia.
NO compartir credenciales.
NO registrar una nueva institución en D3.
NO permitir que usuario cambie institución.
NO saltar PENDING_APPROVAL porque el principal ya invitó.
NO activar acceso antes de blockchain.
NO false PASS.

Criterios de aceptación

CA-01
D3 existe de punta a punta.

CA-02
D4 continúa funcionando.

CA-03
Backend distingue D3/D4 de forma canónica.

CA-04
hasAdminAccount ya no está fijo.

CA-05
D3 no se trata como error ACCOUNT_NOT_FOUND.

CA-06
D3 reutiliza RegisterVotacionPage en modo invitación.

CA-07
Institución proviene de invitationId validado.

CA-08
Institución visible y no editable.

CA-09
D3 crea/reutiliza una única cuenta administrativa.

CA-10
Correo y contraseña son propios del invitado.

CA-11
Correo se verifica.

CA-12
D3 termina en PENDING_APPROVAL.

CA-13
D4 termina en PENDING_APPROVAL sin registro.

CA-14
El administrador principal debe aprobar incluso si él envió la invitación.

CA-15
Solo después de aprobación se crea mobile authorization.

CA-16
Firma el administrador principal vigente.

CA-17
Invitado no firma su incorporación.

CA-18
Assignment solo se activa después de confirmación blockchain.

CA-19
Multiinstitución conserva misma cuenta.

CA-20
Invitación expirada/rechazada no se reutiliza.

CA-21
Idempotencia sin duplicados.

CA-22
Routing móvil funciona desde lista y push.

CA-23
No hay secretos en URL/push.

CA-24
No hay RPC real en tests.

CA-25
Tests focales PASS.

CA-26
Matrices afectadas PASS.

CA-27
Typecheck PASS.

CA-28
CERO_FALSE_PASS.

Entregable final

A. RESULTADO

Una opción:

IMPLEMENTADO_Y_VERIFICADO
IMPLEMENTADO_CON_LIMITACION_EXTERNA
BLOQUEADO_POR_NUEVA_EVIDENCIA

No usar IMPLEMENTADO_Y_VERIFICADO si falta ejecutar una matriz o typecheck relevante.

B. FLUJO D3 FINAL

...

C. FLUJO D4 FINAL

...

D. DECISIÓN D3/D4

FUENTE_CANONICA:
HAS_ADMIN_ACCOUNT_FIJO_ELIMINADO:

E. MODO INVITACIÓN WEB

ROUTE:
FORMULARIO_REUTILIZADO:
INVITATION_ID:
INSTITUCION_SOURCE:
INSTITUCION_READONLY:
SELECTOR_OCULTO:
CREATE_TENANT_OCULTO:

F. EMAIL

D3_EMAIL_PASSWORD:
EMAIL_VERIFICATION:
INVITATION_CONTEXT_PRESERVED:
FINAL_STATUS:

G. APROBACIÓN

APRUEBA:
SUPERADMIN_APRUEBA_EXISTENTE:
ESTADO_TRAS_APROBAR:

Esperado:

administrador principal vigente
NO
PENDING_MOBILE_AUTHORIZATION

H. FIRMA

RECIPIENTE:
FIRMANTE:
INVITADO_FIRMA_SU_PROPIA_ALTA:
USER_OPERATION:
ACTIVACION:

I. SEGURIDAD

TENANT_MANIPULABLE:
INVITATION_ID_VALIDADO:
TOKEN_EN_URL:
API_KEY_EN_URL:
DNI_EN_PUSH:
WALLET_PRIVADA:

J. IDEMPOTENCIA

DOBLE_ACCEPT:
DOBLE_REGISTER:
DOBLE_VERIFY:
DOBLE_APPROVAL:
DUPLICATE_USER:
DUPLICATE_APPLICATION:
DUPLICATE_ASSIGNMENT:
DUPLICATE_MOBILE_AUTH:

K. ARCHIVOS MODIFICADOS

Separar:

MOBILE:
FRONTEND:
BACKEND:
IDENTITY:

Explicar cada cambio.

L. TESTS

Tabla:

Capa

Test

Escenario

Resultado

M. MATRICES

BACKEND:
FRONTEND:
MOBILE:

N. TYPECHECK

BACKEND:
FRONTEND:
MOBILE:

O. AUTOAUDITORÍA

ITERACIONES_REALIZADAS:
FALLOS_ENCONTRADOS_DESPUES_DE_IMPLEMENTAR:
FALLOS_CORREGIDOS:
RIESGOS_RESIDUALES:

P. ESTADO GIT

CAMBIOS_PREEXISTENTES:
CAMBIOS_DE_ESTA_TAREA:
COMMITS_REALIZADOS: 0

Q. CONFIRMACIÓN FINAL

D3_COMPLETO: SI/NO
D4_COMPLETO: SI/NO
D3_REGISTRO_ADMIN: SI/NO
INSTITUCION_PRECARGADA: SI/NO
INSTITUCION_NO_EDITABLE: SI/NO
EMAIL_VERIFICADO: SI/NO
D3_PENDING_APPROVAL: SI/NO
D4_PENDING_APPROVAL: SI/NO
PRINCIPAL_APRUEBA: SI/NO
PRINCIPAL_FIRMA: SI/NO
INVITADO_FIRMA_SU_ALTA: NO/SI
ACTIVO_SOLO_TRAS_BLOCKCHAIN: SI/NO
MULTIINSTITUCION_OK: SI/NO
TESTS_FOCALES_PASS: SI/NO
MATRICES_PASS: SI/NO
TYPECHECK_PASS: SI/NO
CERO_FALSE_PASS: SI/NO
LISTO_PARA_E2E_MANUAL: SI/NO
COMMITS_REALIZADOS: 0

Principio final

El flujo correcto NO es:

principal invita
→ invitado acepta
→ principal ya queda implícitamente aprobado
→ activo

Es:

principal invita
→ invitado acepta
→ si D3 crea su cuenta administrativa y verifica correo
→ PENDING_APPROVAL
→ principal aprueba
→ principal recibe autorización móvil
→ principal firma
→ blockchain confirma
→ invitado queda activo

La invitación, la aprobación y la firma son tres decisiones/etapas diferentes.

Implementar el flujo completo, verificarlo, autoauditarlo y repetir las correcciones hasta que los resultados reales permitan declarar PASS.