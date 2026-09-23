# SICA — Programación de Producción de Semirremolques

App fullstack para la programación (scheduling) de producción de semirremolques de SICA Metalúrgica Argentina. Migrada desde `SICA_Programacion.html` (single-file, `localStorage`) a backend Node.js + PostgreSQL + frontend estático.

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
