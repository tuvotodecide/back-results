# AUDITORÍA FOCAL — Invitación institucional aparece en la app pero no se puede abrir

## OBJETIVO

Auditar exclusivamente el problema actual del flujo de invitaciones institucionales móviles:

```text
La invitación SÍ llega a la app
→ aparece en la lista de notificaciones
→ pero al intentar entrar/abrirla no permite continuar
```

No implementar correcciones todavía.

Necesito identificar el **punto exacto de ruptura** entre:

```text
FCM recibido
→ notificación persistida/listada
→ tap del usuario
→ reconocimiento del tipo
→ apertura de tarjeta/pantalla
→ obtención de invitationId
→ inicio ZK
→ sesión institucional
→ detalle seguro
→ render de invitación
```

La tarea debe determinar si el problema está en:

```text
UI / press handler
navegación
payload persistido
tipo de notificación
invitationId
ZK
callback
API key temporal
endpoint de detalle
estado de invitación
expiración
deduplicación
otro
```

---

# REPOSITORIOS

## App móvil

```text
C:\apps\electoral-app
```

## Backend Results

```text
C:\Users\JOSE\Desktop\block\electoral\backend\back-results
```

## Wira / SDK

Solo revisar si el flujo realmente llega al punto donde se inicia ZK y existe evidencia de que el SDK participa en el fallo.

No revisar Wira por defecto.

---

# CONTEXTO YA CONFIRMADO

No volver a auditar desde cero todo el sistema.

Actualmente ya está implementado:

```text
Administrador crea invitación
→ backend crea invitation PENDING
→ outbox
→ FCM real
→ user_<mobileUserId>
→ app recibe notificación
```

Esto ya está demostrado funcionalmente en el entorno real porque:

```text
LA INVITACIÓN APARECE EN LA LISTA DE LA APP
```

Por tanto, la investigación debe empezar **desde la recepción/listado hacia adelante**.

---

# REGLA ABSOLUTA

Esta tarea es:

```text
AUDITORIA_SOLAMENTE
```

No modificar:

```text
src/**
tests/**
config/**
.env*
package*
```

No corregir navegación.

No corregir payload.

No cambiar backend.

No modificar ZK.

No crear mocks para ocultar el comportamiento.

No commit.

No push.

Solo:

* leer código;
* seguir el flujo;
* revisar payloads;
* revisar estados;
* revisar logs;
* ejecutar pruebas focales existentes;
* identificar causa raíz.

---

# SÍNTOMA REAL

El usuario observa:

```text
1. llega invitación
2. aparece en lista de notificaciones
3. intenta abrir/entrar
4. no puede continuar
```

No asumir qué significa exactamente “no puede entrar”.

Determinar cuál de estos casos ocurre:

```text
A. tocar no ejecuta ninguna acción
B. el elemento no es presionable
C. tap ejecuta handler pero no navega
D. navega a pantalla incorrecta
E. abre pantalla pero queda cargando
F. abre tarjeta sin datos
G. falla al crear sesión ZK
H. ZK inicia pero callback falla
I. ZK termina pero detalle protegido falla
J. backend responde invitation not found
K. backend responde invitation expired/rejected/accepted
L. falla API key/contexto temporal
M. invitationId no está disponible después de persistir la notificación
```

Clasificar exactamente.

---

# AUDITORÍA 1 — RECEPCIÓN FCM

Localizar cómo entra el push en la app.

Buscar:

```text
Firebase
onMessage
notification response
background handler
push
FCM
```

Determinar payload real recibido para invitaciones.

Mostrar solo nombres de campos:

```text
type:
invitationId:
tenantId:
deduplicationKey:
otros:
```

No mostrar secretos.

Confirmar:

```text
INVITATION_ID_LLEGA_DESDE_FCM: SI/NO
```

---

# AUDITORÍA 2 — PERSISTENCIA DE LA NOTIFICACIÓN

Este punto es especialmente importante.

La auditoría anterior indicó que la app puede recuperar historial remoto y manejar almacenamiento local de notificaciones.

Determinar qué sucede con:

```text
invitationId
tenantId
type
```

cuando el push se transforma en el elemento que aparece en la lista.

Seguir:

```text
FCM payload
→ normalizador
→ almacenamiento
→ selector
→ lista de notificaciones
```

Responder:

```text
INVITATION_ID_RECIBIDO:
INVITATION_ID_PERSISTIDO:
INVITATION_ID_RECUPERADO_EN_LISTA:
```

Buscar si durante la persistencia se conserva solo:

```text
title
body
date
```

y se pierde:

```text
data.invitationId
```

Este es un candidato importante.

---

# AUDITORÍA 3 — HISTORIAL REMOTO VS PUSH LOCAL

Determinar de dónde proviene específicamente la notificación que se está mostrando.

