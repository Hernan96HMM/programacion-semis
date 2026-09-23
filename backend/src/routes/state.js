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
