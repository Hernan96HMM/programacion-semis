const { calDiff, addCalDays, isWD, nextWD, addWDs, todayStr } = require('./calendarUtils');

// ── PRECEDENCIAS ────────────────────────────────────────────────
function parsePreds(str) {
  const s = String(str ?? '').trim().toLowerCase();
  if (s === '' || s === 'anterior') return undefined;
  if (s === 'libre' || s === '-' || s === '0') return [];
  const a = s.split(/[,;]+/).map(x => parseInt(x.trim()) - 1).filter(n => !isNaN(n) && n >= 0);
  return a.length ? a : undefined;
}

function effPreds(o, seq, i) {
  const ov = o?.opPreds?.[i];
  if (ov !== undefined && ov !== null) return parsePreds(ov);
  return seq?.ops?.[i]?.preds;
}

// ── UNIDAD EQUIVALENTE Y PLAZOS PREVIOS ─────────────────────────
function getModelUEq(sim, pt) {
  if (pt) {
    const m = (sim?.modelUEq || []).find(x => x.productType === pt);
    if (m && m.uEq != null) return Math.max(0, +m.uEq);
  }
  return 1;
}

function getSimLead(sim, o) {
  if ((o?.progress || 0) > 0) return { leadOC: 0, leadEng: 0 };
  if (o?.simLeadOC != null || o?.simLeadEng != null) {
    return { leadOC: o.simLeadOC ?? 0, leadEng: o.simLeadEng ?? 0 };
  }
  const pt = o?.productType;
  if (pt) {
    const m = (sim?.modelLeads || []).find(x => x.productType === pt);
    if (m) return { leadOC: m.leadOC ?? 0, leadEng: m.leadEng ?? 0 };
  }
  return { leadOC: sim?.leadOC || 0, leadEng: sim?.leadEng || 0 };
}

// ── CALENDARIOS POR RECURSO ──────────────────────────────────────
function absDates(r) {
  const out = [];
  (r?.absences || []).forEach(a => {
    if (!a.from) return;
    const to = a.to || a.from;
    let d = a.from, g = 0;
    while (d <= to && g++ < 3650) { out.push(d); d = addCalDays(d, 1); }
  });
  return out;
}

function makeHFor(resources, baseH) {
  const cache = {};
  return function (resId) {
    if (!resId) return baseH;
    if (cache[resId]) return cache[resId];
    const r = resources.find(x => x.id === resId);
    const ab = absDates(r);
    cache[resId] = ab.length ? new Set([...baseH, ...ab]) : baseH;
    return cache[resId];
  };
}

function getSeq(sequences, o) {
  if (!o) return null;
  if (o.seqId) {
    const s = sequences.find(s => s.id === o.seqId);
    if (s) return s;
  }
  return sequences.find(s => s.name === o.productType)
    || sequences.find(s => o.productType?.toLowerCase().includes(s.name.toLowerCase()))
    || null;
}

// ── OPERACIONES EFECTIVAS DE LA OT ───────────────────────────────
function hasSkips(o) { return !!(o?.opSkip && Object.keys(o.opSkip).length); }
function hasExtra(o) { return !!(o?.opExtra && o.opExtra.length); }
function needsEff(o) { return hasSkips(o) || hasExtra(o); }

function _applyOrder(o, list) {
  const ord = o?.opOrder || null;
  if (!ord || !ord.length) return list;
  const byI = {};
  list.forEach(x => { byI[x._i] = x; });
  const out = [];
  ord.forEach(ix => { if (byI[ix]) { out.push(byI[ix]); delete byI[ix]; } });
  list.forEach(x => { if (byI[x._i]) out.push(x); });
  return out;
}

