import { exportDemoData } from '../services/DemoExportService.js';

try {
  const result = await exportDemoData(process.env);
  console.log(`Demo data exported: ${result.outputPath}`);
  console.log(JSON.stringify(result.counts));
} catch (error) {
  console.error(`[export:demo-data] ${error.message}`);
  process.exitCode = 1;
}

