# Migrar "SICA Semirremolques" (programacion-semis) a app dockerizada fullstack

## Contexto

Tengo una app de programación de producción de semirremolques para SICA Metalúrgica Argentina, hoy implementada como **un único archivo HTML autocontenido** (`SICA_Programacion.html`, ~3300 líneas), sin build step, con:

- Bootstrap 5 + Bootstrap Icons + Chart.js + SheetJS (xlsx), todo por CDN.
- Todo el render hecho con template strings inyectados vía `innerHTML` (funciones `renderDash`, `renderOrders`, `renderGantt`, `renderRes`, `renderSeqs`, `renderConfig`, `renderOTDetail`).
- Todo el estado en un único objeto `DB` en memoria, con `loadDB()`/`saveDB()` leyendo/escribiendo `localStorage` (clave `sica_v6`). Los datos iniciales están embebidos como constante `INITIAL` en el JS.
- Un **motor de scheduling propio** (CPM con predecesoras, prioridad estricta por recurso con aprovechamiento de huecos, grupos de recursos, calendario maestro + ausencias por recurso, fases previas a fabricación con capacidad propia de ingeniería, "unidad equivalente" de carga de trabajo). Funciones clave: `doSchedule`, `resolveGroupRes`, `effRanges`, `otOps`, `effPreds`, `parsePreds`. Toda esta lógica es JS puro (no toca el DOM), lo cual facilita portarla.

Repo actual (desactualizado respecto a los datos reales): https://github.com/Hernan96HMM/programacion-semis
Te adjunto los dos archivos reales y actualizados:
- `SICA_Programacion.html` — el código completo de la app actual.
- `sica_2026-09-23.json` — export real de `DB` (más completo que el `INITIAL` embebido en el HTML: 38 orders, 33 resources, 12 sequences, 2 resourceGroups, calendar, sim).

## Por qué migrar

`localStorage` significa que cada navegador tiene su propia copia de los datos: no hay persistencia real compartida, no hay backups automáticos (solo export/import manual de JSON), y no se puede usar desde varios dispositivos ni por varias personas de forma consistente.

**Uso real esperado: varias personas editando al mismo tiempo.** Esto es importante para el diseño — no alcanza con "subir el objeto DB tal cual a un servidor", porque `doSchedule()` reescribe el `scheduledOps` de TODAS las órdenes activas de una vez, y dos ejecuciones simultáneas de esa función pueden pisarse y corromper el Gantt.

**No hace falta login ni roles** — acceso libre dentro de la red interna, sin autenticación (a diferencia del proyecto hermano `modelo-incentivos`, que sí tiene roles `admin_rrhh`/`gerente`).

## Precedente: proyecto "Modelo de Incentivos"

Ya migramos un caso similar (Excel → web app) para el mismo cliente, y esta migración debería seguir las mismas convenciones de infraestructura:

- Deploy en el servidor Linux local de Hernán, **sicalab** (IP `192.168.0.195`), bajo `/mnt/disco1/sicalab/<nombre-proyecto>/`.
- Stack: Docker Compose, backend Node.js, frontend servido vía nginx.
- Reverse proxy: el nginx principal del server (`/mnt/disco1/sicalab/nginx/nginx.conf`) enruta por hostname interno (ej. `incentivos.sica`, `inducciones.sica`). Para este proyecto, proponé un hostname del estilo `semirremolques.sica` o `programacion.sica` (confirmá con Hernán el nombre final).
- **Lección aprendida de incentivos**: hubo un problema de doble-proxy, resuelto ruteando TODO el tráfico (incluyendo `/api`) a través del nginx interno del contenedor de frontend, en vez de partir el ruteo a nivel del nginx externo. Replicá ese patrón acá para evitarlo desde el arranque.
- **Otra lección**: reconstruir los contenedores Docker borra la base — el seed debe poder re-ejecutarse fácilmente después de cada rebuild (`docker exec <backend> node seed.js` o equivalente).
- Si no es evidente qué motor de base de datos usa `modelo-incentivos`, preguntale a Hernán antes de decidir (para reusar el mismo si tiene sentido, en vez de sumar una tecnología nueva al servidor).

## Arquitectura objetivo

### Backend

Node.js + base de datos real, con **endpoints por entidad** (no un blob único), reflejando el modelo de datos del `DB` actual:

- `orders` — pedidos/órdenes de fabricación. Revisá bien el HTML para el detalle completo de campos por-OT: `id`, `orderNum`, `unitNum`, `peInicial`, `client`, `productType`, `progress`, `status`, `dueDate`, `notes`, `ganttWeeks`, `updatedAt`, `isSim`, `priority`, `seqId`, `uEq`, `simLeadOC`/`simLeadEng`, `plannedStart`, `opDays`, `opResources`, `opProgress`, `opPreds`, `opExtra`, `opOrder`, `opSkip`, `opManualStarts`, `scheduledOps` (resultado del scheduling, calculado — no es input del usuario), `startDate`, `endDate`, `_simBaseDate`, `_ocEnd`, `_engStart`, `_engEnd`, `_simBaseOT`.
- `resources` — `id`, `name`, `color`, `capacity`, `active`, `absences[]` (con `from`, `to`, tipo).
- `resourceGroups` — `id`, `name`, `members[]` (ids de resources).
- `operations` — catálogo de nombres de operaciones (lista simple de strings).
- `sequences` — plantillas de secuencia de fabricación por modelo de producto: `id`, `name`, `ops[]` (cada op con `name`, `res`, `dur`, `from`, `to`, `days`, `preds` opcional).
- `calendar` — `workDays[]`, `hoursPerDay`, `holidays[]` (calendario maestro, no por recurso).
- `sim` — parámetros globales de simulación: `modelLeads[]` (leads por modelo), `leadOC`, `leadEng`, `engCap`, `targetUEq`, `modelUEq[]`.

