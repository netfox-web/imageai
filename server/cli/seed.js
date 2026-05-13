import { initDatabase, closeDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { seed } from '../db/seeders.js';

await initDatabase();
await migrate();
await seed();
closeDatabase();
console.log('Seeders complete.');
