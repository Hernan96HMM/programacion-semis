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
