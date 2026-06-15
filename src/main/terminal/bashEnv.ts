/**
 * Privacy-allowlisted env for shell children (bash tool + workspace PTY).
 */

import { resolveAstGrepBinaryDir } from '../astgrep/resolveBinary.js';

const BASH_ENV_ALLOWLIST = new Set<string>([
  'PATH',
  'PATHEXT',
  'SystemRoot',
  'SystemDrive',
  'WINDIR',
  'COMSPEC',
  'TEMP',
  'TMP',
  'PSModulePath',
  'HOME',
  'USER',
  'LOGNAME',
  'SHELL',
  'TMPDIR',
  'USERPROFILE',
  'USERNAME',
  'APPDATA',
  'LOCALAPPDATA',
  'LANG',
  'LANGUAGE',
  'LC_ALL',
  'LC_CTYPE',
  'LC_MESSAGES',
  'TERM',
  'COLORTERM',
  'TZ'
]);

const SECRET_NAME_RE = /(?:^|_)(?:KEY|TOKEN|SECRET|PASSWORD|PASSWD|PWD|API|AUTH|CREDENTIAL|BEARER|COOKIE|SESSION)(?:_|$)/i;

const CREDENTIAL_ENV_DENYLIST: ReadonlyArray<RegExp> = [
  /^STRIPE_/i,
  /^AWS_/i,
  /^GITHUB_/i,
  /^DATABASE_URL$/i,
  /^MONGO_URI$/i,
  /^REDIS_URL$/i,
  /^VYOTIQ_/i
];

function isDeniedBashEnvName(name: string): boolean {
  if (SECRET_NAME_RE.test(name)) return true;
  return CREDENTIAL_ENV_DENYLIST.some((re) => re.test(name));
}

export function buildBashEnv(): NodeJS.ProcessEnv {
  const out: NodeJS.ProcessEnv = {};
  for (const name of BASH_ENV_ALLOWLIST) {
    const v = process.env[name];
    if (typeof v !== 'string' || v.length === 0) continue;
    if (isDeniedBashEnvName(name)) continue;
    out[name] = v;
  }
  const sgDir = resolveAstGrepBinaryDir();
  if (sgDir) {
    const pathSep = process.platform === 'win32' ? ';' : ':';
    const existing = out.PATH ?? process.env.PATH ?? '';
    out.PATH = existing ? `${sgDir}${pathSep}${existing}` : sgDir;
  }
  return out;
}

export function shellSpawnSpec(): { shell: string; args: string[] } {
  if (process.platform === 'win32') {
    return { shell: 'powershell.exe', args: ['-NoLogo'] };
  }
  const shell = process.env.SHELL;
  if (typeof shell === 'string' && shell.length > 0) {
    return { shell, args: [] };
  }
  return { shell: '/bin/bash', args: [] };
}
