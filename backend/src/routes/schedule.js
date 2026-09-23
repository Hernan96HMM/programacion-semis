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
          client.query('SELECT * FROM orders ORDER BY priority NULLS LAST, order_num, unit_num'),
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
