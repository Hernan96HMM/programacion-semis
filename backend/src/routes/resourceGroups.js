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
