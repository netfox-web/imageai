import { formatStorageCheck, runStorageCheck } from '../services/StorageDiagnostics.js';

runStorageCheck()
  .then((result) => {
    console.log(formatStorageCheck(result));
    if (!result.ok) process.exit(1);
  })
  .catch((error) => {
    console.error(`[storage] failed: ${error.message}`);
    process.exit(1);
  });
