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
