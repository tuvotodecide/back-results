# IMPLEMENTACIÓN FOCAL — Abrir y continuar invitaciones institucionales desde la app móvil

## OBJETIVO

Corregir el defecto confirmado por auditoría:

```text
La invitación institucional llega correctamente
→ aparece en la lista de notificaciones
→ contiene type + invitationId + tenantId
→ pero al tocarla NO navega
```

La causa confirmada es que el routing móvil no reconoce:

```text
INSTITUTIONAL_ADMIN_INVITATION
```

Por tanto:

```text
buildNotificationNavigationTarget()
→ retorna null
→ handleNotificationPress()
→ return silencioso
```

El flujo backend, FCM, invitationId y tarjeta de invitación ya existen.

Esta tarea debe conectar correctamente esas piezas.

---

# REPOSITORIO

```text
C:\apps\electoral-app
```

---

# ALCANCE PRINCIPAL

Archivos confirmados por auditoría:

```text
src/container/TabBar/Home/Notification.js
src/notifications.js
__tests__/unit/containers/TabBar/Home/Notification.routing.test.js
```

Puede modificarse un test adicional de `NotificationDetailScreen` únicamente si es necesario para cubrir correctamente el type real.

No modificar Backend Results.

No modificar Wira SDK.

No modificar Identity.

---

# CONTEXTO FUNCIONAL YA CONFIRMADO

Backend envía:

```text
type = INSTITUTIONAL_ADMIN_INVITATION
invitationId
tenantId
deduplicationKey
```

La notificación llega correctamente y el historial remoto conserva esos campos.

La pantalla de detalle YA reconoce:

```text
INSTITUTIONAL_ADMIN_INVITATION
```

y puede renderizar:

```text
InstitutionalInvitationNotificationCard
```

La tarjeta YA contiene el flujo para:

```text
ZK
→ detalle seguro
→ aceptar
→ rechazar
```

Por tanto:

**NO reimplementar la tarjeta.**

**NO reimplementar ZK.**

**NO modificar backend.**

---

# DEFECTO 1 — LISTA DE NOTIFICACIONES

Archivo:

```text
src/container/TabBar/Home/Notification.js
```

Funciones relevantes:

```text
buildNotificationNavigationTarget()
handleNotificationPress()
```

Actualmente `buildNotificationNavigationTarget()` maneja otros tipos pero no:

```text
INSTITUTIONAL_ADMIN_INVITATION
```

Agregar soporte explícito.

---

# RESULTADO ESPERADO

Para:

```text
notification.data.type === 'INSTITUTIONAL_ADMIN_INVITATION'
```

debe resolverse un target equivalente al utilizado por las demás notificaciones que abren detalle:

```text
VotingNotificationDetailScreen
```

con parámetros:

```text
{
  notification: item
}
```

El objeto completo debe conservar:

```text
item.data.invitationId
item.data.tenantId
item.data.type
```

No reconstruir un objeto parcial si no es necesario.

---

# FLUJO ESPERADO DESDE LA LISTA

Debe quedar:

```text
Notification.js
→ usuario toca elemento
→ handleNotificationPress(item)
→ buildNotificationNavigationTarget(item)
→ reconoce INSTITUTIONAL_ADMIN_INVITATION
→ navigation.navigate(
     'VotingNotificationDetailScreen',
     { notification: item }
   )
→ NotificationDetailScreen
→ InstitutionalInvitationNotificationCard
```

---

# DEFECTO 2 — TAP DESDE PUSH DEL SISTEMA

La auditoría encontró un defecto equivalente en:

```text
src/notifications.js
```

Función relevante:

```text
buildRouteFromNotification()
```

o función real equivalente.

Actualmente tampoco reconoce:

```text
INSTITUTIONAL_ADMIN_INVITATION
```

y puede terminar enviando a:

```text
Splash
```

o ruta fallback.

Corregir también este camino.

---

# RESULTADO ESPERADO DESDE PUSH

Cuando el usuario toca directamente una push institucional:

```text
push
→ data.type = INSTITUTIONAL_ADMIN_INVITATION
→ routing
→ VotingNotificationDetailScreen
→ notification completa
→ InstitutionalInvitationNotificationCard
```

No mandar a Splash como fallback cuando el tipo es válido y conocido.

---

# NO CAMBIAR EL TYPE

El type canónico es:

```text
INSTITUTIONAL_ADMIN_INVITATION
```

No crear aliases innecesarios como:

```text
INVITATION_CREATED
INSTITUTIONAL_INVITATION
ADMIN_INVITATION
```

salvo que haya compatibilidad legacy demostrada y ya existente.

El backend y el móvil deben utilizar el mismo type canónico.

---

# NO PERDER invitationId

Este dato es crítico.

Comprobar que después del routing siga disponible:

```text
route.params.notification.data.invitationId
```

o la estructura real usada por `NotificationDetailScreen`.

No convertir la navegación en:

```text
{ id: notification.id }
```

