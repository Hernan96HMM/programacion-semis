const fs = require('fs');
const path = require('path');
const db = require('./db');

async function runMigrations() {
  console.log('Running migrations...');
  const migrationsDir = path.join(__dirname, 'migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log(`Running migration: ${file}`);
    await db.query(sql);
    console.log(`Migration ${file} completed.`);
  }

  console.log('All migrations complete.');
}

module.exports = runMigrations;
