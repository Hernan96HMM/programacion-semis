# Migración SICA Programación Semis a app dockerizada fullstack — Plan de Implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Migrar `SICA_Programacion.html` (single-file HTML/JS con `localStorage`) a una app fullstack dockerizada (Node.js + PostgreSQL + frontend estático vía nginx), preservando el motor de scheduling y el 99% del render/UI existente, y habilitando edición concurrente segura.

**Architecture:** Backend Express + `pg` con endpoints CRUD por entidad (orders, resources, resourceGroups, operations, sequences, calendar, sim) más `POST /api/schedule/run` que ejecuta el motor de scheduling portado 1:1 desde el HTML, serializado con un mutex en memoria. El frontend conserva el archivo único (`index.html`) con Bootstrap 5 + Chart.js + SheetJS por CDN; solo cambia la capa de persistencia (`loadDB`/`saveDB` y cada punto de escritura pasan a pegarle a la API en vez de `localStorage`). Todo corre en Docker Compose (db/backend/frontend), siguiendo el patrón de `modelo-incentivos`.

**Tech Stack:** Node.js 20 + Express 4 + `pg` 8 (PostgreSQL 16) en el backend; HTML/JS vanilla + Bootstrap 5.3.2 + Chart.js 4.4.1 + SheetJS 0.20.3 (CDN, sin build step) en el frontend; nginx:alpine sirviendo el frontend y proxyeando `/api`; Docker Compose orquestando los tres servicios.

**Spec:** `prompt-migracion-programacion-semis.md` (raíz del repo) — este plan implementa punto por punto la sección "Qué necesito que entregues".

## Global Constraints

- Sin autenticación ni roles (a diferencia de `modelo-incentivos`) — todos los endpoints quedan abiertos dentro de la red interna.
- Motor de DB: **PostgreSQL 16**, confirmado por inspección directa de `modelo-incentivos/backend/src/db.js` y `docker-compose.yml` (reutilizamos la misma imagen y el mismo patrón de migraciones SQL secuenciales vía `migrate.js`).
- Lock de scheduling: **mutex en memoria** (no advisory lock de Postgres) — el backend corre en un solo proceso Node (un solo `CMD node src/index.js` en el Dockerfile, igual que incentivos), así que un mutex simple alcanza y evita la complejidad de manejar una conexión dedicada para `pg_advisory_lock`. Documentado como decisión a confirmar en el resumen final.
- Nombres de contenedores/servicios con prefijo `sica_semis_` (no `sica_` a secas) para no colisionar con los contenedores de `modelo-incentivos` (`sica_db`, `sica_backend`, `sica_frontend`) que corren en el mismo host `sicalab`.
- Puertos de host: frontend `3010:80`, backend `3011:3001`, DB **sin publicar a host** (solo accesible en la red interna de Docker Compose — mejora sobre incentivos, que sí expone 5432). Evita colisión con los puertos 3000/3001/5432 que ya usa incentivos en el mismo server.
- `frontend/` **no tiene build step** (a diferencia del frontend React/Vite de incentivos): es HTML/JS servido tal cual por nginx, igual que hoy. Desviación intencional respecto al precedente, documentada en el resumen final.
- No se agrega el módulo `whatIfCapacity` al backend — sigue corriendo 100% en cliente, tal como está hoy (el propio prompt lo marca como no crítico).
- `xreset()` (restaurar al `INITIAL` embebido) se **retira** del frontend: con Postgres como fuente de verdad, restaurar significa re-correr `seed.js`, no un dato embebido en el JS. Documentado como decisión a confirmar.
- Todos los nombres de columnas nuevas en Postgres usan `snake_case`; los mappers en `backend/src/mappers.js` traducen a/desde el `camelCase` que ya usa el HTML, así el resto del JS del frontend no cambia.
- Sin framework de tests existente en `modelo-incentivos` (no hay `tests/` ni `jest` en su `package.json`). Seguimos esa convención para las rutas CRUD (verificación manual vía `curl` contra el compose corriendo). La única excepción es el motor de scheduling (Task 3): por ser lógica pura, crítica y 100% portable, se cubre con `node:test` (sin dependencias nuevas — viene en Node 20).

---

## File Structure

```
programacion-semis/
├── SICA_Programacion.html          # se mantiene sin tocar como referencia histórica
├── sica_2026-09-23.json            # dataset real, fuente del seed
├── backend/
│   ├── Dockerfile
│   ├── package.json
│   ├── seed.js
│   └── src/
│       ├── db.js
│       ├── index.js
│       ├── migrate.js
│       ├── mappers.js
│       ├── migrations/
│       │   └── 001_initial.sql
│       ├── services/
│       │   ├── calendarUtils.js
│       │   ├── schedulerCore.js
│       │   ├── schedulerCore.test.js
│       │   └── lock.js
│       └── routes/
│           ├── state.js
│           ├── orders.js
│           ├── resources.js
│           ├── resourceGroups.js
│           ├── operations.js
│           ├── sequences.js
│           ├── calendar.js
│           ├── sim.js
│           ├── schedule.js
│           └── backup.js
├── frontend/
│   ├── Dockerfile
│   ├── nginx.conf
│   └── index.html                  # copia adaptada de SICA_Programacion.html
├── docker-compose.yml
├── .env.example
├── .gitignore
└── README.md
```

Decisiones de decomposición:
- **Un archivo de ruta por entidad** (`orders.js`, `resources.js`, ...) — mismo patrón que `modelo-incentivos/backend/src/routes/*.js`. Cada uno es autocontenido y CRUD estándar.
- **`mappers.js` centralizado**: todas las rutas y `seed.js` traducen fila↔objeto con las mismas funciones, para que un cambio de esquema no rompa la traducción en 8 lugares distintos.
- **`services/` separado de `routes/`**: el motor de scheduling (`schedulerCore.js`) es JS puro sin acceso a DB — se testea aislado y se invoca desde `routes/schedule.js`, que sí sabe de DB/HTTP. Mismo principio que ya tenía el HTML original (la lógica de scheduling no toca el DOM).
- **`frontend/index.html` como copia editada**, no un `index.html` nuevo desde cero — minimiza reescritura del render/UI ya probado, tal como pide el prompt.

---

### Task 1: Esquema de base de datos + `db.js` + `migrate.js`

**Files:**
- Create: `backend/package.json`
- Create: `backend/src/db.js`
- Create: `backend/src/migrate.js`
- Create: `backend/src/migrations/001_initial.sql`
- Create: `.env.example`
- Create: `.gitignore`

**Interfaces:**
- Produces: `db.query(text, params)`, `db.getClient()`, `db.pool` (mismo shape que `modelo-incentivos/backend/src/db.js`) — usado por todas las rutas y por `seed.js`.
- Produces: `runMigrations()` default export de `migrate.js`, invocado por `index.js` (Task 4) antes de levantar el server.

- [ ] **Step 1: Crear `backend/package.json`**

```json
{
  "name": "sica-semis-backend",
  "version": "1.0.0",
  "main": "src/index.js",
  "scripts": {
    "start": "node src/index.js",
    "dev": "nodemon src/index.js",
    "seed": "node seed.js",
    "migrate": "node src/migrate.js",
    "test": "node --test src/services/*.test.js"
  },
  "dependencies": {
    "cors": "^2.8.5",
    "express": "^4.18.2",
    "pg": "^8.11.3"
  },
  "devDependencies": {
    "nodemon": "^3.0.1"
  }
}
```

- [ ] **Step 2: Crear `backend/src/db.js`**

```js
const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://sica:sica_secure_2024@localhost:5432/sica_semis',
});

pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
});

module.exports = {
  query: (text, params) => pool.query(text, params),
  getClient: () => pool.connect(),
  pool,
};
```

- [ ] **Step 3: Crear `backend/src/migrations/001_initial.sql`**

```sql
-- Resources
CREATE TABLE IF NOT EXISTS resources (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  capacity INTEGER NOT NULL DEFAULT 2,
  active BOOLEAN NOT NULL DEFAULT true,
  absences JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Resource groups
CREATE TABLE IF NOT EXISTS resource_groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  members JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Operations catalog (autocomplete list, no relational meaning)
CREATE TABLE IF NOT EXISTS operations (
  name TEXT PRIMARY KEY
);

-- Sequences (production templates per product model)
CREATE TABLE IF NOT EXISTS sequences (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  ops JSONB NOT NULL DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Calendar (singleton row)
CREATE TABLE IF NOT EXISTS calendar (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  work_days JSONB NOT NULL DEFAULT '[1,2,3,4,5]',
  hours_per_day INTEGER NOT NULL DEFAULT 8,
  holidays JSONB NOT NULL DEFAULT '[]'
);
INSERT INTO calendar (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Simulation params (singleton row)
CREATE TABLE IF NOT EXISTS sim_params (
  id BOOLEAN PRIMARY KEY DEFAULT true CHECK (id),
  lead_oc INTEGER NOT NULL DEFAULT 0,
  lead_eng INTEGER NOT NULL DEFAULT 0,
  eng_cap INTEGER NOT NULL DEFAULT 1,
  target_ueq NUMERIC(8,3) NOT NULL DEFAULT 6,
  model_leads JSONB NOT NULL DEFAULT '[]',
  model_ueq JSONB NOT NULL DEFAULT '[]'
);
INSERT INTO sim_params (id) VALUES (true) ON CONFLICT DO NOTHING;

-- Orders (OT / pedidos de fabricación)
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  order_num TEXT NOT NULL,
  unit_num INTEGER NOT NULL,
  pe_inicial DATE,
  client TEXT NOT NULL,
  product_type TEXT,
  progress NUMERIC(6,4) NOT NULL DEFAULT 0,
  status TEXT,
  due_date DATE,
  notes TEXT,
  gantt_weeks JSONB NOT NULL DEFAULT '{}',
  updated_at DATE,
  is_sim BOOLEAN NOT NULL DEFAULT false,
  priority INTEGER,
  seq_id TEXT,
  u_eq NUMERIC(8,3),
  sim_lead_oc INTEGER,
  sim_lead_eng INTEGER,
  planned_start DATE,
  op_days JSONB,
  op_resources JSONB,
  op_progress JSONB,
  op_preds JSONB,
  op_extra JSONB,
  op_order JSONB,
  op_skip JSONB,
  op_manual_starts JSONB,
  scheduled_ops JSONB NOT NULL DEFAULT '[]',
  start_date DATE,
  end_date DATE,
  sim_base_date DATE,
  oc_end DATE,
  eng_start DATE,
  eng_end DATE,
  sim_base_ot TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_orders_priority ON orders(priority);
CREATE INDEX IF NOT EXISTS idx_orders_seq ON orders(seq_id);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
```

- [ ] **Step 4: Crear `backend/src/migrate.js`** (idéntico al patrón de incentivos)

```js
const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigrations() {
  console.log('Running migrations...');
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Running migration: ${file}`);
    await db.query(sql);
    console.log(`Migration ${file} completed.`);
  }

  console.log('All migrations complete.');
}