function otOps(o, seq) {
  const base = (seq?.ops || []).map((sop, i) => ({
    name: sop.name,
    res: o?.opResources?.[i] || sop.res,
    days: o?.opDays?.[i] || sop.days || 5,
    preds: effPreds(o, seq, i),
    from: sop.from, to: sop.to,
    prog: o?.opProgress ? o.opProgress[i] : undefined,
    _i: i, _x: false,
  }));
  const ex = o?.opExtra || [];
  if (!ex.length) return _applyOrder(o, base);
  const byAfter = {};
  ex.forEach((e, k) => {
    const a = (e.after == null ? base.length - 1 : e.after);
    const _ov = o?.opPreds ? o.opPreds[1000 + k] : undefined;
    (byAfter[a] = byAfter[a] || []).push({
      name: e.name || 'Operación extra',
      res: e.res, days: e.days || 5,
      preds: (_ov !== undefined && _ov !== null) ? parsePreds(_ov) : e.preds,
      from: undefined, to: undefined,
      prog: e.progress,
      _i: 1000 + k, _x: true, _after: a,
    });
  });
  const out = [];
  (byAfter[-1] || []).forEach(e => out.push(e));
  base.forEach((sop, i) => { out.push(sop); (byAfter[i] || []).forEach(e => out.push(e)); });
  Object.keys(byAfter).forEach(k => { const n = +k; if (n >= base.length) byAfter[k].forEach(e => out.push(e)); });
  return _applyOrder(o, out);
}

function effRanges(o, seq) {
  const ops = otOps(o, seq);
  const totSeqDays = (seq?.ops || []).reduce((s, x) => s + (x.days || 5), 0) || 1;
  const w = ops.map(sop => ({
    i: sop._i,
    w: sop._x ? Math.max(0, (sop.days || 5) / totSeqDays) : Math.max(0, (sop.to ?? 1) - (sop.from ?? 0)),
    skip: !!(o?.opSkip && o.opSkip[sop._i]),
  }));
  const tot = w.filter(a => !a.skip).reduce((s, a) => s + a.w, 0);
  const out = {}; let acc = 0;
  w.forEach(a => {
    if (a.skip) { out[a.i] = null; return; }
    const q = tot > 0 ? a.w / tot : 0;
    out[a.i] = { from: acc, to: Math.min(1, acc + q) }; acc += q;
  });
  const lastAct = w.filter(a => !a.skip).pop();
  if (lastAct && out[lastAct.i]) out[lastAct.i].to = 1;
  return out;
}

function calcStatus(sequences, o) {
  if (!o) return '';
  if (o.progress >= 1 || o.status?.toUpperCase().includes('TERMINADO')) return 'TERMINADO';
  const seq = getSeq(sequences, o);
  if (!seq || !seq.ops?.length) return o.status || '';
  const p = o.progress || 0;
  const _list = otOps(o, seq);
  const _er = needsEff(o) ? effRanges(o, seq) : null;
  for (const op of _list) {
    const r = _er ? _er[op._i] : { from: op.from ?? 0, to: op.to ?? 1 };
    if (!r) continue;
    if (p >= r.from && p < r.to) return op.name;
  }
  return p >= 1 ? 'TERMINADO' : ((_list.find(s => !_er || _er[s._i]) || {}).name || o.status || '');
}

