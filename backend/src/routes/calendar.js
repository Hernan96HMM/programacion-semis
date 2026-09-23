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
  if (Array.isArray(workDays) && workDays.length === 0) {
    return res.status(400).json({ error: 'Debe haber al menos un día laborable' });
  }
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
