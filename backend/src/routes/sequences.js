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
