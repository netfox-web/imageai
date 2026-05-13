import { createApp } from './app.js';
import { config, warnForProductionConfig } from './config/index.js';

try {
  warnForProductionConfig();
} catch (error) {
  console.error(`Startup blocked: ${error.message}`);
  process.exit(1);
}

const app = await createApp();

app.listen(config.port, () => {
  console.log(`API server listening on ${config.appUrl || `http://localhost:${config.port}`}`);
});
