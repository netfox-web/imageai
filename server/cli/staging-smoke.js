import { formatSmokeError, parseSmokeEnv, runSmokeTest } from '../services/SmokeTestRunner.js';

const options = parseSmokeEnv(process.env);

runSmokeTest(options, { log: (message) => console.log(`[smoke] ${message}`) })
  .then((result) => {
    console.log(`[smoke] passed task=${result.taskId}`);
    console.log(`[smoke] output urls: ${result.outputUrls.join(', ')}`);
  })
  .catch((error) => {
    console.error(formatSmokeError(error));
    process.exit(1);
  });
