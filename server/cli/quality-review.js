import { initDatabase } from '../db/database.js';
import { migrate } from '../db/migrations.js';
import { runQualityReview } from '../services/QualityReview.js';

await initDatabase();
await migrate();

try {
  const result = await runQualityReview(process.env);
  console.log(result.markdown);
  if (process.env.QUALITY_REVIEW_PATH) {
    console.log(`\n[quality] wrote ${process.env.QUALITY_REVIEW_PATH}`);
  }
} catch (error) {
  console.error(`[quality] failed: ${error.message}`);
  process.exitCode = 1;
}
