# SICA — Programación de Producción de Semirremolques

App fullstack para la programación (scheduling) de producción de semirremolques de SICA Metalúrgica Argentina. Migrada desde `SICA_Programacion.html` (single-file, `localStorage`) a backend Node.js + PostgreSQL + frontend estático.

## Estado del proyecto / Pendientes

- Esta es una migración recién completada de una app single-file con `localStorage`. Queda una lista completa de decisiones pendientes (hostname definitivo, si conservar `xreset`, confirmación del motor de DB, puertos del host) en la sección final de `docs/superpowers/plans/2026-09-23-migracion-fullstack.md`.
- `docs/nginx-externo-programacion.conf` es un snippet PROPUESTO, NO APLICADO y NO VERIFICADO para el nginx externo del servidor de producción. No fue probado contra la config real del servidor `sicalab` y necesita revisión/ajuste manual antes de usarse — en particular, si ese nginx externo corre en un contenedor, `proxy_pass http://localhost:3010` probablemente deba cambiarse por la IP real del host o una red Docker compartida en lugar de `localhost`.
- No fue posible hacer testing real en navegador durante el desarrollo (no había herramienta de automatización de navegador disponible en el entorno). El render del Gantt, las interacciones de drag y la persistencia real de ediciones tras un F5 NO fueron verificadas manualmente en un navegador real. Antes de exponer esto a usuarios reales hace falta un smoke test manual: (1) el Gantt renderiza correctamente, (2) editar una orden y recargar (F5) muestra el cambio guardado, (3) disparar dos scheduling runs al mismo tiempo no corrompe datos (prueba el lock de concurrencia bajo contención real).
- Si no se crea `.env` a partir de `.env.example` antes del primer deploy, `docker-compose.yml` cae en una contraseña de base de datos por defecto (`sica_secure_pass`) hardcodeada en el compose. Ese default DEBE cambiarse para cualquier uso más allá de pruebas locales.

## Requisitos

- Docker y Docker Compose
- (Opcional, para desarrollo local) Node.js 20+, PostgreSQL 16

## Inicio rápido

```bash
cp .env.example .env
# Editar .env con valores reales en producción

docker compose up -d --build

# Esperar ~15s a que la DB inicialice, luego cargar el dataset real
docker exec sica_semis_backend node seed.js

# Frontend: http://localhost:3010
# Backend:  http://localhost:3011/api/health
```

## Reconstrucción de contenedores

Reconstruir los contenedores borra el volumen de datos si se borra `./data/postgres` a mano; si NO se borra ese directorio, los datos persisten entre `docker compose up --build`. Para reponer datos desde cero:

```bash
docker exec sica_semis_backend node seed.js
```

## Estructura del proyecto

- **backend/**: API REST (Express + PostgreSQL) + motor de scheduling portado (`src/services/schedulerCore.js`)
- **frontend/**: HTML/JS estático (sin build step), servido por nginx
- **docker-compose.yml**: orquestación de los 3 servicios

## Endpoints principales

- `GET /api/state` — hidratación completa (equivalente al `DB` del HTML original)
- CRUD por entidad: `/api/orders`, `/api/resources`, `/api/resource-groups`, `/api/operations`, `/api/sequences`
- `GET/PUT /api/calendar`, `GET/PUT /api/sim` — configuración global (singleton)
- `POST /api/schedule/run` — `{target: 'all'|orderId, respectCap, strictPrio}`, serializado con lock en memoria
- `GET /api/backup`, `POST /api/backup/import` — export/import completo (función administrativa)