Puede ser:

```text
A. push almacenado localmente
B. UserNotification backend
C. historial remoto
D. combinación de ambos
```

Comparar la estructura de datos de cada fuente.

Crear tabla:

| Campo        | FCM | almacenamiento local | API historial | componente |
| ------------ | --- | -------------------- | ------------- | ---------- |
| type         |     |                      |               |            |
| invitationId |     |                      |               |            |
| tenantId     |     |                      |               |            |
| title        |     |                      |               |            |
| body         |     |                      |               |            |

Determinar si una fuente pierde los datos requeridos para abrir la invitación.

---

# AUDITORÍA 4 — COMPONENTE DE LISTA

Localizar la pantalla real donde aparece la invitación.

Probables archivos pueden incluir:

```text
HomeScreen.js
NotificationsScreen
NotificationList
NotificationCard
```

pero usar nombres reales encontrados.

Determinar:

```text
COMPONENTE:
ITEM:
PRESS_HANDLER:
```

Comprobar si el elemento realmente tiene:

```text
onPress
Touchable*
Pressable
navigation.navigate
```

o mecanismo equivalente.

---

# AUDITORÍA 5 — RECONOCIMIENTO DEL TYPE

Seguir el valor:

```text
notification.data.type
```

o equivalente.

Determinar el string exacto que produce backend.

Luego el string exacto que espera móvil.

Comparar:

```text
BACKEND_TYPE:
MOBILE_EXPECTED_TYPE:
MATCH: SI/NO
```

Buscar posibles diferencias como:

```text
INSTITUTIONAL_ADMIN_INVITATION
institutional_admin_invitation
INSTITUTIONAL_INVITATION
institutionalInvitation
```

No asumir.

---

# AUDITORÍA 6 — ROUTING

Determinar qué debería suceder al tocar la invitación.

Mostrar flujo:

```text
Notification list
→ handler
→ navigate(...)
→ screen/component
```

Responder:

```text
ROUTE_ESPERADA:
ROUTE_REAL:
PARAMETROS:
```

Comprobar que realmente viaje:

```text
invitationId
```

hasta el destino.

---

# AUDITORÍA 7 — InstitutionalInvitationNotificationCard

Revisar específicamente:

```text
InstitutionalInvitationNotificationCard.js
```

si sigue siendo el componente actual.

Determinar qué propiedades necesita para funcionar.

Ejemplo únicamente conceptual:

```text
notification
invitationId
type
status
```

Documentar las props reales.

Después comparar con lo que recibe desde la lista.

Responder:

```text
PROP_REQUERIDA:
VALOR_RECIBIDO:
FALTA_ALGO:
```

---

# AUDITORÍA 8 — ¿LA TARJETA ESTÁ DISEÑADA PARA ENTRAR?

Confirmar el comportamiento UX real.

Puede existir una diferencia entre:

```text
notificación resumida en lista
```

y:

```text
tarjeta accionable
```

Determinar si al tocar debería:

```text
abrir detalle
```

o si los botones:

```text
Aceptar
Rechazar
```

deberían renderizarse directamente en la lista.

No inventar UX nueva.

Seguir lo implementado.

---

# AUDITORÍA 9 — INICIO ZK

Si el tap sí llega al flujo de invitación:

seguir:

```text
open invitation
→ create invitation auth request
→ Wira/SDK
```

Determinar endpoint real.

Responder:

```text
ENDPOINT_ZK:
SESSION_ID:
CALLBACK:
```

Confirmar que use:

```text
/api/v1/mobile/institutional-authorizations/auth/callback
```

y NO:

```text
official-publication/auth/callback
```

---

# AUDITORÍA 10 — CONTEXTO DE INVITACIÓN

La sesión ZK debe estar vinculada a la invitación correcta.

Confirmar que se preserve:

```text
invitationId
tenantId
DNI/wallet expected
```

según diseño real.

Responder:

```text
SESSION_LINKED_TO_INVITATION: SI/NO
```

---

# AUDITORÍA 11 — API KEY TEMPORAL

Después de validar ZK, determinar cómo obtiene móvil la credencial/contexto temporal.

Seguir:

```text
callback ZK
→ contexto/API key temporal
→ móvil
```

Responder:

```text
API_KEY_GENERADA:
API_KEY_RECIBIDA_POR_APP:
API_KEY_PERSISTIDA_EN_MEMORIA:
```

No imprimir valor real.

---

# AUDITORÍA 12 — DETALLE SEGURO

Localizar el endpoint real que obtiene el detalle de invitación.

Mostrar:

```text
METHOD:
PATH:
AUTH:
PARAM:
```

Determinar qué ocurre al llamar con:

```text
invitationId
API key temporal
```

y qué devuelve.

---

