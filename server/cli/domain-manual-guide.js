import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';

const guidePath = path.resolve(config.rootDir, 'NAS_DOMAIN_FIX.md');
const guideExists = fs.existsSync(guidePath);

const lines = [
  '[domain-manual-guide] NAS Domain Fix Assistant',
  '',
  'DNS records to add:',
  '- DNS A @ -> 211.75.219.184, Proxy status: DNS only / gray cloud, TTL: Auto',
  '- DNS CNAME www -> imageai.tw, Proxy status: DNS only / gray cloud, TTL: Auto',
  '- Or DNS A www -> 211.75.219.184, Proxy status: DNS only / gray cloud, TTL: Auto',
  '- Do not put :3050 in DNS records.',
  '',
  'Synology reverse proxy fields:',
  '- DSM: Control Panel / Login Portal / Advanced / Reverse Proxy',
  '- imageai: Source HTTPS imageai.tw 443 -> Destination HTTP 127.0.0.1 3050',
  '- www-imageai: Source HTTPS www.imageai.tw 443 -> Destination HTTP 127.0.0.1 3050',
  '- Source hostname is the domain only, not https://, not :3050, and not the IP.',
  '',
  'Certificate fields:',
  '- DSM: Control Panel / Security / Certificate',
  "- Let's Encrypt Domain name: imageai.tw",
  "- Subject Alternative Name: www.imageai.tw",
  '- Assign this certificate to the imageai and www-imageai reverse proxy services.',
  '',
  'Verification commands:',
  '- nslookup imageai.tw',
  '- nslookup www.imageai.tw',
  '- Test-NetConnection imageai.tw -Port 443',
  '- curl.exe -I https://imageai.tw/health',
  '- DOMAIN_CHECK_BASE_URL=https://imageai.tw npm run domain:check',
  '',
  `Full guide: ${guideExists ? guidePath : 'NAS_DOMAIN_FIX.md not found'}`,
];

console.log(lines.join('\n'));