module.exports = runMigrations;
```

- [ ] **Step 5: Crear `.env.example`**

```
POSTGRES_DB=sica_semis
POSTGRES_USER=sica
POSTGRES_PASSWORD=change_this_password
```

- [ ] **Step 6: Crear `.gitignore`**

```
.env
data/
node_modules/
backend/node_modules/
*.log
npm-debug.log*
```

- [ ] **Step 7: Commit**

```bash
git add backend/package.json backend/src/db.js backend/src/migrate.js backend/src/migrations/001_initial.sql .env.example .gitignore
git commit -m "feat: esquema Postgres inicial y bootstrap de migraciones"
```

---

### Task 2: `mappers.js` — traducción fila↔objeto

**Files:**
- Create: `backend/src/mappers.js`

**Interfaces:**
- Consumes: nada (módulo puro).
- Produces: `rowToOrder`, `orderFieldsToRow`, `rowToResource`, `resourceFieldsToRow`, `rowToGroup`, `groupFieldsToRow`, `rowToSequence`, `sequenceFieldsToRow`, `rowToCalendar`, `rowToSim` — usados por Tasks 4–13 (rutas) y `seed.js`.

- [ ] **Step 1: Escribir `backend/src/mappers.js`**

```js
// Traduce entre snake_case (filas de Postgres) y camelCase (shape que ya
// consume el frontend, heredado 1:1 del objeto DB del HTML original).

function toISODate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function rowToOrder(r) {
  return {
    id: r.id,
    orderNum: r.order_num,
    unitNum: r.unit_num,
    peInicial: toISODate(r.pe_inicial),
    client: r.client,
    productType: r.product_type,
    progress: r.progress == null ? 0 : Number(r.progress),
    status: r.status || '',
    dueDate: toISODate(r.due_date),
    notes: r.notes || '',
    ganttWeeks: r.gantt_weeks || {},
    updatedAt: toISODate(r.updated_at),
    isSim: !!r.is_sim,
    priority: r.priority,
    seqId: r.seq_id,
    uEq: r.u_eq == null ? null : Number(r.u_eq),
    simLeadOC: r.sim_lead_oc,
    simLeadEng: r.sim_lead_eng,
    plannedStart: toISODate(r.planned_start),
    opDays: r.op_days,
    opResources: r.op_resources,
    opProgress: r.op_progress,
    opPreds: r.op_preds,
    opExtra: r.op_extra,
    opOrder: r.op_order,
    opSkip: r.op_skip,
    opManualStarts: r.op_manual_starts,
    scheduledOps: r.scheduled_ops || [],
    startDate: toISODate(r.start_date),
    endDate: toISODate(r.end_date),
    _simBaseDate: toISODate(r.sim_base_date),
    _ocEnd: toISODate(r.oc_end),
    _engStart: toISODate(r.eng_start),
    _engEnd: toISODate(r.eng_end),
    _simBaseOT: r.sim_base_ot,
  };
}

// Acepta un objeto (parcial o completo) en camelCase y devuelve
// { columns, values, placeholders } listo para un UPDATE ... SET dinámico.
const ORDER_COLUMN_MAP = {
  orderNum: 'order_num', unitNum: 'unit_num', peInicial: 'pe_inicial',
  client: 'client', productType: 'product_type', progress: 'progress',
  status: 'status', dueDate: 'due_date', notes: 'notes',
  ganttWeeks: 'gantt_weeks', updatedAt: 'updated_at', isSim: 'is_sim',
  priority: 'priority', seqId: 'seq_id', uEq: 'u_eq',
  simLeadOC: 'sim_lead_oc', simLeadEng: 'sim_lead_eng',
  plannedStart: 'planned_start', opDays: 'op_days', opResources: 'op_resources',
  opProgress: 'op_progress', opPreds: 'op_preds', opExtra: 'op_extra',
  opOrder: 'op_order', opSkip: 'op_skip', opManualStarts: 'op_manual_starts',
  scheduledOps: 'scheduled_ops', startDate: 'start_date', endDate: 'end_date',
  _simBaseDate: 'sim_base_date', _ocEnd: 'oc_end', _engStart: 'eng_start',
  _engEnd: 'eng_end', _simBaseOT: 'sim_base_ot',
};

function orderFieldsToRow(fields) {
  const out = {};
  for (const [camel, snake] of Object.entries(ORDER_COLUMN_MAP)) {
    if (Object.prototype.hasOwnProperty.call(fields, camel)) out[snake] = fields[camel];
  }
  return out;
}

function rowToResource(r) {
  return {
    id: r.id, name: r.name, color: r.color,
    capacity: r.capacity, active: r.active,
    absences: r.absences || [],
  };
}

function rowToGroup(r) {
  return { id: r.id, name: r.name, members: r.members || [] };
}

function rowToSequence(r) {
  return { id: r.id, name: r.name, ops: r.ops || [] };
}

function rowToCalendar(r) {
  return {
    workDays: r.work_days || [1, 2, 3, 4, 5],
    hoursPerDay: r.hours_per_day || 8,
    holidays: r.holidays || [],
  };
}

function rowToSim(r) {
  return {
    leadOC: r.lead_oc || 0,
    leadEng: r.lead_eng || 0,
    engCap: r.eng_cap || 1,
    targetUEq: r.target_ueq == null ? 6 : Number(r.target_ueq),
    modelLeads: r.model_leads || [],
    modelUEq: r.model_ueq || [],
  };
}

module.exports = {
  rowToOrder, orderFieldsToRow, ORDER_COLUMN_MAP,
  rowToResource, rowToGroup, rowToSequence, rowToCalendar, rowToSim,
};
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/mappers.js
git commit -m "feat: mappers snake_case/camelCase para las 7 entidades"
```

---

### Task 3: Motor de scheduling portado (`schedulerCore.js`) + tests

Esta es la pieza de mayor riesgo: es un port 1:1 de `doSchedule` y sus ~15 funciones de soporte (líneas 262–810 de `SICA_Programacion.html`), removiendo únicamente las referencias al DOM (`document.getElementById('fSchedCap')`, `bootstrap.Modal`, `toast(...)`) y a `localStorage` (`saveDB()`). Toda la lógica de negocio se preserva exactamente.

**Files:**
- Create: `backend/src/services/calendarUtils.js`
- Create: `backend/src/services/schedulerCore.js`
- Create: `backend/src/services/schedulerCore.test.js`

**Interfaces:**
- Produces: `calendarUtils.{calDiff, addCalDays, isWD, nextWD, addWDs, todayStr}`.
- Produces: `schedulerCore.runSchedule(state, opts)` donde `state = {orders, resources, resourceGroups, sequences, calendar, sim}` (arrays/objetos ya en camelCase, tal como los devuelve `mappers.js`) y `opts = {target, respectCap, strictPrio}` (`target` es `'all'` o un `id` de orden). Devuelve `{orders, scheduledCount, skippedCount}` donde `orders` son SOLO las órdenes recalculadas (targets), con sus campos de scheduling actualizados — usado por `routes/schedule.js` (Task 12).

- [ ] **Step 1: Crear `backend/src/services/calendarUtils.js`**

```js
function calDiff(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}