# AUDITORÍA 13 — ESTADO ACTUAL DE LA INVITACIÓN

Antes de culpar navegación, comprobar qué estados admite el backend para abrirla.

Buscar:

```text
PENDING
ACCEPTED
REJECTED
EXPIRED
```

o estados reales.

Determinar si la invitación visible podría estar ya:

```text
ACCEPTED
REJECTED
EXPIRED
```

pero continuar apareciendo en la lista.

Responder:

```text
ESTADO_REQUERIDO_PARA_ABRIR:
ESTADO_REQUERIDO_PARA_ACEPTAR:
```

---

# AUDITORÍA 14 — EXPIRACIÓN

Determinar si existe:

```text
expiresAt
```

o TTL equivalente.

Si la invitación expiró:

* ¿sigue apareciendo en lista?
* ¿el tap está deshabilitado?
* ¿backend devuelve error?
* ¿UI muestra alguna explicación?

No asumir.

---

# AUDITORÍA 15 — NOTIFICACIÓN DUPLICADA / REENVÍO

Ahora existe soporte para:

```text
Reenviar aviso
```

manteniendo el mismo:

```text
invitationId
```

Comprobar qué ocurre si hay dos notificaciones visibles correspondientes a la misma invitación.

Determinar si:

```text
notification A
notification B
→ mismo invitationId
```

y si ambas deberían abrir el mismo detalle.

---

# AUDITORÍA 16 — DEDUPLICACIÓN EN APP

Buscar si la app deduplica por:

```text
notification id
deduplication key
invitationId
```

Determinar si esa lógica puede conservar una versión vieja/incompleta del push y descartar la nueva completa.

---

# AUDITORÍA 17 — ERRORES SILENCIOSOS

Buscar específicamente:

```text
try/catch
.catch
console.error
return null
return
```

dentro del handler de apertura.

Identificar errores que:

```text
ocurren
pero no muestran feedback al usuario
```

Esto podría explicar “toco y no pasa nada”.

---

# AUDITORÍA 18 — ESTADO DE CARGA

Si existe un:

```text
isLoading
loading
pending
```

comprobar si queda permanentemente activado.

Determinar si un fallo anterior deja la tarjeta bloqueada.

---

# AUDITORÍA 19 — GUARDS / AUTH

Comprobar si la pantalla de invitación requiere:

```text
usuario logueado
wallet disponible
sesión móvil
DID
```

y si el usuario actual cumple esas condiciones.

No asumir.

---

# AUDITORÍA 20 — USUARIO AL QUE SE ENVIÓ

Confirmar que:

```text
user_<mobileUserId>
```

corresponda realmente al usuario que está usando la app.

No hace falta exponer IDs reales.

Solo:

```text
DESTINATARIO_FCM_COINCIDE_CON_USUARIO_APP: SI/NO/NO_DETERMINABLE
```

---

# AUDITORÍA 21 — INVITATION ID CORRECTO

Seguir el mismo identificador desde:

```text
Mongo invitation
→ outbox
→ FCM
→ app
→ lista
→ handler
→ ZK request
→ detail
```

Crear tabla:

| Etapa          | invitationId presente | mismo valor |
| -------------- | --------------------: | ----------: |
| DB             |                       |             |
| Outbox         |                       |             |
| FCM            |                       |             |
| App receive    |                       |             |
| List item      |                       |             |
| onPress        |                       |             |
| ZK request     |                       |             |
| Detail request |                       |             |

Este es uno de los resultados más importantes.

---

# AUDITORÍA 22 — PRUEBAS EXISTENTES

Buscar tests de:

```text
InstitutionalInvitationNotificationCard
notification screen
notification press
invitation open
invitation ZK
secure detail
```

Determinar qué parte está probada.

Especialmente buscar si el test actual solo prueba:

```text
render
```

pero no:

```text
tap → abrir
```

---

# AUDITORÍA 23 — REPRODUCCIÓN FOCAL

Si existen tests adecuados, ejecutar solo los necesarios.

No suites globales.

Si es posible reproducir el fallo mediante test existente sin modificarlo, hacerlo.

No crear test en esta auditoría.

---

# POSIBLES CAUSAS A CLASIFICAR

Al terminar escoger una o más:

```text
PRESS_HANDLER_AUSENTE
PRESS_HANDLER_NO_EJECUTA
TYPE_NO_RECONOCIDO
INVITATION_ID_PERDIDO
INVITATION_ID_INCORRECTO
NAVIGATION_INCORRECTA
ROUTE_PARAM_FALTANTE
ZK_REQUEST_FALLA
CALLBACK_FALLA
API_KEY_NO_GENERADA
API_KEY_NO_PROPAGADA
DETAIL_REQUEST_FALLA
INVITATION_EXPIRED
INVITATION_NO_PENDING
GUARD_BLOQUEA
ERROR_SILENCIOSO
OTRA_CAUSA_CONFIRMADA
NO_DETERMINADA
```