// ── RESOLUCIÓN DE GRUPOS DE RECURSOS ─────────────────────────────
function resolveGroupRes(resources, groupId, grp, start, remainingDays, resAvail, H, WD, HFor) {
  if (!grp || !grp.members.length) return { res: groupId, start };
  const _excl = [];
  let mem = grp.members.filter(m => {
    const r = resources.find(x => x.id === m);
    if (!r) { _excl.push(m + ': no existe como recurso'); return false; }
    if (r.active === false) { _excl.push((r.name || m) + ': INACTIVO'); return false; }
    return true;
  });
  if (!mem.length) { mem = grp.members; _excl.length = 0; _excl.push('todos inactivos: se usan igual'); }
  let best = null;
  const _cand = [];
  mem.forEach(memberId => {
    const rr = resources.find(x => x.id === memberId);
    const cap = rr?.capacity || 1;
    const mH = HFor ? HFor(memberId) : H;
    let s = nextWD(start, mH, WD), guard = 0;
    while (guard++ < 100) {
      const _e = addWDs(s, remainingDays, mH, WD);
      const conflicts = (resAvail[memberId] || []).filter(iv => iv.s <= _e && iv.e >= s);
      if (conflicts.length < cap) break;
      conflicts.sort((a, b) => a.e < b.e ? -1 : 1);
      s = nextWD(addCalDays(conflicts[0].e, 1), mH, WD);
    }
    const bk = resAvail[memberId] || [];
    const loadD = bk.reduce((t, iv) => t + Math.max(0, calDiff(iv.s, iv.e)), 0);
    const loadN = bk.length;
    _cand.push({ id: memberId, name: rr?.name || memberId, s, loadD, loadN, cap, abs: absDates(rr).length });
    if (!best || s < best.s || (s === best.s && (loadD < best.loadD || (loadD === best.loadD && loadN < best.loadN)))) {
      best = { res: memberId, s, loadD, loadN };
    }
  });
  const _pick = best ? best.res : mem[0];
  const _diag = 'Grupo ' + (grp.name || groupId) + ' → ' + _cand.map(c =>
    (c.id === _pick ? '✔ ' : '· ') + c.name + ' (libre ' + c.s + ', carga ' + c.loadD + 'd, cap ' + c.cap +
    (c.abs ? ', ' + c.abs + 'd de ausencias' : '') + ')').join(' | ') +
    (_excl.length ? ' | descartados: ' + _excl.join(', ') : '');
  return { res: _pick, start: best ? best.s : start, diag: _diag };
}