function addCalDays(ds, n) {
  const d = new Date(`${ds}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function isWD(ds, H, WD) {
  const dow = new Date(`${ds}T12:00:00`).getDay() || 7;
  return WD.includes(dow) && !H.has(ds);
}

function nextWD(ds, H, WD) {
  let d = new Date(`${ds}T12:00:00`);
  for (let i = 0; i < 15; i++) {
    const s = d.toISOString().split('T')[0];
    if (isWD(s, H, WD)) return s;
    d.setDate(d.getDate() + 1);
  }
  return ds;
}

function addWDs(ds, n, H, WD) {
  let d = new Date(`${ds}T12:00:00`), c = 0;
  while (c < n) {
    d.setDate(d.getDate() + 1);
    if (isWD(d.toISOString().split('T')[0], H, WD)) c++;
  }
  return d.toISOString().split('T')[0];
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

module.exports = { calDiff, addCalDays, isWD, nextWD, addWDs, todayStr };
```

- [ ] **Step 2: Crear `backend/src/services/schedulerCore.js`**

```js
const { calDiff, addCalDays, isWD, nextWD, addWDs, todayStr } = require('./calendarUtils');

// ── PRECEDENCIAS ────────────────────────────────────────────────
function parsePreds(str) {
  const s = String(str ?? '').trim().toLowerCase();
  if (s === '' || s === 'anterior') return undefined;
  if (s === 'libre' || s === '-' || s === '0') return [];
  const a = s.split(/[,;]+/).map(x => parseInt(x.trim()) - 1).filter(n => !isNaN(n) && n >= 0);
  return a.length ? a : undefined;
}

function effPreds(o, seq, i) {
  const ov = o?.opPreds?.[i];
  if (ov !== undefined && ov !== null) return parsePreds(ov);
  return seq?.ops?.[i]?.preds;
}

// ── UNIDAD EQUIVALENTE Y PLAZOS PREVIOS ─────────────────────────
function getModelUEq(sim, pt) {
  if (pt) {
    const m = (sim?.modelUEq || []).find(x => x.productType === pt);
    if (m && m.uEq != null) return Math.max(0, +m.uEq);
  }
  return 1;
}

function getSimLead(sim, o) {
  if ((o?.progress || 0) > 0) return { leadOC: 0, leadEng: 0 };
  if (o?.simLeadOC != null || o?.simLeadEng != null) {
    return { leadOC: o.simLeadOC ?? 0, leadEng: o.simLeadEng ?? 0 };
  }
  const pt = o?.productType;
  if (pt) {
    const m = (sim?.modelLeads || []).find(x => x.productType === pt);
    if (m) return { leadOC: m.leadOC ?? 0, leadEng: m.leadEng ?? 0 };
  }
  return { leadOC: sim?.leadOC || 0, leadEng: sim?.leadEng || 0 };
}

// ── CALENDARIOS POR RECURSO ──────────────────────────────────────
function absDates(r) {
  const out = [];
  (r?.absences || []).forEach(a => {
    if (!a.from) return;
    const to = a.to || a.from;
    let d = a.from, g = 0;
    while (d <= to && g++ < 3650) { out.push(d); d = addCalDays(d, 1); }
  });
  return out;
}

function makeHFor(resources, baseH) {
  const cache = {};
  return function (resId) {
    if (!resId) return baseH;
    if (cache[resId]) return cache[resId];
    const r = resources.find(x => x.id === resId);
    const ab = absDates(r);
    cache[resId] = ab.length ? new Set([...baseH, ...ab]) : baseH;
    return cache[resId];
  };
}

function getSeq(sequences, o) {
  if (!o) return null;
  if (o.seqId) {
    const s = sequences.find(s => s.id === o.seqId);
    if (s) return s;
  }
  return sequences.find(s => s.name === o.productType)
    || sequences.find(s => o.productType?.toLowerCase().includes(s.name.toLowerCase()))
    || null;
}

// ── OPERACIONES EFECTIVAS DE LA OT ───────────────────────────────
function hasSkips(o) { return !!(o?.opSkip && Object.keys(o.opSkip).length); }
function hasExtra(o) { return !!(o?.opExtra && o.opExtra.length); }
function needsEff(o) { return hasSkips(o) || hasExtra(o); }

function _applyOrder(o, list) {
  const ord = o?.opOrder || null;
  if (!ord || !ord.length) return list;
  const byI = {};
  list.forEach(x => { byI[x._i] = x; });
  const out = [];
  ord.forEach(ix => { if (byI[ix]) { out.push(byI[ix]); delete byI[ix]; } });
  list.forEach(x => { if (byI[x._i]) out.push(x); });
  return out;
}

function otOps(o, seq) {
  const base = (seq?.ops || []).map((sop, i) => ({
    name: sop.name,
    res: o?.opResources?.[i] || sop.res,
    days: o?.opDays?.[i] || sop.days || 5,
    preds: effPreds(o, seq, i),
    from: sop.from, to: sop.to,
    prog: o?.opProgress ? o.opProgress[i] : undefined,
    _i: i, _x: false,
  }));
  const ex = o?.opExtra || [];
  if (!ex.length) return _applyOrder(o, base);
  const byAfter = {};
  ex.forEach((e, k) => {
    const a = (e.after == null ? base.length - 1 : e.after);
    const _ov = o?.opPreds ? o.opPreds[1000 + k] : undefined;
    (byAfter[a] = byAfter[a] || []).push({
      name: e.name || 'Operación extra',
      res: e.res, days: e.days || 5,
      preds: (_ov !== undefined && _ov !== null) ? parsePreds(_ov) : e.preds,
      from: undefined, to: undefined,
      prog: e.progress,
      _i: 1000 + k, _x: true, _after: a,
    });
  });
  const out = [];
  (byAfter[-1] || []).forEach(e => out.push(e));
  base.forEach((sop, i) => { out.push(sop); (byAfter[i] || []).forEach(e => out.push(e)); });
  Object.keys(byAfter).forEach(k => { const n = +k; if (n >= base.length) byAfter[k].forEach(e => out.push(e)); });
  return _applyOrder(o, out);
}

function effRanges(o, seq) {
  const ops = otOps(o, seq);
  const totSeqDays = (seq?.ops || []).reduce((s, x) => s + (x.days || 5), 0) || 1;
  const w = ops.map(sop => ({
    i: sop._i,
    w: sop._x ? Math.max(0, (sop.days || 5) / totSeqDays) : Math.max(0, (sop.to ?? 1) - (sop.from ?? 0)),
    skip: !!(o?.opSkip && o.opSkip[sop._i]),
  }));
  const tot = w.filter(a => !a.skip).reduce((s, a) => s + a.w, 0);
  const out = {}; let acc = 0;
  w.forEach(a => {
    if (a.skip) { out[a.i] = null; return; }
    const q = tot > 0 ? a.w / tot : 0;
    out[a.i] = { from: acc, to: Math.min(1, acc + q) }; acc += q;
  });
  const lastAct = w.filter(a => !a.skip).pop();
  if (lastAct && out[lastAct.i]) out[lastAct.i].to = 1;
  return out;
}

function calcStatus(sequences, o) {
  if (!o) return '';
  if (o.progress >= 1 || o.status?.toUpperCase().includes('TERMINADO')) return 'TERMINADO';
  const seq = getSeq(sequences, o);
  if (!seq || !seq.ops?.length) return o.status || '';
  const p = o.progress || 0;
  const _list = otOps(o, seq);
  const _er = needsEff(o) ? effRanges(o, seq) : null;
  for (const op of _list) {
    const r = _er ? _er[op._i] : { from: op.from ?? 0, to: op.to ?? 1 };
    if (!r) continue;
    if (p >= r.from && p < r.to) return op.name;
  }
  return p >= 1 ? 'TERMINADO' : ((_list.find(s => !_er || _er[s._i]) || {}).name || o.status || '');
}

// ── RESOLUCIÓN DE GRUPOS DE RECURSOS ─────────────────────────────
function resolveGroupRes(resources, groupId, grp, start, remainingDays, resAvail, H, WD, HFor) {
  if (!grp || !grp.members.length) return { res: groupId, start };
  const _excl = [];
  let mem = grp.members.filter(m => {
    const r = resources.find(x => x.id === m);
    if (!r) { _excl.push(m + ': no existe como recurso'); return false; }
    if (r.active === false) { _excl.push((r.name || m) + ': INACTIVO'); return false; }
    return true;
  });
  if (!mem.length) { mem = grp.members; _excl.length = 0; _excl.push('todos inactivos: se usan igual'); }
  let best = null;
  const _cand = [];
  mem.forEach(memberId => {
    const rr = resources.find(x => x.id === memberId);
    const cap = rr?.capacity || 1;
    const mH = HFor ? HFor(memberId) : H;
    let s = nextWD(start, mH, WD), guard = 0;
    while (guard++ < 100) {
      const _e = addWDs(s, remainingDays, mH, WD);
      const conflicts = (resAvail[memberId] || []).filter(iv => iv.s <= _e && iv.e >= s);
      if (conflicts.length < cap) break;
      conflicts.sort((a, b) => a.e < b.e ? -1 : 1);
      s = nextWD(addCalDays(conflicts[0].e, 1), mH, WD);
    }
    const bk = resAvail[memberId] || [];
    const loadD = bk.reduce((t, iv) => t + Math.max(0, calDiff(iv.s, iv.e)), 0);
    const loadN = bk.length;
    _cand.push({ id: memberId, name: rr?.name || memberId, s, loadD, loadN, cap, abs: absDates(rr).length });
    if (!best || s < best.s || (s === best.s && (loadD < best.loadD || (loadD === best.loadD && loadN < best.loadN)))) {
      best = { res: memberId, s, loadD, loadN };
    }
  });
  const _pick = best ? best.res : mem[0];
  const _diag = 'Grupo ' + (grp.name || groupId) + ' → ' + _cand.map(c =>
    (c.id === _pick ? '✔ ' : '· ') + c.name + ' (libre ' + c.s + ', carga ' + c.loadD + 'd, cap ' + c.cap +
    (c.abs ? ', ' + c.abs + 'd de ausencias' : '') + ')').join(' | ') +
    (_excl.length ? ' | descartados: ' + _excl.join(', ') : '');
  return { res: _pick, start: best ? best.s : start, diag: _diag };
}

// ── MOTOR PRINCIPAL ───────────────────────────────────────────────
// state = { orders, resources, resourceGroups, sequences, calendar, sim } (todo en camelCase)
// opts  = { target: 'all' | orderId, respectCap: boolean, strictPrio: boolean }
function runSchedule(state, opts) {
  const { orders, resources, resourceGroups, sequences, calendar, sim } = state;
  const { target, respectCap, strictPrio } = opts;
  const today = todayStr();
  const isAll = target === 'all';
  const resPrioFloor = {};

  let targets = isAll
    ? orders.filter(o => o.progress < 1 && !(o.status || '').toUpperCase().includes('TERMINADO'))
    : orders.filter(o => o.id === target);

  targets.sort((a, b) => (a.priority || 999) - (b.priority || 999));

  const H = new Set((calendar.holidays || []).map(h => h.date));
  const WD = calendar.workDays || [1, 2, 3, 4, 5];
  const HFor = makeHFor(resources, H);

  if (isAll) {
    targets.forEach(o => {
      o.scheduledOps = []; o.startDate = null; o.endDate = null;
      o._simBaseDate = null; o._ocEnd = null; o._engStart = null; o._engEnd = null;
    });
  }

  const resAvail = {};
  if (respectCap && !isAll) {
    const tIds = new Set(targets.map(o => o.id));
    orders.forEach(o => {
      if (tIds.has(o.id)) return;
      (o.scheduledOps || []).forEach(op => {
        if (!op.startDate || !op.endDate) return;
        const _sid = op.resolvedRes || op.res;
        if (!resAvail[_sid]) resAvail[_sid] = [];
        resAvail[_sid].push({ s: op.startDate, e: op.endDate });
      });
    });
  }

  const engAvail = [];
  if (respectCap && !isAll) {
    const _tIdsEng = new Set(targets.map(o => o.id));
    orders.forEach(o => { if (!_tIdsEng.has(o.id) && o._engStart && o._engEnd) engAvail.push({ s: o._engStart, e: o._engEnd }); });
  }

  const _multiUnitEngEnd = {};
  let n = 0, sk = 0;

  targets.forEach(o => {
    const seq = getSeq(sequences, o);
    if (!seq) { sk++; return; }
    const endDates = {};
    const _erSched = needsEff(o) ? effRanges(o, seq) : null;
    const _leads = getSimLead(sim, o);
    let _basePlanDate = (o.plannedStart && o.plannedStart > today) ? o.plannedStart : today;
    if (o._simBaseOT) {
      const _mue = _multiUnitEngEnd[o._simBaseOT];
      if (_mue && _mue > _basePlanDate) _basePlanDate = _mue;
    }
    const _ocStart = _basePlanDate;
    const _ocEnd = _leads.leadOC > 0 ? addCalDays(_ocStart, _leads.leadOC) : _ocStart;
    o._simBaseDate = _ocStart;
    o._ocEnd = _ocEnd;
    let _fabFrom = _ocEnd;
    if (_leads.leadEng > 0) {
      const engCap = sim?.engCap || 1;
      let engS = _ocEnd;
      let engE = addCalDays(engS, _leads.leadEng);
      if (respectCap) {
        let _eg = 0;
        while (_eg++ < 500) {
          const conf = engAvail.filter(iv => iv.s < engE && iv.e > engS);
          if (conf.length < engCap) break;
          conf.sort((a, b) => a.e < b.e ? -1 : 1);
          engS = conf[0].e;
          engE = addCalDays(engS, _leads.leadEng);
        }
      }
      engAvail.push({ s: engS, e: engE });
      o._engStart = engS;
      o._engEnd = engE;
      _fabFrom = engE;
    } else {
      o._engStart = _leads.leadOC > 0 ? _ocEnd : null;
      o._engEnd = _leads.leadOC > 0 ? _ocEnd : null;
      _fabFrom = _ocEnd;
    }
    { const _eef = o._engEnd || _ocEnd; if (_eef) _multiUnitEngEnd[o.id] = _eef; }
    const _ps = _fabFrom;
    let seqCur = _ps;
    const _seenRes = new Set();
    const sOps = [];
    const _otList = otOps(o, seq);
    const _nameOf = {}; _otList.forEach(x => { _nameOf[x._i] = x.name; });

    _otList.forEach(sop => {
      const i = sop._i;
      const _r = _erSched ? _erSched[i] : null;
      const f = _r ? _r.from : (sop.from ?? 0), t = _r ? _r.to : (sop.to ?? 1);
      const _storedProg = sop.prog;
      const derivedProg = o.progress >= t ? 1 : o.progress >= f ? Math.min(1, (o.progress - f) / (t - f)) : 0;
      const opProg = (_storedProg !== undefined && _storedProg > 0) ? _storedProg : derivedProg;
      if (o.opSkip?.[i]) return;
      if (opProg >= 1) return;
      const res = sop.res;
      const fullDays = sop.days || 5;
      const preds = sop.preds;
      const isActiveTask = o.progress > 0 && calcStatus(sequences, o) === sop.name;
      const isInProgress = opProg > 0 || isActiveTask;
      const remainingDays = isInProgress && opProg > 0 ? Math.max(1, Math.ceil(fullDays * (1 - opProg))) : fullDays;
      let earliest, _why;
      if (isInProgress) {
        earliest = today; _why = 'En curso: el trabajo restante arranca hoy';
      } else if (preds === undefined || preds === null) {
        earliest = seqCur; _why = 'Secuencia: espera que termine la op anterior';
      } else if (preds.length === 0) {
        earliest = _ps; _why = (o.plannedStart && o.plannedStart > today) ? 'Inicio programado de la OT' : 'Arranque libre';
      } else {
        earliest = _ps; _why = (o.plannedStart && o.plannedStart > today) ? 'Inicio programado de la OT' : 'Arranque libre';
        preds.forEach(pi => { if (endDates[pi] && endDates[pi] > earliest) { earliest = endDates[pi]; _why = 'Predecesora: ' + (_nameOf[pi] || ('op ' + (pi + 1))); } });
      }
      const _pin = o.opManualStarts?.[i] || null;
      if (_pin) {
        if (isInProgress) { earliest = _pin > today ? _pin : today; _why = 'Fecha fijada a mano'; }
        else if (_pin > earliest) { earliest = _pin; _why = 'Fecha fijada a mano'; }
      }
      const _grp = resourceGroups.find(g => g.id === res);
      let actualRes = res, _grpDiag = '';
      let _opH = _grp ? H : HFor(res);
      const _firstOnRes = !_seenRes.has(res);
      _seenRes.add(res);
      const _earliestPrePrio = earliest;
      if (strictPrio && _firstOnRes && !_pin && !isInProgress && resPrioFloor[res] && resPrioFloor[res] > earliest) {
        const _tryS = nextWD(earliest, _opH, WD);
        const _tryE = addWDs(_tryS, remainingDays, _opH, WD);
        if (_tryE > resPrioFloor[res]) {
          earliest = resPrioFloor[res];
          _why = 'PRIORIDAD ESTRICTA en ' + res + ': no alcanza a terminar antes del ' + resPrioFloor[res] + ', cuando ingresa una OT de mayor prioridad. Destildando esa opcion podria arrancar antes de todos modos.';
        } else {
          _why = (_why ? _why + ' · ' : '') + 'Aprovecha un hueco ocioso de ' + res + ' y termina el ' + _tryE + ', antes de que ingrese la OT de mayor prioridad (' + resPrioFloor[res] + ')';
        }
      }
      let start = nextWD(earliest, _opH, WD);
      const _startNoCap = start;
      if (respectCap) {
        if (_grp && _grp.members.length) {
          const r = resolveGroupRes(resources, res, _grp, start, remainingDays, resAvail, H, WD, HFor);
          actualRes = r.res; start = r.start; _opH = HFor(actualRes);
          if (r.diag) _grpDiag = r.diag;
        } else {
          const cap = resources.find(x => x.id === res)?.capacity || 1;
          if (!resAvail[res]) resAvail[res] = [];
          let _guard = 0;
          while (_guard++ < 100) {
            const _e = addWDs(start, remainingDays, _opH, WD);
            const conflicts = resAvail[res].filter(iv => iv.s <= _e && iv.e >= start);
            if (conflicts.length < cap) break;
            conflicts.sort((a, b) => a.e < b.e ? -1 : 1);
            start = nextWD(addCalDays(conflicts[0].e, 1), _opH, WD);
          }
        }
      }
      if (start > _startNoCap) _why = 'Capacidad de ' + actualRes + ' ocupada hasta el ' + _startNoCap + ' (se corrio al ' + start + ')';
      if (_grpDiag) _why = (_why ? _why + ' — ' : '') + _grpDiag;
      const _waitCap = Math.max(0, calDiff(_startNoCap, start));
      const _waitPrio = Math.max(0, calDiff(_earliestPrePrio, earliest));
      const end = addWDs(start, remainingDays, _opH, WD);
      endDates[i] = end;
      seqCur = end;
      if (respectCap) { if (!resAvail[actualRes]) resAvail[actualRes] = []; resAvail[actualRes].push({ s: start, e: end }); }
      if (strictPrio && _firstOnRes && !isInProgress && (!resPrioFloor[res] || start > resPrioFloor[res])) resPrioFloor[res] = start;
      sOps.push({
        name: sop.name, res, resolvedRes: _grp ? actualRes : undefined, days: remainingDays, fullDays, from: f, to: t, preds,
        startDate: start, endDate: end, progress: opProg, isInProgress, why: _why,
        si: i, isExtra: !!sop._x, waitCap: _waitCap, waitPrio: _waitPrio,
      });
    });

    o.scheduledOps = sOps;
    o.startDate = sOps[0]?.startDate || null;
    o.endDate = sOps.at(-1)?.endDate || null;
    o.updatedAt = today;
    n++;
  });

  return { orders: targets, scheduledCount: n, skippedCount: sk };
}

module.exports = {
  runSchedule, parsePreds, effPreds, otOps, effRanges, calcStatus, getSeq,
  getSimLead, getModelUEq, resolveGroupRes,
};
```

- [ ] **Step 3: Escribir `backend/src/services/schedulerCore.test.js`**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const { runSchedule, parsePreds } = require('./schedulerCore');

function baseState() {
  return {
    resources: [
      { id: 'A', name: 'Res A', capacity: 1, active: true, absences: [] },
      { id: 'B', name: 'Res B', capacity: 1, active: true, absences: [] },
    ],
    resourceGroups: [],
    sequences: [
      { id: 'seq1', name: 'Producto Test', ops: [
        { name: 'Op1', res: 'A', days: 2, from: 0, to: 0.5 },
        { name: 'Op2', res: 'B', days: 2, from: 0.5, to: 1 },
      ] },
    ],
    calendar: { workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] },
    sim: { leadOC: 0, leadEng: 0, engCap: 1, modelLeads: [], modelUEq: [] },
    orders: [],
  };
}

test('parsePreds: secuencial, libre y explícito', () => {
  assert.equal(parsePreds(''), undefined);
  assert.deepEqual(parsePreds('libre'), []);
  assert.deepEqual(parsePreds('1,3'), [0, 2]);
});

test('runSchedule programa una orden simple respetando la secuencia', () => {
  const state = baseState();
  state.orders = [{
    id: 'OT1', seqId: 'seq1', progress: 0, status: '', priority: 1,
    plannedStart: null, opDays: null, opResources: null, opProgress: null,
    opPreds: null, opExtra: null, opOrder: null, opSkip: null, opManualStarts: null,
    scheduledOps: [], simLeadOC: null, simLeadEng: null,
  }];
  const { orders, scheduledCount, skippedCount } = runSchedule(state, { target: 'OT1', respectCap: true, strictPrio: true });
  assert.equal(scheduledCount, 1);
  assert.equal(skippedCount, 0);
  const o = orders[0];
  assert.equal(o.scheduledOps.length, 2);
  assert.equal(o.scheduledOps[0].res, 'A');
  assert.equal(o.scheduledOps[1].res, 'B');
  assert.ok(o.scheduledOps[1].startDate >= o.scheduledOps[0].endDate);
  assert.equal(o.startDate, o.scheduledOps[0].startDate);
  assert.equal(o.endDate, o.scheduledOps[1].endDate);
});

test('runSchedule respeta prioridad estricta: la OT de menor prioridad no adelanta a la de mayor', () => {
  const state = baseState();
  state.orders = [
    { id: 'HIGH', seqId: 'seq1', progress: 0, status: '', priority: 1, scheduledOps: [] },
    { id: 'LOW', seqId: 'seq1', progress: 0, status: '', priority: 2, scheduledOps: [] },
  ];
  const { orders } = runSchedule(state, { target: 'all', respectCap: true, strictPrio: true });
  const high = orders.find(o => o.id === 'HIGH');
  const low = orders.find(o => o.id === 'LOW');
  // Ambas usan el recurso A primero: HIGH (prioridad 1) debe entrar primero o al mismo tiempo que LOW.
  assert.ok(high.scheduledOps[0].startDate <= low.scheduledOps[0].startDate);
});

test('runSchedule marca skippedCount cuando la orden no tiene secuencia resoluble', () => {
  const state = baseState();
  state.orders = [{ id: 'NOSEQ', seqId: 'no-existe', productType: 'Inexistente', progress: 0, status: '', scheduledOps: [] }];
  const { scheduledCount, skippedCount } = runSchedule(state, { target: 'NOSEQ', respectCap: true, strictPrio: true });
  assert.equal(scheduledCount, 0);
  assert.equal(skippedCount, 1);
});
```

- [ ] **Step 4: Correr los tests**

Run: `cd backend && npm install && npm test`
Expected: 4 tests, todos PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/src/services/calendarUtils.js backend/src/services/schedulerCore.js backend/src/services/schedulerCore.test.js
git commit -m "feat: portar motor de scheduling (doSchedule) a servicio puro con tests"
```

---

### Task 4: Mutex de scheduling + `index.js` (bootstrap del server)

**Files:**
- Create: `backend/src/services/lock.js`
- Create: `backend/src/index.js`

**Interfaces:**
- Produces: `lock.withLock(fn)` — ejecuta `fn` (async) garantizando que solo una invocación corre a la vez; las demás quedan en cola. Usado por `routes/schedule.js` (Task 12).
- Produces: server Express escuchando en `PORT` (default 3001), con `runMigrations()` corriendo antes de levantar.

- [ ] **Step 1: Crear `backend/src/services/lock.js`**

```js
// Mutex en memoria: sirve porque el backend corre en un solo proceso Node
// (ver Global Constraints del plan). Si en el futuro se escala a múltiples
// procesos/réplicas, hay que migrar a un advisory lock de Postgres.
let tail = Promise.resolve();

function withLock(fn) {
  const run = tail.then(() => fn());
  // Evita que un rechazo corte la cadena para las próximas llamadas.
  tail = run.catch(() => {});
  return run;
}

module.exports = { withLock };
```

- [ ] **Step 2: Crear `backend/src/index.js`**

```js
const express = require('express');
const cors = require('cors');
const runMigrations = require('./migrate');

const stateRoutes = require('./routes/state');
const ordersRoutes = require('./routes/orders');
const resourcesRoutes = require('./routes/resources');
const resourceGroupsRoutes = require('./routes/resourceGroups');
const operationsRoutes = require('./routes/operations');
const sequencesRoutes = require('./routes/sequences');
const calendarRoutes = require('./routes/calendar');
const simRoutes = require('./routes/sim');
const scheduleRoutes = require('./routes/schedule');
const backupRoutes = require('./routes/backup');

const app = express();
const PORT = process.env.PORT || 3001;

app.use(cors());
app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.use('/api/state', stateRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/resources', resourcesRoutes);
app.use('/api/resource-groups', resourceGroupsRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/sequences', sequencesRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/sim', simRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/backup', backupRoutes);

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

async function start() {
  try {
    await runMigrations();
    app.listen(PORT, () => {
      console.log(`SICA Semis Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/services/lock.js backend/src/index.js
git commit -m "feat: bootstrap del server Express y mutex de scheduling"
```

(El commit fallará hasta que existan los archivos de `routes/*` importados — se resuelve en las Tasks 5–13, que se commitean en orden antes de intentar levantar el server.)

---

### Task 5: `GET /api/state` — hidratación completa

**Files:**
- Create: `backend/src/routes/state.js`

**Interfaces:**
- Consumes: `mappers.{rowToOrder, rowToResource, rowToGroup, rowToSequence, rowToCalendar, rowToSim}` (Task 2).
- Produces: `GET /api/state` → `{ orders, resources, resourceGroups, operations, sequences, calendar, sim }`, reemplazando lo que hoy arma `loadDB()` leyendo `localStorage`.

- [ ] **Step 1: Escribir `backend/src/routes/state.js`**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  rowToOrder, rowToResource, rowToGroup, rowToSequence, rowToCalendar, rowToSim,
} = require('../mappers');

router.get('/', async (req, res) => {
  try {
    const [orders, resources, groups, ops, seqs, cal, sim] = await Promise.all([
      db.query('SELECT * FROM orders ORDER BY priority NULLS LAST, order_num, unit_num'),
      db.query('SELECT * FROM resources ORDER BY id'),
      db.query('SELECT * FROM resource_groups ORDER BY name'),
      db.query('SELECT name FROM operations ORDER BY name'),
      db.query('SELECT * FROM sequences ORDER BY name'),
      db.query('SELECT * FROM calendar WHERE id = true'),
      db.query('SELECT * FROM sim_params WHERE id = true'),
    ]);

    res.json({
      orders: orders.rows.map(rowToOrder),
      resources: resources.rows.map(rowToResource),
      resourceGroups: groups.rows.map(rowToGroup),
      operations: ops.rows.map(r => r.name),
      sequences: seqs.rows.map(rowToSequence),
      calendar: cal.rows[0] ? rowToCalendar(cal.rows[0]) : { workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] },
      sim: sim.rows[0] ? rowToSim(sim.rows[0]) : { leadOC: 0, leadEng: 0, engCap: 1, targetUEq: 6, modelLeads: [], modelUEq: [] },
    });
  } catch (err) {
    console.error('GET /api/state error:', err);
    res.status(500).json({ error: 'Error al cargar el estado' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/state.js
git commit -m "feat: endpoint GET /api/state para hidratar el frontend"
```

---

### Task 6: CRUD de `orders`

**Files:**
- Create: `backend/src/routes/orders.js`

**Interfaces:**
- Consumes: `mappers.{rowToOrder, orderFieldsToRow}` (Task 2).
- Produces: `GET /api/orders`, `GET /api/orders/:id`, `POST /api/orders`, `PUT /api/orders/:id` (acepta un subconjunto cualquiera de campos — cubre TODOS los puntos de escritura puntuales del HTML: `opProgress`, `opPreds`, `opManualStarts`, `opExtra`, `opSkip`, `opOrder`, `opResources`, `opDays`, además de los campos "de formulario" como `client`/`status`/`progress`), `DELETE /api/orders/:id`.

- [ ] **Step 1: Escribir `backend/src/routes/orders.js`**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { rowToOrder, orderFieldsToRow } = require('../mappers');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM orders ORDER BY priority NULLS LAST, order_num, unit_num');
    res.json(result.rows.map(rowToOrder));
  } catch (err) {
    console.error('GET orders error:', err);
    res.status(500).json({ error: 'Error al obtener órdenes' });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM orders WHERE id = $1', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(rowToOrder(result.rows[0]));
  } catch (err) {
    console.error('GET order error:', err);
    res.status(500).json({ error: 'Error al obtener la orden' });
  }
});

// POST /api/orders — body: objeto completo en camelCase (incluye `id`)
router.post('/', async (req, res) => {
  const { id } = req.body;
  if (!id || !req.body.client) {
    return res.status(400).json({ error: 'id y client son requeridos' });
  }
  const row = orderFieldsToRow(req.body);
  const columns = ['id', ...Object.keys(row)];
  const values = [id, ...Object.values(row)];
  const placeholders = columns.map((_, i) => `$${i + 1}`);
  try {
    const result = await db.query(
      `INSERT INTO orders (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
      values
    );
    res.status(201).json(rowToOrder(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Ya existe la orden ${id}` });
    console.error('POST order error:', err);
    res.status(500).json({ error: 'Error al crear la orden' });
  }
});

// PUT /api/orders/:id — body: campos parciales en camelCase (patch)
router.put('/:id', async (req, res) => {
  const row = orderFieldsToRow(req.body);
  const cols = Object.keys(row);
  if (!cols.length) return res.status(400).json({ error: 'Nada para actualizar' });
  const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
  try {
    const result = await db.query(
      `UPDATE orders SET ${setClause} WHERE id = $1 RETURNING *`,
      [req.params.id, ...cols.map(c => row[c])]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json(rowToOrder(result.rows[0]));
  } catch (err) {
    console.error('PUT order error:', err);
    res.status(500).json({ error: 'Error al actualizar la orden' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM orders WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Orden no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE order error:', err);
    res.status(500).json({ error: 'Error al eliminar la orden' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/orders.js
git commit -m "feat: CRUD de orders"
```

---

### Task 7: CRUD de `resources` (incluye ausencias embebidas)

**Files:**
- Create: `backend/src/routes/resources.js`

**Interfaces:**
- Consumes: `mappers.rowToResource`.
- Produces: `GET/POST /api/resources`, `PUT/DELETE /api/resources/:id`. Las ausencias (`addAbs`/`delAbs` en el HTML) se manejan reenviando el array `absences` completo en un `PUT` — igual que el HTML hoy hace `r.absences.push(...); saveDB();` sobre el objeto completo.

- [ ] **Step 1: Escribir `backend/src/routes/resources.js`**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { rowToResource } = require('../mappers');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM resources ORDER BY id');
    res.json(result.rows.map(rowToResource));
  } catch (err) {
    console.error('GET resources error:', err);
    res.status(500).json({ error: 'Error al obtener recursos' });
  }
});

router.post('/', async (req, res) => {
  const { id, name } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id y name son requeridos' });
  const { color, capacity, active, absences } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO resources (id, name, color, capacity, active, absences)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [id, name, color || '#6B7280', capacity || 2, active !== false, JSON.stringify(absences || [])]
    );
    res.status(201).json(rowToResource(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Ya existe el recurso ${id}` });
    console.error('POST resource error:', err);
    res.status(500).json({ error: 'Error al crear el recurso' });
  }
});

router.put('/:id', async (req, res) => {
  const { name, color, capacity, active, absences } = req.body;
  try {
    const result = await db.query(
      `UPDATE resources SET
         name = COALESCE($1, name),
         color = COALESCE($2, color),
         capacity = COALESCE($3, capacity),
         active = COALESCE($4, active),
         absences = COALESCE($5, absences)
       WHERE id = $6 RETURNING *`,
      [name, color, capacity, active, absences ? JSON.stringify(absences) : null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Recurso no encontrado' });
    res.json(rowToResource(result.rows[0]));
  } catch (err) {
    console.error('PUT resource error:', err);
    res.status(500).json({ error: 'Error al actualizar el recurso' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM resources WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Recurso no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE resource error:', err);
    res.status(500).json({ error: 'Error al eliminar el recurso' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/resources.js
git commit -m "feat: CRUD de resources (con ausencias embebidas)"
```

---

### Task 8: CRUD de `resource-groups`

**Files:**
- Create: `backend/src/routes/resourceGroups.js`

**Interfaces:**
- Consumes: `mappers.rowToGroup`.
- Produces: `GET/POST /api/resource-groups`, `PUT/DELETE /api/resource-groups/:id` — reemplaza `openGM`/`saveGrp`/`delGrp`.

- [ ] **Step 1: Escribir `backend/src/routes/resourceGroups.js`**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { rowToGroup } = require('../mappers');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM resource_groups ORDER BY name');
    res.json(result.rows.map(rowToGroup));
  } catch (err) {
    console.error('GET resource-groups error:', err);
    res.status(500).json({ error: 'Error al obtener grupos' });
  }
});

router.post('/', async (req, res) => {
  const { id, name, members } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id y name son requeridos' });
  try {
    const result = await db.query(
      `INSERT INTO resource_groups (id, name, members) VALUES ($1, $2, $3) RETURNING *`,
      [id, name, JSON.stringify(members || [])]
    );
    res.status(201).json(rowToGroup(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Ya existe el grupo ${id}` });
    console.error('POST resource-group error:', err);
    res.status(500).json({ error: 'Error al crear el grupo' });
  }
});

router.put('/:id', async (req, res) => {
  const { name, members } = req.body;
  try {
    const result = await db.query(
      `UPDATE resource_groups SET name = COALESCE($1, name), members = COALESCE($2, members) WHERE id = $3 RETURNING *`,
      [name, members ? JSON.stringify(members) : null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Grupo no encontrado' });
    res.json(rowToGroup(result.rows[0]));
  } catch (err) {
    console.error('PUT resource-group error:', err);
    res.status(500).json({ error: 'Error al actualizar el grupo' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM resource_groups WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Grupo no encontrado' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE resource-group error:', err);
    res.status(500).json({ error: 'Error al eliminar el grupo' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/resourceGroups.js
git commit -m "feat: CRUD de resource-groups"
```

---

### Task 9: `operations` (catálogo simple) + `sequences`

**Files:**
- Create: `backend/src/routes/operations.js`
- Create: `backend/src/routes/sequences.js`

**Interfaces:**
- Produces: `GET /api/operations`, `POST /api/operations` (`{name}`), `DELETE /api/operations/:name` — reemplaza `addOpN`/`delOp`.
- Produces: `GET/POST /api/sequences`, `PUT/DELETE /api/sequences/:id` — reemplaza `saveSeq`/`delSq`.

- [ ] **Step 1: Escribir `backend/src/routes/operations.js`**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT name FROM operations ORDER BY name');
    res.json(result.rows.map(r => r.name));
  } catch (err) {
    console.error('GET operations error:', err);
    res.status(500).json({ error: 'Error al obtener operaciones' });
  }
});

router.post('/', async (req, res) => {
  const { name } = req.body;
  if (!name || !name.trim()) return res.status(400).json({ error: 'name es requerido' });
  try {
    await db.query('INSERT INTO operations (name) VALUES ($1) ON CONFLICT DO NOTHING', [name.trim()]);
    const result = await db.query('SELECT name FROM operations ORDER BY name');
    res.status(201).json(result.rows.map(r => r.name));
  } catch (err) {
    console.error('POST operation error:', err);
    res.status(500).json({ error: 'Error al agregar la operación' });
  }
});

router.delete('/:name', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM operations WHERE name = $1 RETURNING name', [req.params.name]);
    if (!result.rows.length) return res.status(404).json({ error: 'Operación no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE operation error:', err);
    res.status(500).json({ error: 'Error al eliminar la operación' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Escribir `backend/src/routes/sequences.js`**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { rowToSequence } = require('../mappers');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sequences ORDER BY name');
    res.json(result.rows.map(rowToSequence));
  } catch (err) {
    console.error('GET sequences error:', err);
    res.status(500).json({ error: 'Error al obtener secuencias' });
  }
});

router.post('/', async (req, res) => {
  const { id, name, ops } = req.body;
  if (!id || !name) return res.status(400).json({ error: 'id y name son requeridos' });
  try {
    const result = await db.query(
      `INSERT INTO sequences (id, name, ops) VALUES ($1, $2, $3) RETURNING *`,
      [id, name, JSON.stringify(ops || [])]
    );
    res.status(201).json(rowToSequence(result.rows[0]));
  } catch (err) {
    if (err.code === '23505') return res.status(409).json({ error: `Ya existe la secuencia ${id}` });
    console.error('POST sequence error:', err);
    res.status(500).json({ error: 'Error al crear la secuencia' });
  }
});

router.put('/:id', async (req, res) => {
  const { name, ops } = req.body;
  try {
    const result = await db.query(
      `UPDATE sequences SET name = COALESCE($1, name), ops = COALESCE($2, ops) WHERE id = $3 RETURNING *`,
      [name, ops ? JSON.stringify(ops) : null, req.params.id]
    );
    if (!result.rows.length) return res.status(404).json({ error: 'Secuencia no encontrada' });
    res.json(rowToSequence(result.rows[0]));
  } catch (err) {
    console.error('PUT sequence error:', err);
    res.status(500).json({ error: 'Error al actualizar la secuencia' });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const result = await db.query('DELETE FROM sequences WHERE id = $1 RETURNING id', [req.params.id]);
    if (!result.rows.length) return res.status(404).json({ error: 'Secuencia no encontrada' });
    res.json({ ok: true });
  } catch (err) {
    console.error('DELETE sequence error:', err);
    res.status(500).json({ error: 'Error al eliminar la secuencia' });
  }
});

module.exports = router;
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/operations.js backend/src/routes/sequences.js
git commit -m "feat: endpoints de operations y CRUD de sequences"
```

---

### Task 10: `calendar` y `sim` (singletons)

**Files:**
- Create: `backend/src/routes/calendar.js`
- Create: `backend/src/routes/sim.js`

**Interfaces:**
- Produces: `GET/PUT /api/calendar` — reemplaza `togWD`/`addHol`/`delHol` (todas mandan el objeto calendario completo actualizado, igual que hoy `saveDB()` persiste `DB.calendar` entero).
- Produces: `GET/PUT /api/sim` — reemplaza `saveSimParams`.

- [ ] **Step 1: Escribir `backend/src/routes/calendar.js`**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { rowToCalendar } = require('../mappers');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM calendar WHERE id = true');
    res.json(result.rows[0] ? rowToCalendar(result.rows[0]) : { workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] });
  } catch (err) {
    console.error('GET calendar error:', err);
    res.status(500).json({ error: 'Error al obtener el calendario' });
  }
});

router.put('/', async (req, res) => {
  const { workDays, hoursPerDay, holidays } = req.body;
  try {
    const result = await db.query(
      `UPDATE calendar SET
         work_days = COALESCE($1, work_days),
         hours_per_day = COALESCE($2, hours_per_day),
         holidays = COALESCE($3, holidays)
       WHERE id = true RETURNING *`,
      [workDays ? JSON.stringify(workDays) : null, hoursPerDay || null, holidays ? JSON.stringify(holidays) : null]
    );
    res.json(rowToCalendar(result.rows[0]));
  } catch (err) {
    console.error('PUT calendar error:', err);
    res.status(500).json({ error: 'Error al actualizar el calendario' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Escribir `backend/src/routes/sim.js`**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { rowToSim } = require('../mappers');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sim_params WHERE id = true');
    res.json(result.rows[0] ? rowToSim(result.rows[0]) : { leadOC: 0, leadEng: 0, engCap: 1, targetUEq: 6, modelLeads: [], modelUEq: [] });
  } catch (err) {
    console.error('GET sim error:', err);
    res.status(500).json({ error: 'Error al obtener parámetros de simulación' });
  }
});

router.put('/', async (req, res) => {
  const { leadOC, leadEng, engCap, targetUEq, modelLeads, modelUEq } = req.body;
  try {
    const result = await db.query(
      `UPDATE sim_params SET
         lead_oc = COALESCE($1, lead_oc),
         lead_eng = COALESCE($2, lead_eng),
         eng_cap = COALESCE($3, eng_cap),
         target_ueq = COALESCE($4, target_ueq),
         model_leads = COALESCE($5, model_leads),
         model_ueq = COALESCE($6, model_ueq)
       WHERE id = true RETURNING *`,
      [leadOC ?? null, leadEng ?? null, engCap ?? null, targetUEq ?? null,
       modelLeads ? JSON.stringify(modelLeads) : null, modelUEq ? JSON.stringify(modelUEq) : null]
    );
    res.json(rowToSim(result.rows[0]));
  } catch (err) {
    console.error('PUT sim error:', err);
    res.status(500).json({ error: 'Error al actualizar parámetros de simulación' });
  }
});

module.exports = router;
```

- [ ] **Step 3: Commit**

```bash
git add backend/src/routes/calendar.js backend/src/routes/sim.js
git commit -m "feat: endpoints singleton de calendar y sim"
```

---

### Task 11: `POST /api/schedule/run`

**Files:**
- Create: `backend/src/routes/schedule.js`

**Interfaces:**
- Consumes: `services/schedulerCore.runSchedule` (Task 3), `services/lock.withLock` (Task 4), `mappers.{rowToOrder, orderFieldsToRow, rowToResource, rowToGroup, rowToSequence, rowToCalendar, rowToSim}` (Task 2).
- Produces: `POST /api/schedule/run` con body `{ target: 'all' | orderId, respectCap: boolean, strictPrio: boolean }` → persiste las órdenes recalculadas y devuelve `{ orders, scheduledCount, skippedCount }`.

- [ ] **Step 1: Escribir `backend/src/routes/schedule.js`**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const { withLock } = require('../services/lock');
const { runSchedule } = require('../services/schedulerCore');
const {
  rowToOrder, orderFieldsToRow, rowToResource, rowToGroup, rowToSequence, rowToCalendar, rowToSim,
} = require('../mappers');

router.post('/run', async (req, res) => {
  const { target, respectCap = true, strictPrio = true } = req.body;
  if (!target) return res.status(400).json({ error: 'target es requerido ("all" o un id de orden)' });

  try {
    const result = await withLock(async () => {
      const client = await db.getClient();
      try {
        await client.query('BEGIN');

        const [ordersR, resourcesR, groupsR, seqsR, calR, simR] = await Promise.all([
          client.query('SELECT * FROM orders'),
          client.query('SELECT * FROM resources'),
          client.query('SELECT * FROM resource_groups'),
          client.query('SELECT * FROM sequences'),
          client.query('SELECT * FROM calendar WHERE id = true'),
          client.query('SELECT * FROM sim_params WHERE id = true'),
        ]);

        const state = {
          orders: ordersR.rows.map(rowToOrder),
          resources: resourcesR.rows.map(rowToResource),
          resourceGroups: groupsR.rows.map(rowToGroup),
          sequences: seqsR.rows.map(rowToSequence),
          calendar: calR.rows[0] ? rowToCalendar(calR.rows[0]) : { workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] },
          sim: simR.rows[0] ? rowToSim(simR.rows[0]) : { leadOC: 0, leadEng: 0, engCap: 1, targetUEq: 6, modelLeads: [], modelUEq: [] },
        };

        const { orders, scheduledCount, skippedCount } = runSchedule(state, { target, respectCap, strictPrio });

        for (const o of orders) {
          const row = orderFieldsToRow(o);
          const cols = Object.keys(row);
          const setClause = cols.map((c, i) => `${c} = $${i + 2}`).join(', ');
          await client.query(`UPDATE orders SET ${setClause} WHERE id = $1`, [o.id, ...cols.map(c => row[c])]);
        }

        await client.query('COMMIT');
        return { orders, scheduledCount, skippedCount };
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    });

    res.json(result);
  } catch (err) {
    console.error('POST /api/schedule/run error:', err);
    res.status(500).json({ error: 'Error al ejecutar el scheduling' });
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/schedule.js
git commit -m "feat: endpoint POST /api/schedule/run con lock y transacción"
```

---

### Task 12: `backup` (export/import completo)

**Files:**
- Create: `backend/src/routes/backup.js`

**Interfaces:**
- Produces: `GET /api/backup` → todo el estado en el mismo shape que `sica_2026-09-23.json` (reemplaza `xport()`). `POST /api/backup/import` → reemplaza TODO el dataset dentro de una transacción (reemplaza `xmport()` — función administrativa, usar con cuidado).

- [ ] **Step 1: Escribir `backend/src/routes/backup.js`**

```js
const express = require('express');
const router = express.Router();
const db = require('../db');
const {
  rowToOrder, orderFieldsToRow, rowToResource, rowToGroup, rowToSequence, rowToCalendar, rowToSim,
} = require('../mappers');

router.get('/', async (req, res) => {
  try {
    const [orders, resources, groups, ops, seqs, cal, sim] = await Promise.all([
      db.query('SELECT * FROM orders'),
      db.query('SELECT * FROM resources'),
      db.query('SELECT * FROM resource_groups'),
      db.query('SELECT name FROM operations ORDER BY name'),
      db.query('SELECT * FROM sequences'),
      db.query('SELECT * FROM calendar WHERE id = true'),
      db.query('SELECT * FROM sim_params WHERE id = true'),
    ]);
    res.json({
      orders: orders.rows.map(rowToOrder),
      resources: resources.rows.map(rowToResource),
      resourceGroups: groups.rows.map(rowToGroup),
      operations: ops.rows.map(r => r.name),
      sequences: seqs.rows.map(rowToSequence),
      calendar: cal.rows[0] ? rowToCalendar(cal.rows[0]) : { workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] },
      sim: sim.rows[0] ? rowToSim(sim.rows[0]) : { leadOC: 0, leadEng: 0, engCap: 1, targetUEq: 6, modelLeads: [], modelUEq: [] },
    });
  } catch (err) {
    console.error('GET /api/backup error:', err);
    res.status(500).json({ error: 'Error al exportar el backup' });
  }
});

// POST /api/backup/import — reemplaza TODO el dataset. Función administrativa.
router.post('/import', async (req, res) => {
  const d = req.body;
  if (!d || !Array.isArray(d.orders)) return res.status(400).json({ error: 'Archivo inválido: falta orders[]' });

  const client = await db.getClient();
  try {
    await client.query('BEGIN');
    await client.query('DELETE FROM orders');
    await client.query('DELETE FROM resource_groups');
    await client.query('DELETE FROM resources');
    await client.query('DELETE FROM sequences');
    await client.query('DELETE FROM operations');

    for (const name of (d.operations || [])) {
      await client.query('INSERT INTO operations (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
    }
    for (const r of (d.resources || [])) {
      await client.query(
        `INSERT INTO resources (id, name, color, capacity, active, absences) VALUES ($1,$2,$3,$4,$5,$6)`,
        [r.id, r.name, r.color, r.capacity || 2, r.active !== false, JSON.stringify(r.absences || [])]
      );
    }
    for (const g of (d.resourceGroups || [])) {
      await client.query(
        `INSERT INTO resource_groups (id, name, members) VALUES ($1,$2,$3)`,
        [g.id, g.name, JSON.stringify(g.members || [])]
      );
    }
    for (const s of (d.sequences || [])) {
      await client.query(
        `INSERT INTO sequences (id, name, ops) VALUES ($1,$2,$3)`,
        [s.id, s.name, JSON.stringify(s.ops || [])]
      );
    }
    for (const o of (d.orders || [])) {
      const row = orderFieldsToRow(o);
      const columns = ['id', ...Object.keys(row)];
      const values = [o.id, ...Object.values(row)];
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      await client.query(`INSERT INTO orders (${columns.join(', ')}) VALUES (${placeholders.join(', ')})`, values);
    }
    if (d.calendar) {
      await client.query(
        `UPDATE calendar SET work_days=$1, hours_per_day=$2, holidays=$3 WHERE id = true`,
        [JSON.stringify(d.calendar.workDays || [1,2,3,4,5]), d.calendar.hoursPerDay || 8, JSON.stringify(d.calendar.holidays || [])]
      );
    }
    if (d.sim) {
      await client.query(
        `UPDATE sim_params SET lead_oc=$1, lead_eng=$2, eng_cap=$3, target_ueq=$4, model_leads=$5, model_ueq=$6 WHERE id = true`,
        [d.sim.leadOC || 0, d.sim.leadEng || 0, d.sim.engCap || 1, d.sim.targetUEq ?? 6,
         JSON.stringify(d.sim.modelLeads || []), JSON.stringify(d.sim.modelUEq || [])]
      );
    }

    await client.query('COMMIT');
    res.json({ ok: true, ordersImported: d.orders.length });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('POST /api/backup/import error:', err);
    res.status(500).json({ error: 'Error al importar el backup: ' + err.message });
  } finally {
    client.release();
  }
});

module.exports = router;
```

- [ ] **Step 2: Commit**

```bash
git add backend/src/routes/backup.js
git commit -m "feat: endpoints de backup export/import"
```

---

### Task 13: `seed.js`

**Files:**
- Create: `backend/seed.js`

**Interfaces:**
- Consumes: `sica_2026-09-23.json` (raíz del repo) como fuente de datos.
- Produces: script standalone ejecutable con `node seed.js` / `docker exec <backend> node seed.js`, idempotente vía `ON CONFLICT`.

- [ ] **Step 1: Escribir `backend/seed.js`**

```js
const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');
const { orderFieldsToRow } = require('./src/mappers');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://sica:sica_secure_2024@localhost:5432/sica_semis',
});

const DATA_PATH = process.env.SEED_FILE || path.join(__dirname, '..', 'sica_2026-09-23.json');

async function seed() {
  const client = await pool.connect();
  try {
    console.log(`Cargando dataset desde ${DATA_PATH} ...`);
    const d = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

    await client.query('BEGIN');

    let opCount = 0;
    for (const name of (d.operations || [])) {
      await client.query('INSERT INTO operations (name) VALUES ($1) ON CONFLICT DO NOTHING', [name]);
      opCount++;
    }
    console.log(`Operaciones: ${opCount}`);

    let resCount = 0;
    for (const r of (d.resources || [])) {
      await client.query(
        `INSERT INTO resources (id, name, color, capacity, active, absences)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, color=EXCLUDED.color,
           capacity=EXCLUDED.capacity, active=EXCLUDED.active, absences=EXCLUDED.absences`,
        [r.id, r.name, r.color, r.capacity || 2, r.active !== false, JSON.stringify(r.absences || [])]
      );
      resCount++;
    }
    console.log(`Recursos: ${resCount}`);

    let grpCount = 0;
    for (const g of (d.resourceGroups || [])) {
      await client.query(
        `INSERT INTO resource_groups (id, name, members) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, members=EXCLUDED.members`,
        [g.id, g.name, JSON.stringify(g.members || [])]
      );
      grpCount++;
    }
    console.log(`Grupos de recursos: ${grpCount}`);

    let seqCount = 0;
    for (const s of (d.sequences || [])) {
      await client.query(
        `INSERT INTO sequences (id, name, ops) VALUES ($1,$2,$3)
         ON CONFLICT (id) DO UPDATE SET name=EXCLUDED.name, ops=EXCLUDED.ops`,
        [s.id, s.name, JSON.stringify(s.ops || [])]
      );
      seqCount++;
    }
    console.log(`Secuencias: ${seqCount}`);

    let orderCount = 0;
    for (const o of (d.orders || [])) {
      const row = orderFieldsToRow(o);
      const columns = ['id', ...Object.keys(row)];
      const values = [o.id, ...Object.values(row)];
      const placeholders = columns.map((_, i) => `$${i + 1}`);
      const updateSet = Object.keys(row).map(c => `${c}=EXCLUDED.${c}`).join(', ');
      await client.query(
        `INSERT INTO orders (${columns.join(', ')}) VALUES (${placeholders.join(', ')})
         ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
        values
      );
      orderCount++;
    }
    console.log(`Órdenes: ${orderCount}`);

    if (d.calendar) {
      await client.query(
        `UPDATE calendar SET work_days=$1, hours_per_day=$2, holidays=$3 WHERE id = true`,
        [JSON.stringify(d.calendar.workDays || [1,2,3,4,5]), d.calendar.hoursPerDay || 8, JSON.stringify(d.calendar.holidays || [])]
      );
      console.log('Calendario actualizado');
    }

    if (d.sim) {
      await client.query(
        `UPDATE sim_params SET lead_oc=$1, lead_eng=$2, eng_cap=$3, target_ueq=$4, model_leads=$5, model_ueq=$6 WHERE id = true`,
        [d.sim.leadOC || 0, d.sim.leadEng || 0, d.sim.engCap || 1, d.sim.targetUEq ?? 6,
         JSON.stringify(d.sim.modelLeads || []), JSON.stringify(d.sim.modelUEq || [])]
      );
      console.log('Parámetros de simulación actualizados');
    }

    await client.query('COMMIT');
    console.log('\nSeed completado correctamente.');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('Seed error:', err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

seed();
```

- [ ] **Step 2: Commit**

```bash
git add backend/seed.js
git commit -m "feat: seed.js que carga sica_2026-09-23.json"
```

---

### Task 14: `backend/Dockerfile`

**Files:**
- Create: `backend/Dockerfile`

- [ ] **Step 1: Escribir `backend/Dockerfile`** (idéntico al patrón de incentivos)

```dockerfile
FROM node:20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev
COPY . .
EXPOSE 3001
CMD ["node", "src/index.js"]
```

- [ ] **Step 2: Commit**

```bash
git add backend/Dockerfile
git commit -m "feat: Dockerfile del backend"
```

---

### Task 15: Frontend — capa de persistencia (`frontend/index.html`)

Esta tarea copia `SICA_Programacion.html` a `frontend/index.html` y reemplaza exclusivamente la capa de persistencia. **No se toca ninguna función de render** (`renderDash`, `renderOrders`, `renderGantt`, `renderRes`, `renderSeqs`, `renderConfig`, `renderOTDetail`) ni el motor de scheduling en sí (que ahora vive server-side) — solo los puntos donde el HTML leía/escribía `DB`/`localStorage`.

**Files:**
- Create: `frontend/index.html` (copia editada de `SICA_Programacion.html`)

**Interfaces:**
- Produces: mismo `DB` global en memoria que ya consume todo el código de render (misma forma: `DB.orders`, `DB.resources`, etc.) — solo cambia CÓMO se llena/persiste.

- [ ] **Step 1: Copiar el archivo base**

```bash
cp SICA_Programacion.html frontend/index.html
```

- [ ] **Step 2: Reemplazar el bloque de `DB` (líneas ~253–259 del original) por un cliente API**

Buscar en `frontend/index.html`:

```js
const INITIAL={...};
// ── DB ────────────────────────────────────────────────────────
const DBK='sica_v6';let DB;
function loadDB(){try{DB=JSON.parse(localStorage.getItem(DBK))||cp(INITIAL);}catch(e){DB=cp(INITIAL);}DB.orders=DB.orders||[];DB.resources=DB.resources||[];DB.operations=DB.operations||[];DB.sequences=DB.sequences||[];DB.resourceGroups=DB.resourceGroups||[];DB.calendar=DB.calendar||{workDays:[1,2,3,4,5],hoursPerDay:8,holidays:[]};}
let _noPersist=false; // en true, doSchedule no escribe en localStorage (simulaciones what-if)
function saveDB(){if(_noPersist)return;localStorage.setItem(DBK,JSON.stringify(DB));}
function cp(o){return JSON.parse(JSON.stringify(o));}
```

Reemplazar por (se elimina la constante `INITIAL` — ya no hace falta, la fuente de verdad es Postgres):

```js
// ── DB / API CLIENT ──────────────────────────────────────────
const API='/api';
let DB={orders:[],resources:[],operations:[],sequences:[],resourceGroups:[],calendar:{workDays:[1,2,3,4,5],hoursPerDay:8,holidays:[]},sim:{modelLeads:[],modelUEq:[]}};
async function apiGet(path){const r=await fetch(API+path);if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||r.statusText);return r.json();}
async function apiSend(method,path,body){const r=await fetch(API+path,{method,headers:{'Content-Type':'application/json'},body:body!==undefined?JSON.stringify(body):undefined});if(!r.ok)throw new Error((await r.json().catch(()=>({}))).error||r.statusText);return r.status===204?null:r.json();}
async function loadDB(){DB=await apiGet('/state');}
let _noPersist=false; // en true, runSched() no dispara persistencia (simulaciones what-if locales)
function saveDB(){/* no-op: cada mutación puntual persiste contra su endpoint (ver write-points) */}
function cp(o){return JSON.parse(JSON.stringify(o));}
```

- [ ] **Step 3: Cambiar el arranque de la app (buscar la línea que llama `loadDB()` en el `<script>` de bootstrap, cerca del final del archivo) para esperar la promesa**

Buscar (patrón típico al final del script, antes de `nav('dashboard')` o similar):

```js
loadDB();
```

Reemplazar por:

```js
loadDB().then(()=>nav(CV)).catch(e=>{console.error('[loadDB]',e);toast('No se pudo conectar con el servidor: '+e.message,'danger');});
```

(Si el arranque original ya llama a `nav('dashboard')` o `go(CV)` inmediatamente después de `loadDB()`, mover esa llamada adentro del `.then()` como en el reemplazo de arriba, para no renderizar con `DB` vacío.)

- [ ] **Step 4: Reemplazar `doSchedule` para que llame al backend**

Buscar la firma `function doSchedule(noUI=false){` (línea ~573 del original) y **todo el cuerpo de la función** (hasta su cierre en la línea ~810, justo antes de `function openSched`). Reemplazar la función completa por:

```js
async function doSchedule(noUI=false){
  const respectCap=document.getElementById('fSchedCap').checked;
  const strictPrio=document.getElementById('fSchedStrict')?.checked??true;
  const target=schedTarget;
  try{
    const {orders,scheduledCount,skippedCount}=await apiSend('POST','/schedule/run',{target,respectCap,strictPrio});
    const byId={};orders.forEach(o=>{byId[o.id]=o;});
    DB.orders=DB.orders.map(o=>byId[o.id]?{...o,...byId[o.id]}:o);
    if(!noUI){
      bootstrap.Modal.getInstance(document.getElementById('mSched')).hide();
      toast(`${scheduledCount} orden(es) programada(s) desde hoy${skippedCount?` · ${skippedCount} sin secuencia`:''}`,skippedCount?'warning':'success');
      gStart=null;
      if(CV==='otdetail')renderOTDetail();else go(CV);
    }
  }catch(e){
    console.error('[doSchedule]',e);
    toast('Error al programar: '+e.message,'danger');
  }
}
```

Nota: esto preserva la firma `doSchedule(noUI)` y el nombre global, así que **ningún call site necesita cambiar** — todos los `onclick="doSchedule()"`, `try{...doSchedule(true);...}catch` inline, etc., siguen funcionando igual. Como ahora es `async`, los call sites que hacían `doSchedule(true)` de forma sincrónica (p. ej. dentro de `saveOrder`, `saveSimParams`, `confirmSim`) simplemente disparan la promesa sin esperarla — igual que el resto del patrón fire-and-forget que ya usa el HTML para esas llamadas (no había `await` tampoco en el original, porque `doSchedule` era síncrona pero el resultado se usaba solo para refrescar la UI más tarde). Verificar en cada call site (Step 5) que esto sigue siendo aceptable.

- [ ] **Step 5: Adaptar cada punto de escritura para pegar contra su endpoint**

Esta es la lista completa de funciones de mutación a editar (todas siguen el mismo patrón: arman el objeto localmente, antes llamaban `saveDB()`; ahora llaman `await apiSend(...)` con el objeto/patch correspondiente, y refrescan `DB` con la respuesta). Patrón general por función:

| Función (línea aprox. original) | Reemplazo de la persistencia |
|---|---|
| `saveOrder` (2803) | Si es alta: `POST /orders` con el objeto completo. Si es multi-cantidad: un `POST /orders` por unidad. Luego `doSchedule(true)` (ya migrado, sin cambios de firma). |
| `delO` (1279) | `DELETE /orders/:id` |
| `saveRes` (2350) | `POST /resources` (alta) o `PUT /resources/:id` (edición) |
| `delR` (2354) | `DELETE /resources/:id` |
| `addAbs`/`delAbs` (2407/2418) | `PUT /resources/:id` con `{absences: r.absences}` (el array completo ya mutado localmente, igual que hoy) |
| `saveSeq` (2597) | `POST /sequences` (alta) o `PUT /sequences/:id` (edición) |
| `delSq` (2608) | `DELETE /sequences/:id` |
| `addOpN` (2730) | `POST /operations` con `{name}` |
| `delOp` (2731) | `DELETE /operations/:name` (usar `encodeURIComponent`) |
| `togWD` (2732) | `PUT /calendar` con `{workDays: DB.calendar.workDays}` (ya mutado localmente) |
| `addHol`/`delHol` (2733/2772) | `PUT /calendar` con `{holidays: DB.calendar.holidays}` |
| `saveSimParams` (2749) | `PUT /sim` con el objeto `sim` armado localmente, luego `doSchedule(true)` |
| `openGM`/`saveGrp`/`delGrp` (3224/3236/3248) | `saveGrp`: `POST /resource-groups` (alta) o `PUT /resource-groups/:id` (edición). `delGrp`: `DELETE /resource-groups/:id` |
| Escrituras inline en `renderOTDetail` sobre `opProgress`/`opPreds`/`opManualStarts`/`opExtra`/`opOrder`/`opSkip`/`opResources`/`opDays` (líneas 1757–2220) | Todas terminan en un `saveDB()`; reemplazar por `await apiSend('PUT','/orders/'+o.id,{<campo mutado>: o.<campo mutado>})` — solo el/los campos que esa función tocó, ya mutados en el objeto local `o` (que sigue siendo una referencia dentro de `DB.orders`). |
| `confirmSim` (2369) | El cambio de `id` de la orden (pasar de simulación a OT real) requiere `DELETE /orders/:oldId` + `POST /orders` con el nuevo `id` (Postgres no permite `UPDATE` de una primary key referenciada implícitamente sin romper la fila — más simple recrearla). Luego `doSchedule(true)`. |
| `xport` | Reemplazar por `const d=await apiGet('/backup'); /* descargar como Blob igual que antes */` |
| `xmport` | Reemplazar por `await apiSend('POST','/backup/import', JSON.parse(texto)); await loadDB(); go(CV);` |
| `xreset` | **Eliminar la función y el botón que la invoca** (ver Global Constraints — ya no hay `INITIAL` embebido). Buscar `onclick="xreset()"` en el HTML de configuración y quitar el botón correspondiente. |

Cada fila de la tabla es un sub-paso: abrir el archivo en la línea indicada, cambiar el cuerpo de la función siguiendo el patrón "arma el objeto local → `await apiSend(...)` → si la función ya actualiza el DOM después de `saveDB()`, dejar esa parte igual". Ir función por función, probando en el navegador después de cada 3–4 funciones migradas (ver Task 17 para cómo levantar el entorno de prueba).

- [ ] **Step 6: Commit**

```bash
git add frontend/index.html
git commit -m "feat: adaptar frontend para consumir la API en vez de localStorage"
```

---

### Task 16: `frontend/Dockerfile` + `frontend/nginx.conf`

**Files:**
- Create: `frontend/Dockerfile`
- Create: `frontend/nginx.conf`

**Interfaces:**
- Produces: imagen nginx sirviendo `frontend/index.html` como estático, sin build step (a diferencia de incentivos, que compila con Vite). Rutea `/api` al contenedor backend — mismo patrón anti-doble-proxy de la lección aprendida en incentivos.

- [ ] **Step 1: Escribir `frontend/Dockerfile`**

```dockerfile
FROM nginx:alpine
COPY index.html /usr/share/nginx/html/index.html
COPY nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

- [ ] **Step 2: Escribir `frontend/nginx.conf`**

```nginx
server {
    listen 80;
    root /usr/share/nginx/html;
    index index.html;

    location /api {
        proxy_pass http://backend:3001;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

- [ ] **Step 3: Commit**

```bash
git add frontend/Dockerfile frontend/nginx.conf
git commit -m "feat: Dockerfile y nginx.conf del frontend"
```

---

### Task 17: `docker-compose.yml` + README + verificación end-to-end

**Files:**
- Create: `docker-compose.yml`
- Create: `README.md`

**Interfaces:**
- Produces: los 3 servicios (`db`, `backend`, `frontend`) orquestados, listos para `docker compose up -d --build` + `docker exec sica_semis_backend node seed.js`.

- [ ] **Step 1: Escribir `docker-compose.yml`**

```yaml
version: '3.8'

services:
  db:
    image: postgres:16
    container_name: sica_semis_db
    volumes:
      - ./data/postgres:/var/lib/postgresql/data
    environment:
      POSTGRES_DB: ${POSTGRES_DB:-sica_semis}
      POSTGRES_USER: ${POSTGRES_USER:-sica}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-sica_secure_pass}
    restart: always
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER:-sica}"]
      interval: 5s
      timeout: 5s
      retries: 5

  backend:
    build: ./backend
    container_name: sica_semis_backend
    depends_on:
      db:
        condition: service_healthy
    environment:
      DATABASE_URL: postgresql://${POSTGRES_USER:-sica}:${POSTGRES_PASSWORD:-sica_secure_pass}@db:5432/${POSTGRES_DB:-sica_semis}
      NODE_ENV: production
      PORT: 3001
    ports:
      - "3011:3001"
    restart: always

  frontend:
    build: ./frontend
    container_name: sica_semis_frontend
    ports:
      - "3010:80"
    depends_on:
      - backend
    restart: always
