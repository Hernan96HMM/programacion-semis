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
