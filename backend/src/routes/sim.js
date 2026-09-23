const express = require('express');
const router = express.Router();
const db = require('../db');
const { rowToSim } = require('../mappers');

router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT * FROM sim_params WHERE id = true');
    res.json(result.rows[0] ? rowToSim(result.rows[0]) : { leadOC: 0, leadEng: 0, engCap: 1, targetUEq: 6, modelLeads: [], modelUEq: [] });
  } catch (err) {
    console.error('GET sim error:', err);
    res.status(500).json({ error: 'Error al obtener parámetros de simulación' });
  }
});

router.put('/', async (req, res) => {
  const { leadOC, leadEng, engCap, targetUEq, modelLeads, modelUEq } = req.body;
  try {
    const result = await db.query(
      `UPDATE sim_params SET
         lead_oc = COALESCE($1, lead_oc),
         lead_eng = COALESCE($2, lead_eng),
         eng_cap = COALESCE($3, eng_cap),
         target_ueq = COALESCE($4, target_ueq),
         model_leads = COALESCE($5, model_leads),
         model_ueq = COALESCE($6, model_ueq)
       WHERE id = true RETURNING *`,
      [leadOC ?? null, leadEng ?? null, engCap ?? null, targetUEq ?? null,
       modelLeads ? JSON.stringify(modelLeads) : null, modelUEq ? JSON.stringify(modelUEq) : null]
    );
    res.json(rowToSim(result.rows[0]));
  } catch (err) {
    console.error('PUT sim error:', err);
    res.status(500).json({ error: 'Error al actualizar parámetros de simulación' });
  }
});

module.exports = router;