```

- [ ] **Step 2: Escribir `README.md`**

```markdown
# SICA — Programación de Producción de Semirremolques

App fullstack para la programación (scheduling) de producción de semirremolques de SICA Metalúrgica Argentina. Migrada desde `SICA_Programacion.html` (single-file, `localStorage`) a backend Node.js + PostgreSQL + frontend estático.

## Requisitos

- Docker y Docker Compose
- (Opcional, para desarrollo local) Node.js 20+, PostgreSQL 16

## Inicio rápido

\`\`\`bash
cp .env.example .env
# Editar .env con valores reales en producción

docker compose up -d --build

# Esperar ~15s a que la DB inicialice, luego cargar el dataset real
docker exec sica_semis_backend node seed.js

# Frontend: http://localhost:3010
# Backend:  http://localhost:3011/api/health
\`\`\`

## Reconstrucción de contenedores

Reconstruir los contenedores borra el volumen de datos si se borra `./data/postgres` a mano; si NO se borra ese directorio, los datos persisten entre `docker compose up --build`. Para reponer datos desde cero:

\`\`\`bash
docker exec sica_semis_backend node seed.js
\`\`\`

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
```

- [ ] **Step 3: Levantar el stack completo y verificar**

Run: `docker compose up -d --build`
Expected: los 3 contenedores en estado `running` (`docker compose ps`).

