// Builds backend and frontend for the end-to-end tests. NEXT_PUBLIC_API_URL is baked into the
// frontend bundle at build time, so the e2e build points it at the e2e backend port.
import { execSync } from 'node:child_process';

const env = { ...process.env, NEXT_PUBLIC_API_URL: 'http://localhost:4180' };
execSync('npm run build -w backend', { stdio: 'inherit', env });
execSync('npm run build -w frontend', { stdio: 'inherit', env });