si eso pierde:

```text
data.invitationId
```

---

# FLUJO DESPUÉS DE ABRIR

No inventar un flujo nuevo.

La tarjeta existente debe seguir haciendo:

```text
invitationId
→ solicitar request ZK institucional
→ validar identidad
→ callback institucional
→ recibir contexto/API key temporal
→ GET detalle seguro
→ mostrar información
→ aceptar/rechazar
```

No mover esa lógica a `Notification.js`.

---

# COMPORTAMIENTO DE ACCEPT

No modificarlo salvo que una prueba demuestre un defecto independiente.

El contrato actual esperado es:

```text
Usuario acepta
→ invitation = ACCEPTED
→ application = PENDING_APPROVAL
```

NO:

```text
accept
→ assignment APPROVED
```

NO conceder acceso inmediato.

---

# USUARIO ACTUAL

Para el escenario actual:

```text
la invitación ya llegó a la app
```

por tanto el usuario móvil ya fue resuelto para esa entrega.

No implementar un nuevo registro de usuario dentro de la pantalla de detalle.

La aceptación debe trabajar con la identidad existente y continuar el proceso institucional.

---

# TEST 1 — ROUTING DESDE LISTA

Agregar un caso en:

```text
__tests__/unit/containers/TabBar/Home/Notification.routing.test.js
```

con:

```text
data: {
  type: 'INSTITUTIONAL_ADMIN_INVITATION',
  invitationId: '...',
  tenantId: '...'
}
```

Ejecutar tap real del elemento.

Comprobar:

```text
navigation.navigate
```

con:

```text
VotingNotificationDetailScreen
```

y:

```text
notification.data.invitationId
```

preservado.

---

# TEST 2 — NO NULL TARGET

Probar específicamente:

```text
buildNotificationNavigationTarget(
  INSTITUTIONAL_ADMIN_INVITATION
)
```

o mediante la interfaz pública real del componente.

Debe resolver un destino válido.

No basta con comprobar simplemente:

```text
navigation.navigate called
```

Debe verificar:

```text
route correcta
notification correcta
invitationId correcto
```

---

# TEST 3 — TAP DESDE NOTIFICACIÓN DEL SISTEMA

Agregar/actualizar prueba para:

```text
src/notifications.js
```

si ya existe archivo de tests correspondiente.

Con:

```text
INSTITUTIONAL_ADMIN_INVITATION
```

debe producir:

```text
VotingNotificationDetailScreen
```

No:

```text
Splash
```

---

# TEST 4 — DETAIL SCREEN

Confirmar que:

```text
NotificationDetailScreen
```

con:

```text
notification.data.type =
INSTITUTIONAL_ADMIN_INVITATION
```

renderiza:

```text
InstitutionalInvitationNotificationCard
```

Si ya existe un test equivalente pero utiliza únicamente:

```text
INVITATION_CREATED
```

agregar cobertura del **type canónico real**.

No reemplazar compatibilidad legacy si todavía se necesita.

---

# TEST 5 — invitationId

Debe existir al menos una prueba que confirme la cadena:

```text
notification
→ navigation params
→ detail
```

con el mismo:

```text
invitationId
```

No mockearlo con otro valor en cada etapa.

---

# ERROR SILENCIOSO

Actualmente:

```text
target = null
→ return
```

oculta completamente el problema.

Para un `type` conocido como:

```text
INSTITUTIONAL_ADMIN_INVITATION
```

esto ya no debe suceder.

No es obligatorio rediseñar el manejo genérico de tipos desconocidos.

Por tanto:

```text
UNKNOWN_TYPE
```

puede conservar su comportamiento actual si no pertenece al alcance.

---

# LOCAL NOTIFICATION STORAGE LEGADO

La auditoría encontró que un almacenamiento legado puede descartar `data`.

NO modificarlo en esta tarea salvo que una prueba demuestre que sigue participando en el camino actual que acaba de fallar.

El caso real observado proviene del historial remoto, donde:

```text
invitationId
```

sí está presente.

Evitar ampliar alcance.

---

# ZK

No modificar:

```text
SDK
proof
circuits
callback
session TTL
API key
```

En esta tarea solo necesitamos que el usuario pueda llegar a la tarjeta.

---

# BACKEND

NO modificar.

La auditoría confirmó:

```text
backend payload correcto
historial remoto correcto
invitationId presente
tenantId presente
```

El defecto confirmado está en Mobile.

---

# PRUEBAS FOCALES

Ejecutar como mínimo los tests reales relacionados con:

```text
Notification routing
NotificationDetailScreen
InstitutionalInvitationNotificationCard
notifications.js routing
```

No ejecutar suite móvil completa inicialmente.

Después ejecutar la matriz/módulo móvil correspondiente si existe.

---

# PRUEBA MANUAL ESPERADA DESPUÉS DEL FIX

Debe poder hacerse:

