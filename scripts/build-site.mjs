#!/usr/bin/env node
// Builds only the authenticated staff workspace for a named Supabase environment.
// Cloudflare Pages production command:
//   node scripts/build-site.mjs --env production --out dist
// This intentionally refuses to publish index.html or other browser-local previews.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ENTRY = ['staff-pilot.html'];
const EXTRA = ['_headers'];
const TEXT = /\.(html|js|mjs|css|json|csv|txt)$/i;
const FOLLOW = /\.(html|js|mjs|css)$/i;
const REF = /['"`(=]\s*((?:\.{1,2}\/|\/)?[A-Za-z0-9_\-./]+\.(?:mjs|js|css|png|webp|svg|ico|json|csv|xlsx|html))(?:\?[^'"` )\s]*)?['"`)]/g;

export function parseArgs(argv) {
  const args = { env: '', out: 'dist', file: '' };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env') args.env = argv[++i] || '';
    else if (argv[i] === '--out') args.out = argv[++i] || '';
    else if (argv[i] === '--env-file') args.file = argv[++i] || '';
  }
  return args;
}

function readConfig(name, file = '') {
  if (!['staging', 'production'].includes(name)) throw new Error('Use --env staging or --env production.');
  const configPath = file || path.join(root, 'environments', name + '.json');
  if (!fs.existsSync(configPath)) throw new Error('Missing ' + configPath + '. Configure the dedicated ' + name + ' Supabase project before building.');
  let config;
  try { config = JSON.parse(fs.readFileSync(configPath, 'utf8')); }
  catch { throw new Error('Invalid JSON in ' + configPath + '.'); }
  if (config.name !== name) throw new Error('Environment file says "' + config.name + '", not "' + name + '".');
  if (!/^[a-z0-9]{20}$/.test(config.project_ref || '')) throw new Error('project_ref must be a 20-character Supabase project reference.');
  if (!/^sb_publishable_[A-Za-z0-9_-]{20,}$/.test(config.publishable_key || '')) throw new Error('publishable_key must be the project publishable key (sb_publishable_...).');
  return config;
}

export function loadEnvironment(name, file = '') {
  const config = readConfig(name, file);
  if (name === 'production') {
    const staging = readConfig('staging');
    if (config.project_ref === staging.project_ref || config.publishable_key === staging.publishable_key) {
      throw new Error('Production environment points at staging. Refusing to build.');
    }
  }
  return config;
}

export function reachable() {
  const missing = ENTRY.filter((rel) => !fs.existsSync(path.join(root, rel)) || !fs.statSync(path.join(root, rel)).isFile());
  if (missing.length) {
    throw new Error('Approved staff app entrypoint missing: ' + missing.join(', ') + '. Refusing to fall back to index.html or a browser-local preview.');
  }

  const seen = new Set();
  const queue = [...ENTRY];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    seen.add(rel);
    if (!FOLLOW.test(rel)) continue;
    const source = fs.readFileSync(abs, 'utf8');
    for (const match of source.matchAll(REF)) {
      const ref = match[1];
      const target = ref.startsWith('/')
        ? ref.slice(1)
        : path.posix.normalize(path.posix.join(path.posix.dirname(rel), ref));
      if (target.startsWith('..') || target.includes('node_modules')) continue;
      if (fs.existsSync(path.join(root, target))) queue.push(target);
    }
  }

  for (const rel of EXTRA) {
    if (fs.existsSync(path.join(root, rel))) seen.add(rel);
  }
  return [...seen].sort();
}

export function build({ env, out = 'dist', file = '' }) {
  // Check the approved application entrypoint before cleaning or creating output.
  const files = reachable();
  const config = loadEnvironment(env, file);
  const staging = env === 'staging' ? config : readConfig('staging');
  const dist = path.resolve(root, out);

  if (dist === root || !dist.startsWith(root + path.sep)) {
    throw new Error('Output must be a child directory of the repository.');
  }

  fs.rmSync(dist, { recursive: true, force: true });
  for (const rel of files) {
    const source = path.join(root, rel);
    const target = path.join(dist, rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    if (TEXT.test(rel) || rel === '_headers') {
      let content = fs.readFileSync(source, 'utf8');
      content = content
        .split(staging.project_ref).join(config.project_ref)
        .split(staging.publishable_key).join(config.publishable_key);
      fs.writeFileSync(target, content);
    } else {
      fs.copyFileSync(source, target);
    }
  }

  fs.writeFileSync(path.join(dist, '_redirects'), '/ /staff-pilot 302\n');
  if (env === 'production') {
    const blocked = [];
    for (const rel of [...files, '_redirects']) {
      if (!TEXT.test(rel) && rel !== '_headers' && rel !== '_redirects') continue;
      const content = fs.readFileSync(path.join(dist, rel), 'utf8');
      if (content.includes(staging.project_ref) || content.includes(staging.publishable_key)) blocked.push(rel);
    }
    if (blocked.length) {
      fs.rmSync(dist, { recursive: true, force: true });
      throw new Error('Staging references remain in production output: ' + blocked.join(', '));
    }
  }

  return { env, out: dist, files: files.length, project_ref: config.project_ref };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    const result = build(args);
    console.log('Built ' + result.files + ' files for ' + result.env + ' (project ' + result.project_ref + ') into ' + path.relative(root, result.out));
  } catch (error) {
    console.error('Build failed: ' + error.message);
    process.exit(1);
  }
}
