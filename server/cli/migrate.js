import { initDatabase, closeDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';

await initDatabase();
await migrate();
closeDatabase();
console.log('Migrations complete.');
