import fs from 'node:fs';
import { config } from '../config/index.js';
import { initDatabase, closeDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { seed } from '../db/seeders.js';

if (fs.existsSync(config.databasePath)) {
  fs.unlinkSync(config.databasePath);
}

await initDatabase();
await migrate();
await seed();
closeDatabase();
console.log('Database reset complete.');