// ── MOTOR PRINCIPAL ───────────────────────────────────────────────
// state = { orders, resources, resourceGroups, sequences, calendar, sim } (todo en camelCase)
// opts  = { target: 'all' | orderId, respectCap: boolean, strictPrio: boolean }
function runSchedule(state, opts) {
  const { orders, resources, resourceGroups, sequences, calendar, sim } = state;
  const { target, respectCap, strictPrio } = opts;
  const today = todayStr();
  const isAll = target === 'all';
  const resPrioFloor = {};

  let targets = isAll
    ? orders.filter(o => o.progress < 1 && !(o.status || '').toUpperCase().includes('TERMINADO'))
    : orders.filter(o => o.id === target);

  targets.sort((a, b) => (a.priority || 999) - (b.priority || 999));

  const H = new Set((calendar.holidays || []).map(h => h.date));
  const WD = calendar.workDays || [1, 2, 3, 4, 5];
  const HFor = makeHFor(resources, H);

  if (isAll) {
    targets.forEach(o => {
      o.scheduledOps = []; o.startDate = null; o.endDate = null;
      o._simBaseDate = null; o._ocEnd = null; o._engStart = null; o._engEnd = null;
    });
  }

  const resAvail = {};
  if (respectCap && !isAll) {
    const tIds = new Set(targets.map(o => o.id));
    orders.forEach(o => {
      if (tIds.has(o.id)) return;
      (o.scheduledOps || []).forEach(op => {
        if (!op.startDate || !op.endDate) return;
        const _sid = op.resolvedRes || op.res;
        if (!resAvail[_sid]) resAvail[_sid] = [];
        resAvail[_sid].push({ s: op.startDate, e: op.endDate });
      });
    });
  }

  const engAvail = [];
  if (respectCap && !isAll) {
    const _tIdsEng = new Set(targets.map(o => o.id));
    orders.forEach(o => { if (!_tIdsEng.has(o.id) && o._engStart && o._engEnd) engAvail.push({ s: o._engStart, e: o._engEnd }); });
  }

  const _multiUnitEngEnd = {};
  let n = 0, sk = 0;

  targets.forEach(o => {
    const seq = getSeq(sequences, o);
    if (!seq) { sk++; return; }
    const endDates = {};
    const _erSched = needsEff(o) ? effRanges(o, seq) : null;
    const _leads = getSimLead(sim, o);
    let _basePlanDate = (o.plannedStart && o.plannedStart > today) ? o.plannedStart : today;
    if (o._simBaseOT) {
      const _mue = _multiUnitEngEnd[o._simBaseOT];
      if (_mue && _mue > _basePlanDate) _basePlanDate = _mue;
    }
    const _ocStart = _basePlanDate;
    const _ocEnd = _leads.leadOC > 0 ? addCalDays(_ocStart, _leads.leadOC) : _ocStart;
    o._simBaseDate = _ocStart;
    o._ocEnd = _ocEnd;
    let _fabFrom = _ocEnd;
    if (_leads.leadEng > 0) {
      const engCap = sim?.engCap || 1;
      let engS = _ocEnd;
      let engE = addCalDays(engS, _leads.leadEng);
      if (respectCap) {
        let _eg = 0;
        while (_eg++ < 500) {
          const conf = engAvail.filter(iv => iv.s < engE && iv.e > engS);
          if (conf.length < engCap) break;
          conf.sort((a, b) => a.e < b.e ? -1 : 1);
          engS = conf[0].e;
          engE = addCalDays(engS, _leads.leadEng);
        }
      }
      engAvail.push({ s: engS, e: engE });
      o._engStart = engS;
      o._engEnd = engE;
      _fabFrom = engE;
    } else {
      o._engStart = _leads.leadOC > 0 ? _ocEnd : null;
      o._engEnd = _leads.leadOC > 0 ? _ocEnd : null;
      _fabFrom = _ocEnd;
    }
    { const _eef = o._engEnd || _ocEnd; if (_eef) _multiUnitEngEnd[o.id] = _eef; }
    const _ps = _fabFrom;
    let seqCur = _ps;
    const _seenRes = new Set();
    const sOps = [];
    const _otList = otOps(o, seq);
    const _nameOf = {}; _otList.forEach(x => { _nameOf[x._i] = x.name; });

    _otList.forEach(sop => {
      const i = sop._i;
      const _r = _erSched ? _erSched[i] : null;
      const f = _r ? _r.from : (sop.from ?? 0), t = _r ? _r.to : (sop.to ?? 1);
      const _storedProg = sop.prog;
      const derivedProg = o.progress >= t ? 1 : o.progress >= f ? Math.min(1, (o.progress - f) / (t - f)) : 0;
      const opProg = (_storedProg !== undefined && _storedProg > 0) ? _storedProg : derivedProg;
      if (o.opSkip?.[i]) return;
      if (opProg >= 1) return;
      const res = sop.res;
      const fullDays = sop.days || 5;
      const preds = sop.preds;
      const isActiveTask = o.progress > 0 && calcStatus(sequences, o) === sop.name;
      const isInProgress = opProg > 0 || isActiveTask;
      const remainingDays = isInProgress && opProg > 0 ? Math.max(1, Math.ceil(fullDays * (1 - opProg))) : fullDays;
      let earliest, _why;
      if (isInProgress) {
        earliest = today; _why = 'En curso: el trabajo restante arranca hoy';
      } else if (preds === undefined || preds === null) {
        earliest = seqCur; _why = 'Secuencia: espera que termine la op anterior';
      } else if (preds.length === 0) {
        earliest = _ps; _why = (o.plannedStart && o.plannedStart > today) ? 'Inicio programado de la OT' : 'Arranque libre';
      } else {
        earliest = _ps; _why = (o.plannedStart && o.plannedStart > today) ? 'Inicio programado de la OT' : 'Arranque libre';
        preds.forEach(pi => { if (endDates[pi] && endDates[pi] > earliest) { earliest = endDates[pi]; _why = 'Predecesora: ' + (_nameOf[pi] || ('op ' + (pi + 1))); } });
      }
      const _pin = o.opManualStarts?.[i] || null;
      if (_pin) {
        if (isInProgress) { earliest = _pin > today ? _pin : today; _why = 'Fecha fijada a mano'; }
        else if (_pin > earliest) { earliest = _pin; _why = 'Fecha fijada a mano'; }
      }
      const _grp = resourceGroups.find(g => g.id === res);
      let actualRes = res, _grpDiag = '';
      let _opH = _grp ? H : HFor(res);
      const _firstOnRes = !_seenRes.has(res);
      _seenRes.add(res);
      const _earliestPrePrio = earliest;
      if (strictPrio && _firstOnRes && !_pin && !isInProgress && resPrioFloor[res] && resPrioFloor[res] > earliest) {
        const _tryS = nextWD(earliest, _opH, WD);
        const _tryE = addWDs(_tryS, remainingDays, _opH, WD);
        if (_tryE > resPrioFloor[res]) {
          earliest = resPrioFloor[res];
          _why = 'PRIORIDAD ESTRICTA en ' + res + ': no alcanza a terminar antes del ' + resPrioFloor[res] + ', cuando ingresa una OT de mayor prioridad. Destildando esa opcion podria arrancar antes de todos modos.';
        } else {
          _why = (_why ? _why + ' · ' : '') + 'Aprovecha un hueco ocioso de ' + res + ' y termina el ' + _tryE + ', antes de que ingrese la OT de mayor prioridad (' + resPrioFloor[res] + ')';
        }
      }
      let start = nextWD(earliest, _opH, WD);
      const _startNoCap = start;
      if (respectCap) {
        if (_grp && _grp.members.length) {
          const r = resolveGroupRes(resources, res, _grp, start, remainingDays, resAvail, H, WD, HFor);
          actualRes = r.res; start = r.start; _opH = HFor(actualRes);
          if (r.diag) _grpDiag = r.diag;
        } else {
          const cap = resources.find(x => x.id === res)?.capacity || 1;
          if (!resAvail[res]) resAvail[res] = [];
          let _guard = 0;
          while (_guard++ < 100) {
            const _e = addWDs(start, remainingDays, _opH, WD);
            const conflicts = resAvail[res].filter(iv => iv.s <= _e && iv.e >= start);
            if (conflicts.length < cap) break;
            conflicts.sort((a, b) => a.e < b.e ? -1 : 1);
            start = nextWD(addCalDays(conflicts[0].e, 1), _opH, WD);
          }
        }
      }
      if (start > _startNoCap) _why = 'Capacidad de ' + actualRes + ' ocupada hasta el ' + _startNoCap + ' (se corrio al ' + start + ')';
      if (_grpDiag) _why = (_why ? _why + ' — ' : '') + _grpDiag;
      const _waitCap = Math.max(0, calDiff(_startNoCap, start));
      const _waitPrio = Math.max(0, calDiff(_earliestPrePrio, earliest));
      const end = addWDs(start, remainingDays, _opH, WD);
      endDates[i] = end;
      seqCur = end;
      if (respectCap) { if (!resAvail[actualRes]) resAvail[actualRes] = []; resAvail[actualRes].push({ s: start, e: end }); }
      if (strictPrio && _firstOnRes && !isInProgress && (!resPrioFloor[res] || start > resPrioFloor[res])) resPrioFloor[res] = start;
      sOps.push({
        name: sop.name, res, resolvedRes: _grp ? actualRes : undefined, days: remainingDays, fullDays, from: f, to: t, preds,
        startDate: start, endDate: end, progress: opProg, isInProgress, why: _why,
        si: i, isExtra: !!sop._x, waitCap: _waitCap, waitPrio: _waitPrio,
      });
    });

    o.scheduledOps = sOps;
    o.startDate = sOps[0]?.startDate || null;
    o.endDate = sOps.at(-1)?.endDate || null;
    o.updatedAt = today;
    n++;
  });

  return { orders: targets, scheduledCount: n, skippedCount: sk };
}

module.exports = {
  runSchedule, parsePreds, effPreds, otOps, effRanges, calcStatus, getSeq,
  getSimLead, getModelUEq, resolveGroupRes,
};