Run: `curl http://localhost:3011/api/health`
Expected: `{"status":"ok","timestamp":"..."}`

Run: `docker exec sica_semis_backend node seed.js`
Expected: log terminando en "Seed completado correctamente." con conteos: 21 operaciones, 33 recursos, 2 grupos, 12 secuencias, 38 órdenes.

Run: `curl http://localhost:3011/api/state | node -e "const d=JSON.parse(require('fs').readFileSync(0));console.log(d.orders.length, d.resources.length, d.sequences.length)"`
Expected: `38 33 12`

Run: `curl -X POST http://localhost:3011/api/schedule/run -H "Content-Type: application/json" -d '{"target":"all","respectCap":true,"strictPrio":true}'`
Expected: JSON con `scheduledCount` > 0 y sin error 500.

Run (navegador): abrir `http://localhost:3010`, confirmar que el dashboard carga las 38 órdenes, que el Gantt las muestra, y que crear/editar una orden de prueba persiste tras refrescar la página (F5).

- [ ] **Step 4: Commit**

```bash
git add docker-compose.yml README.md
git commit -m "feat: docker-compose, README y verificación end-to-end"
```

---

### Task 18: nginx externo (server `sicalab`) — snippet propuesto

No se puede editar el nginx externo del server desde este entorno (no hay acceso a `192.168.0.195`). Esta tarea deja preparado el snippet para que Hernán lo pegue en `/mnt/disco1/sicalab/nginx/nginx.conf`, replicando el patrón de `incentivos.sica` (ruteo completo, incluyendo `/api`, hacia el contenedor de frontend — así se evita el problema de doble-proxy que ya se resolvió una vez en incentivos).

