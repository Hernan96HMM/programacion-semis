const test = require('node:test');
const assert = require('node:assert/strict');
const { runSchedule, parsePreds } = require('./schedulerCore');
const { addWDs } = require('./calendarUtils');

function baseState() {
  return {
    resources: [
      { id: 'A', name: 'Res A', capacity: 1, active: true, absences: [] },
      { id: 'B', name: 'Res B', capacity: 1, active: true, absences: [] },
    ],
    resourceGroups: [],
    sequences: [
      { id: 'seq1', name: 'Producto Test', ops: [
        { name: 'Op1', res: 'A', days: 2, from: 0, to: 0.5 },
        { name: 'Op2', res: 'B', days: 2, from: 0.5, to: 1 },
      ] },
    ],
    calendar: { workDays: [1, 2, 3, 4, 5], hoursPerDay: 8, holidays: [] },
    sim: { leadOC: 0, leadEng: 0, engCap: 1, modelLeads: [], modelUEq: [] },
    orders: [],
  };
}

test('parsePreds: secuencial, libre y explícito', () => {
  assert.equal(parsePreds(''), undefined);
  assert.deepEqual(parsePreds('libre'), []);
  assert.deepEqual(parsePreds('1,3'), [0, 2]);
});

test('runSchedule programa una orden simple respetando la secuencia', () => {
  const state = baseState();
  state.orders = [{
    id: 'OT1', seqId: 'seq1', progress: 0, status: '', priority: 1,
    plannedStart: null, opDays: null, opResources: null, opProgress: null,
    opPreds: null, opExtra: null, opOrder: null, opSkip: null, opManualStarts: null,
    scheduledOps: [], simLeadOC: null, simLeadEng: null,
  }];
  const { orders, scheduledCount, skippedCount } = runSchedule(state, { target: 'OT1', respectCap: true, strictPrio: true });
  assert.equal(scheduledCount, 1);
  assert.equal(skippedCount, 0);
  const o = orders[0];
  assert.equal(o.scheduledOps.length, 2);
  assert.equal(o.scheduledOps[0].res, 'A');
  assert.equal(o.scheduledOps[1].res, 'B');
  assert.ok(o.scheduledOps[1].startDate >= o.scheduledOps[0].endDate);
  assert.equal(o.startDate, o.scheduledOps[0].startDate);
  assert.equal(o.endDate, o.scheduledOps[1].endDate);
});

test('runSchedule respeta prioridad estricta: la OT de menor prioridad no adelanta a la de mayor', () => {
  const state = baseState();
  state.orders = [
    { id: 'HIGH', seqId: 'seq1', progress: 0, status: '', priority: 1, scheduledOps: [] },
    { id: 'LOW', seqId: 'seq1', progress: 0, status: '', priority: 2, scheduledOps: [] },
  ];
  const { orders } = runSchedule(state, { target: 'all', respectCap: true, strictPrio: true });
  const high = orders.find(o => o.id === 'HIGH');
  const low = orders.find(o => o.id === 'LOW');
  // Ambas usan el recurso A primero: HIGH (prioridad 1) debe entrar primero o al mismo tiempo que LOW.
  assert.ok(high.scheduledOps[0].startDate <= low.scheduledOps[0].startDate);
});

test('runSchedule marca skippedCount cuando la orden no tiene secuencia resoluble', () => {
  const state = baseState();
  state.orders = [{ id: 'NOSEQ', seqId: 'no-existe', productType: 'Inexistente', progress: 0, status: '', scheduledOps: [] }];
  const { scheduledCount, skippedCount } = runSchedule(state, { target: 'NOSEQ', respectCap: true, strictPrio: true });
  assert.equal(scheduledCount, 0);
  assert.equal(skippedCount, 1);
});

test('addWDs no entra en loop infinito cuando WD está vacío (guarda de iteración)', () => {
  // Regresión: sin la guarda `g++ < 3650`, isWD nunca es true con WD=[] y
  // el while(c<n) nunca termina, congelando el event loop de Node.
  // Si este test termina (y npm test no cuelga), la guarda funciona.
  const result = addWDs('2026-09-23', 5, new Set(), []);
  assert.equal(typeof result, 'string');
  assert.match(result, /^\d{4}-\d{2}-\d{2}$/);
});