CRUD estándar para cada entidad (GET/POST/PUT/DELETE), manteniendo el resto de la lógica de negocio (`getUEq`, `getSimLead`, `calcStatus`, `effRanges`, `otOps`, etc.) tal como está, portada a funciones de servicio en el backend, reusables tanto por los endpoints CRUD como por el scheduler.

### Motor de scheduling — server-side, con lock

- Portá `doSchedule`, `resolveGroupRes`, `effRanges`, `otOps`, `effPreds`, `parsePreds`, y las utilidades de calendario (`calDiff`, `addCalDays`, `isWD`, `nextWD`, `addWDs`) al backend, prácticamente 1:1 (es JS puro, no depende del DOM).
- Exponé esto como `POST /api/schedule/run` (con parámetro para "todas las órdenes" vs. una OT puntual, y los flags `respectCap`/`strictPrio` que hoy vienen del modal `mSched`).
- Este endpoint debe correr dentro de una transacción o lock (ej. advisory lock de Postgres, o un mutex en memoria si el backend corre en un solo proceso) para que dos disparos simultáneos se serialicen en vez de pisar resultados. Devolvé al front el resultado actualizado de `scheduledOps` por orden.
- La simulación "what-if" de capacidad (`whatIfCapacity` — usa `_noPersist=true` y restaura el estado al final, no escribe nada) puede seguir corriendo en el cliente sin cambios, ya que no persiste nada — pero si se porta también al backend por consistencia, mejor aún (a tu criterio, no es crítico).

### Frontend

- El grueso del código de render y de UI (`renderDash`, `renderOrders`, `renderGantt`, `renderRes`, `renderSeqs`, `renderConfig`, `renderOTDetail`, y todos los modales) puede conservarse casi intacto — es la parte de mayor volumen y ya está probada.
- Cambios necesarios:
  - `loadDB()`/`saveDB()` dejan de tocar `localStorage` y pasan a hidratar `DB` desde la API al cargar, y cada mutación puntual pega contra su endpoint correspondiente en vez de mutar `DB` en memoria y llamar a `saveDB()` global.
  - Localizá y adaptá **todos los puntos de escritura**: `saveOrder`, `delO`, `saveRes`, `delR`, `saveSeq`, `delSq`, `addOpN`, `delOp`, `togWD`, `addHol`, `delHol`, `saveSimParams`, `openGM`/`saveGrp`/`delGrp`, `addAbs`/`delAbs`, y el propio `doSchedule` (que pasa a ser una llamada a `POST /api/schedule/run` en vez de cálculo local).
  - `xport()` (backup manual) y `xmport()` (restaurar desde JSON) pueden mantenerse como utilidades de import/export contra la API (por ejemplo, `xmport` podría pegarle a un endpoint de "bulk restore" que reemplaza todo el dataset — usalo con cuidado, dejalo como función administrativa).
  - `xreset()` (restaurar a los datos originales del `INITIAL`) — evaluá si tiene sentido mantenerlo una vez migrado a base de datos real, o si conviene retirarlo (el `INITIAL` embebido pierde sentido cuando el server es la fuente de verdad).
- Serví el frontend vía nginx dentro del contenedor, como en incentivos.

### Migración de datos existentes

- Usá `sica_2026-09-23.json` como fuente de verdad para el seed inicial (es el dataset real, más completo que el `INITIAL` del HTML).
- Escribí un `seed.js` (mismo patrón que en incentivos) que cargue ese JSON a la base de datos nueva.

## Qué necesito que entregues

1. Estructura del proyecto (backend Node.js + frontend + Docker Compose), siguiendo las convenciones de `modelo-incentivos`.
2. Modelo de datos / esquema de base de datos para las entidades listadas arriba.
3. Backend con endpoints CRUD por entidad + `POST /api/schedule/run` con el motor de scheduling portado.
4. `seed.js` que carga `sica_2026-09-23.json`.
5. Frontend adaptado (mínima reescritura posible del render/UI existente, cambiando solo la capa de persistencia).
6. Config de nginx (interno del contenedor de frontend, ruteando `/api` también) y entrada sugerida para el nginx externo del server.
7. Un resumen al final de qué decisiones tomaste y qué me falta confirmar (ej. motor de DB, nombre de host, si mantener `xreset`).

Si en algún punto no tenés suficiente contexto sobre cómo está armado `modelo-incentivos` en el server (motor de DB, estructura exacta de carpetas, config de nginx externo), preguntame antes de asumir — tengo acceso al server y puedo confirmarlo.