**Files:**
- Create: `docs/nginx-externo-programacion.conf` (snippet de referencia, no se aplica automáticamente)

- [ ] **Step 1: Escribir el snippet propuesto**

```nginx
# Agregar este server block a /mnt/disco1/sicalab/nginx/nginx.conf
# Hostname sugerido: programacion.sica (alternativa: semirremolques.sica — confirmar con Hernán)
server {
    listen 80;
    server_name programacion.sica;

    # TODO el tráfico, incluyendo /api, va al frontend (que internamente
    # proxyea /api a su propio backend). Replica el patrón que resolvió
    # el problema de doble-proxy en incentivos.sica — no partir el ruteo acá.
    location / {
        proxy_pass http://localhost:3010;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    }
}
```

- [ ] **Step 2: Commit**

```bash
git add docs/nginx-externo-programacion.conf
git commit -m "docs: snippet propuesto para el nginx externo del server sicalab"
```

---

## Self-Review

**Cobertura del spec** (contra la sección "Qué necesito que entregues" de `prompt-migracion-programacion-semis.md`):
1. Estructura del proyecto → File Structure + Tasks 1–17. ✓
2. Modelo de datos → Task 1 (`001_initial.sql`), cubre los 30 campos de `orders` listados explícitamente en el prompt, más `resources`, `resourceGroups`, `operations`, `sequences`, `calendar`, `sim`. ✓
3. Backend con CRUD + `POST /api/schedule/run` → Tasks 5–12. ✓
4. `seed.js` → Task 13. ✓
5. Frontend adaptado → Task 15 (persistencia) + Task 16 (Docker/nginx del contenedor). ✓
6. nginx interno + snippet externo → Task 16 (interno) + Task 18 (externo, propuesto). ✓
7. Resumen de decisiones/pendientes → ver mensaje final de esta conversación (fuera del plan, se entrega directamente al usuario).

