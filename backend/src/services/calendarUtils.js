function calDiff(a, b) {
  return Math.round((new Date(`${b}T12:00:00`) - new Date(`${a}T12:00:00`)) / 86400000);
}

function addCalDays(ds, n) {
  const d = new Date(`${ds}T12:00:00`);
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function isWD(ds, H, WD) {
  const dow = new Date(`${ds}T12:00:00`).getDay() || 7;
  return WD.includes(dow) && !H.has(ds);
}

function nextWD(ds, H, WD) {
  let d = new Date(`${ds}T12:00:00`);
  for (let i = 0; i < 15; i++) {
    const s = d.toISOString().split('T')[0];
    if (isWD(s, H, WD)) return s;
    d.setDate(d.getDate() + 1);
  }
  return ds;
}

function addWDs(ds, n, H, WD) {
  let d = new Date(`${ds}T12:00:00`), c = 0, g = 0;
  while (c < n && g++ < 3650) {
    d.setDate(d.getDate() + 1);
    if (isWD(d.toISOString().split('T')[0], H, WD)) c++;
  }
  return d.toISOString().split('T')[0];
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

module.exports = { calDiff, addCalDays, isWD, nextWD, addWDs, todayStr };
