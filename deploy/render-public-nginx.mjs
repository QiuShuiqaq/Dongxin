#!/usr/bin/env node
import { isIP } from 'node:net';
import { readFile, realpath, writeFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

export function renderPublicNginx(template, officeIp) {
  const octets = officeIp.split('.').map(Number);
  const [first, second] = octets;
  if (isIP(officeIp) !== 4 || first === 0 || first === 10 || first === 127 ||
      first >= 224 || (first === 100 && second >= 64 && second <= 127) ||
      (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168)) {
    throw new Error('Supply the verified public IPv4 address of the operations computer');
  }
  const marker = '__DONGXIN_OFFICE_CIDR__';
  if (template.split(marker).length !== 2) throw new Error('Expected exactly one office CIDR placeholder');
  return template.replace(marker, `${officeIp}/32`);
}

async function main(args) {
  if (args.length !== 4 || args[0] !== '--office-ip' || args[2] !== '--output' || !isAbsolute(args[3])) {
    throw new Error('Usage: render-public-nginx.mjs --office-ip PUBLIC_IPV4 --output /absolute/staged.conf');
  }
  const template = await readFile(new URL('./nginx-public.conf.template', import.meta.url), 'utf8');
  await writeFile(args[3], renderPublicNginx(template, args[1]), { flag: 'wx', mode: 0o600 });
  console.log(`Rendered candidate Nginx configuration: ${args[3]}. Active configuration unchanged.`);
}

if (process.argv[1] && await realpath(fileURLToPath(import.meta.url)) === await realpath(process.argv[1])) {
  await main(process.argv.slice(2));
}
