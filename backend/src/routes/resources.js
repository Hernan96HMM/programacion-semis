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