---

# IMPORTANTE — NO CONFUNDIR CON ENTREGA

No volver a reportar:

```text
FCM no llega
```

como causa principal si la invitación ya está visible en la app.

Ese tramo ya funciona en el caso observado.

El objetivo es determinar:

```text
POR QUÉ UNA INVITACIÓN YA VISIBLE NO PUEDE ABRIRSE/CONTINUARSE
```

---

# GIT

En móvil:

```bash
git status --short
git diff --stat
```

En backend si se inspecciona:

```bash
git status --short
git diff --stat
```

No modificar nada.

---

# ENTREGABLE FINAL

Responder exactamente:

## A. RESULTADO

Una opción:

```text
CAUSA_RAIZ_CONFIRMADA
CAUSA_RAIZ_PARCIAL
MULTIPLES_CAUSAS
NO_DETERMINADA
```

---

## B. SÍNTOMA EXACTO

Clasificar:

```text
NO_RESPONDE_AL_TAP
NO_NAVEGA
NAVEGA_PERO_FALLA
ZK_FALLA
DETALLE_FALLA
ESTADO_INVALIDO
OTRO
```

Explicar máximo 8 líneas.

---

## C. PUNTO EXACTO DE RUPTURA

```text
ULTIMO_PASO_CORRECTO:
PRIMER_PASO_INCORRECTO:
```

---

## D. FLUJO OBSERVADO

```text
FCM
→ ...
→ FALLO
```

---

## E. PAYLOAD

```text
TYPE:
INVITATION_ID:
TENANT_ID:
DEDUP_KEY:
```

Indicar si cada uno sobrevive desde backend hasta el handler móvil.

---

## F. LISTA DE NOTIFICACIONES

```text
FUENTE:
COMPONENTE:
PRESS_HANDLER:
TYPE_RECONOCIDO:
INVITATION_ID_DISPONIBLE:
```

---

## G. NAVEGACIÓN

```text
ROUTE_ESPERADA:
ROUTE_EJECUTADA:
PARAMETROS:
RESULTADO:
```

---

## H. ZK

```text
ZK_LLEGA_A_INICIARSE: SI/NO
ENDPOINT:
SESSION_ID_CREADA: SI/NO
CALLBACK_INSTITUCIONAL: SI/NO
```

---

## I. DETALLE SEGURO

```text
API_KEY_TEMPORAL: GENERADA/NO_GENERADA/NO_APLICA
DETAIL_REQUEST: EJECUTADO/NO_EJECUTADO
RESULTADO:
```

---

## J. ESTADO DE INVITACIÓN

```text
ESTADO:
EXPIRADA:
ACEPTADA:
RECHAZADA:
ABRIBLE_SEGUN_BACKEND:
```

---

## K. CAUSA RAÍZ

Formato:

```text
CAUSA:
ARCHIVO:
FUNCION:
EVIDENCIA:
```

---

## L. ¿ES MÓVIL O BACKEND?

```text
MOBILE:
BACKEND:
WIRA_SDK:
```

Marcar:

```text
CAUSA
CONSECUENCIA
NO_RELACIONADO
```

---

## M. TESTS EXISTENTES

Tabla:

| Escenario | Test | Cobertura | PASS |
| --------- | ---- | --------- | ---- |

---

## N. COBERTURA FALTANTE

Especialmente responder:

```text
¿EXISTE TEST TAP_NOTIFICACION → APERTURA_INVITACION?
```

---

## O. CORRECCIÓN RECOMENDADA

NO IMPLEMENTAR.

Separar:

```text
OBLIGATORIA
RECOMENDADA
OPCIONAL
```

Solo cambios respaldados por evidencia.

---

## P. ARCHIVOS QUE HABRÍA QUE MODIFICAR

Solo listar candidatos confirmados.

No modificarlos.

---

## Q. CONFIRMACIÓN DE AUDITORÍA

```text
CAMBIOS_MOVIL: 0
CAMBIOS_BACKEND: 0
CAMBIOS_WIRA: 0
TESTS_MODIFICADOS: 0
CONFIG_MODIFICADA: 0
COMMITS_REALIZADOS: 0
AUDITORIA_SOLAMENTE: SI
```

---

# PRINCIPIO FINAL

El punto inicial de esta auditoría es:

```text
INVITACION_YA_VISIBLE_EN_APP
```

No gastar tiempo rediagnosticando la entrega FCM completa.

Seguir el mismo `invitationId` hasta encontrar exactamente dónde deja de ser utilizable:

```text
lista
→ tap
→ navegación
→ ZK
→ detalle
```

**NO CORREGIR NADA TODAVÍA.**