```text
1. Administrador envía invitación.
2. Push llega al teléfono.
3. Invitación aparece en notificaciones.
4. Usuario toca la invitación.
5. Se abre VotingNotificationDetailScreen.
6. Se renderiza InstitutionalInvitationNotificationCard.
7. Se inicia el flujo ZK.
8. Se cargan los datos protegidos.
9. Usuario puede Aceptar o Rechazar.
```

---

# SI ACCEPT FUNCIONA

El resultado esperado después de aceptar es:

```text
invitation = ACCEPTED
application = PENDING_APPROVAL
```

Eso significa:

```text
todavía NO tiene acceso institucional
```

Después corresponde:

```text
Administrador aprueba
→ autorización móvil
→ firma/reconciliación
→ assignment APPROVED + active
```

---

# NO CONFUNDIR "ACEPTAR" CON "REGISTRARSE"

Para un usuario ya registrado:

```text
Aceptar invitación
```

NO significa:

```text
crear usuario nuevo
```

Significa:

```text
aceptar incorporación a esa institución
→ crear/continuar solicitud institucional
```

No agregar formulario de registro al flujo si el usuario actual ya existe.

---

# GIT

Antes:

```bash
git status --short
git diff --stat
```

No modificar cambios preexistentes.

No:

```text
reset
restore
checkout
stash
clean
commit
push
```

---

# CRITERIOS DE ACEPTACIÓN

```text
CA-01
INSTITUTIONAL_ADMIN_INVITATION es reconocido desde la lista.

CA-02
Tap navega a VotingNotificationDetailScreen.

CA-03
notification completa se conserva.

CA-04
invitationId llega al detalle.

CA-05
tenantId se conserva.

CA-06
El mismo type funciona desde tap del push del sistema.

CA-07
No cae a Splash para ese type.

CA-08
NotificationDetailScreen renderiza InstitutionalInvitationNotificationCard.

CA-09
ZK puede empezar desde la tarjeta existente.

CA-10
No se modifica Backend Results.

CA-11
No se modifica Wira SDK.

CA-12
No se modifica contrato de aceptación.

CA-13
Tests focales PASS.

CA-14
CERO_FALSE_PASS.
```

---

# ENTREGABLE FINAL

## A. RESULTADO

Una opción:

```text
IMPLEMENTADO_Y_VERIFICADO
IMPLEMENTADO_CON_LIMITACION
BLOQUEADO_POR_NUEVA_CAUSA
```

---

## B. CAUSA

```text
TYPE:
ROUTER:
COMPORTAMIENTO_ANTERIOR:
COMPORTAMIENTO_NUEVO:
```

---

## C. LISTA

```text
TYPE_RECONOCIDO:
ROUTE:
INVITATION_ID_PRESERVADO:
TENANT_ID_PRESERVADO:
```

---

## D. PUSH DEL SISTEMA

```text
TYPE_RECONOCIDO:
ROUTE:
FALLBACK_SPLASH:
```

---

## E. DETAIL

```text
SCREEN:
COMPONENTE:
INVITATION_ID_RECIBIDO:
```

---

## F. ZK

```text
FLUJO_ZK_MODIFICADO: NO
PUEDE_INICIARSE_DESDE_DETAIL: SI/NO
```

---

## G. ACCEPT

```text
ACCEPT_MODIFICADO: NO
ESTADO_ESPERADO_DESPUES_ACCEPT:
```

Esperado:

```text
PENDING_APPROVAL
```

---

## H. ARCHIVOS MODIFICADOS

Tabla exacta.

---

## I. TESTS

Tabla:

| Test | Escenario | PASS |
| ---- | --------- | ---: |

---

## J. EJECUCIONES

Comandos y resultados.

---

## K. ALCANCE

```text
BACKEND_MODIFICADO: NO
WIRA_MODIFICADO: NO
ZK_MODIFICADO: NO
IDENTITY_MODIFICADO: NO
```

---

## L. CONFIRMACIÓN FINAL

```text
INVITACION_VISIBLE: SI
INVITACION_ABRIBLE: SI/NO
ROUTING_LISTA_PASS: SI/NO
ROUTING_PUSH_PASS: SI/NO
INVITATION_ID_LLEGA_A_DETAIL: SI/NO
CARD_RENDERIZA: SI/NO
ZK_PUEDE_INICIAR: SI/NO
TESTS_PASS: SI/NO
CERO_FALSE_PASS: SI/NO
COMMITS_REALIZADOS: 0
```

---

# PRINCIPIO FINAL

No reimplementar invitaciones.

Las piezas ya existen:

```text
FCM ✅
payload ✅
historial ✅
invitationId ✅
detail screen ✅
invitation card ✅
ZK ✅
accept/reject ✅
```

El hueco confirmado es:

```text
ROUTING ❌
```

Conectar correctamente:

```text
INSTITUTIONAL_ADMIN_INVITATION
→ VotingNotificationDetailScreen
→ InstitutionalInvitationNotificationCard
```

y preservar el flujo existente.
