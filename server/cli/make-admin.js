import bcrypt from 'bcryptjs';
import { initDatabase, closeDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { seed, ensureAdmin } from '../db/seeders.js';

const email = process.argv[2] || process.env.ADMIN_EMAIL || 'admin@example.com';
const password = process.argv[3] || process.env.ADMIN_PASSWORD || 'password123';
const name = process.argv[4] || 'Admin';

await initDatabase();
await migrate();
await seed();
const passwordHash = await bcrypt.hash(password, 10);
ensureAdmin(email, passwordHash, name);
closeDatabase();
console.log(`Admin ready: ${email}`);
