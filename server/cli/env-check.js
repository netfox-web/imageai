import { formatEnvDiagnostics, runEnvDiagnostics } from '../services/EnvDiagnostics.js';

const result = runEnvDiagnostics(process.env);
console.log(formatEnvDiagnostics(result));
if (!result.ok) {
  process.exitCode = 1;
}
