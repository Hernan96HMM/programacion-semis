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
