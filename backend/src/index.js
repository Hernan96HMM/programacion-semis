const express = require('express');
const runMigrations = require('./migrate');

const stateRoutes = require('./routes/state');
const ordersRoutes = require('./routes/orders');
const resourcesRoutes = require('./routes/resources');
const resourceGroupsRoutes = require('./routes/resourceGroups');
const operationsRoutes = require('./routes/operations');
const sequencesRoutes = require('./routes/sequences');
const calendarRoutes = require('./routes/calendar');
const simRoutes = require('./routes/sim');
const scheduleRoutes = require('./routes/schedule');
const backupRoutes = require('./routes/backup');

const app = express();
const PORT = process.env.PORT || 3001;

process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection:', err);
});

app.use(express.json({ limit: '5mb' }));

app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date() }));

app.use('/api/state', stateRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/resources', resourcesRoutes);
app.use('/api/resource-groups', resourceGroupsRoutes);
app.use('/api/operations', operationsRoutes);
app.use('/api/sequences', sequencesRoutes);
app.use('/api/calendar', calendarRoutes);
app.use('/api/sim', simRoutes);
app.use('/api/schedule', scheduleRoutes);
app.use('/api/backup', backupRoutes);

app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Error interno del servidor' });
});

async function start() {
  try {
    await runMigrations();
    app.listen(PORT, () => {
      console.log(`SICA Semis Backend running on port ${PORT}`);
    });
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
}

start();