**Placeholders**: revisado — no quedan `TODO`/`fill in`/pseudocódigo; todo el código de cada Step es código real y completo. El único `TODO` textual es un comentario dentro del snippet de nginx externo (Task 18), que es intencional: señala una decisión pendiente de Hernán (hostname), no una omisión de implementación.

**Consistencia de tipos/nombres**: `runSchedule(state, opts)` se invoca igual en Task 3 (tests) y Task 11 (`routes/schedule.js`); `orderFieldsToRow`/`rowToOrder` se usan con la misma firma en Tasks 2, 6, 11, 12 y 13; `withLock` se define en Task 4 y se consume en Task 11.

---

## Resumen de decisiones tomadas y pendientes de confirmar con Hernán

**Decisiones tomadas** (con base en inspección directa de `modelo-incentivos` en disco):
- Motor de DB: **PostgreSQL 16** (mismo que incentivos).
- Sin build step en el frontend (HTML/JS estático servido tal cual por nginx) — el frontend de incentivos usa React/Vite, pero acá no aplica porque el código fuente ya es un único HTML sin build.
- Lock de scheduling: mutex en memoria (backend single-process).
- `xreset()` se retira del frontend (ya no tiene sentido con Postgres como fuente de verdad).
- Nombres de contenedores con prefijo `sica_semis_` y puertos de host `3010`/`3011` (frontend/backend) para no chocar con los `3000`/`3001`/`5432` que ya ocupa incentivos en el mismo server `sicalab`. La DB de este proyecto no se expone a host (mejora sobre el patrón de incentivos).

**Pendiente de confirmar con Hernán:**
1. **Hostname final**: propongo `programacion.sica` (alternativa: `semirremolques.sica`).
2. **Snippet del nginx externo** (Task 18): no tengo acceso a `/mnt/disco1/sicalab/nginx/nginx.conf` en el server — el snippet que dejé es una propuesta basada en la lección aprendida documentada en el prompt, pero hay que pegarlo a mano y confirmar que no colisiona con la config real de incentivos.
3. **Retirar `xreset()`**: decisión tomada por default (ver arriba) — avisar si en cambio se prefiere mantenerlo como acción administrativa que re-corre `seed.js` desde el frontend.
4. **Puertos de host** (3010/3011): confirmar que están libres en `sicalab` antes de desplegar.
