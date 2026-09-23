// Traduce entre snake_case (filas de Postgres) y camelCase (shape que ya
// consume el frontend, heredado 1:1 del objeto DB del HTML original).

function toISODate(d) {
  if (!d) return null;
  if (typeof d === 'string') return d.slice(0, 10);
  return d.toISOString().slice(0, 10);
}

function rowToOrder(r) {
  return {
    id: r.id,
    orderNum: r.order_num,
    unitNum: r.unit_num,
    peInicial: toISODate(r.pe_inicial),
    client: r.client,
    productType: r.product_type,
    progress: r.progress == null ? 0 : Number(r.progress),
    status: r.status || '',
    dueDate: toISODate(r.due_date),
    notes: r.notes || '',
    ganttWeeks: r.gantt_weeks || {},
    updatedAt: toISODate(r.updated_at),
    isSim: !!r.is_sim,
    priority: r.priority,
    seqId: r.seq_id,
    uEq: r.u_eq == null ? null : Number(r.u_eq),
    simLeadOC: r.sim_lead_oc,
    simLeadEng: r.sim_lead_eng,
    plannedStart: toISODate(r.planned_start),
    opDays: r.op_days,
    opResources: r.op_resources,
    opProgress: r.op_progress,
    opPreds: r.op_preds,
    opExtra: r.op_extra,
    opOrder: r.op_order,
    opSkip: r.op_skip,
    opManualStarts: r.op_manual_starts,
    scheduledOps: r.scheduled_ops || [],
    startDate: toISODate(r.start_date),
    endDate: toISODate(r.end_date),
    _simBaseDate: toISODate(r.sim_base_date),
    _ocEnd: toISODate(r.oc_end),
    _engStart: toISODate(r.eng_start),
    _engEnd: toISODate(r.eng_end),
    _simBaseOT: r.sim_base_ot,
  };
}

// Mapa de camelCase → snake_case para campos de Order.
// Usada por orderFieldsToRow() para traducir objetos de entrada.
const ORDER_COLUMN_MAP = {
  orderNum: 'order_num', unitNum: 'unit_num', peInicial: 'pe_inicial',
  client: 'client', productType: 'product_type', progress: 'progress',
  status: 'status', dueDate: 'due_date', notes: 'notes',
  ganttWeeks: 'gantt_weeks', updatedAt: 'updated_at', isSim: 'is_sim',
  priority: 'priority', seqId: 'seq_id', uEq: 'u_eq',
  simLeadOC: 'sim_lead_oc', simLeadEng: 'sim_lead_eng',
  plannedStart: 'planned_start', opDays: 'op_days', opResources: 'op_resources',
  opProgress: 'op_progress', opPreds: 'op_preds', opExtra: 'op_extra',
  opOrder: 'op_order', opSkip: 'op_skip', opManualStarts: 'op_manual_starts',
  scheduledOps: 'scheduled_ops', startDate: 'start_date', endDate: 'end_date',
  _simBaseDate: 'sim_base_date', _ocEnd: 'oc_end', _engStart: 'eng_start',
  _engEnd: 'eng_end', _simBaseOT: 'sim_base_ot',
};

// Acepta un objeto (parcial o completo) en camelCase y devuelve el mismo objeto
// traducido a snake_case (solo las claves presentes en el input), listo para usarse
// como { columna: valor } en un UPDATE ... SET o INSERT dinámico.
// JSONB columns are JSON.stringified; primitives and null pass through unchanged.
function orderFieldsToRow(fields) {
  const out = {};
  for (const [camel, snake] of Object.entries(ORDER_COLUMN_MAP)) {
    if (Object.prototype.hasOwnProperty.call(fields, camel)) {
      const val = fields[camel];
      out[snake] = (val !== null && typeof val === 'object') ? JSON.stringify(val) : val;
    }
  }
  return out;
}

function rowToResource(r) {
  return {
    id: r.id, name: r.name, color: r.color,
    capacity: r.capacity, active: r.active,
    absences: r.absences || [],
  };
}

function rowToGroup(r) {
  return { id: r.id, name: r.name, members: r.members || [] };
}

function rowToSequence(r) {
  return { id: r.id, name: r.name, ops: r.ops || [] };
}

function rowToCalendar(r) {
  return {
    workDays: r.work_days || [1, 2, 3, 4, 5],
    hoursPerDay: r.hours_per_day || 8,
    holidays: r.holidays || [],
  };
}

function rowToSim(r) {
  return {
    leadOC: r.lead_oc || 0,
    leadEng: r.lead_eng || 0,
    engCap: r.eng_cap || 1,
    targetUEq: r.target_ueq == null ? 6 : Number(r.target_ueq),
    modelLeads: r.model_leads || [],
    modelUEq: r.model_ueq || [],
  };
}

module.exports = {
  rowToOrder, orderFieldsToRow, ORDER_COLUMN_MAP,
  rowToResource, rowToGroup, rowToSequence, rowToCalendar, rowToSim,
};
