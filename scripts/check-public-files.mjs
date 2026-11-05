import { execFileSync } from 'node:child_process';

// Scan the exact index or commit tree, never local ignored files or secret values.
const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--ref' || args[1].startsWith('-'))) throw new Error('Usage: check-public-files.mjs [--ref COMMIT]');
const ref = args[1];
const git = (...args) => execFileSync('git', args, { maxBuffer: 20 * 1024 * 1024 });
const files = git(...(ref ? ['ls-tree', '-r', '--name-only', '-z', ref] : ['ls-files', '-z'])).toString().split('\0').filter(Boolean);
const privatePath = /(^|\/)(private-exports|node_modules|dist|dev-dist|\.codex|\.agents|\.aws|\.ssh)(\/|$)|(^|\/)\.env(?:\..*)?$|\.(?:pem|key|p12|pfx)$|(^|\/)(?:bookend-backup.*|Streaming_History_.*|credentials.*|service-account.*)\.json$/i;
const secrets = /(?:gh[pousr]_[a-zA-Z0-9]{30,}|github_pat_[a-zA-Z0-9_]{40,}|AKIA[0-9A-Z]{16}|sk-[a-zA-Z0-9]{32,}|-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----)/;
const localPath = /\/(?:Users|home)\/[^\s/]+\//;
const problems = [];
for (const file of files) {
  if (privatePath.test(file) && !/(^|\/)\.env\.(?:example|template)$/.test(file)) problems.push(`${file}: private or generated file`);
  const content = git('show', `${ref ?? ''}:${file}`).toString();
  if (secrets.test(content)) problems.push(`${file}: possible credential`);
  if (localPath.test(content)) problems.push(`${file}: personal filesystem path`);
}
if (problems.length) {
  console.error(problems.join('\n')); // File names and categories only, never matched secrets.
  process.exitCode = 1;
} else console.log(`Public-file checks passed for ${files.length} files (${ref ?? 'index'}).`);
