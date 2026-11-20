#!/usr/bin/env node
// Builds the staff web app for one environment.
//   node scripts/build-site.mjs --env production --out dist
// Why: the source files carry the STAGING project address and publishable key. A production build must talk only to the
// production project and must not publish the rest of the repository (SQL, tests, the old browser-local preview).
// Cloudflare Pages production settings: build command `node scripts/build-site.mjs --env production --out dist`, output directory `dist`.
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const STAGING = JSON.parse(fs.readFileSync(path.join(root, 'environments/staging.json'), 'utf8'));
const ENTRY = ['staff-pilot.html'];
// Files that are loaded by name from code but are not found by following imports.
const EXTRA = ['_headers'];
const TEXT = /\.(html|js|mjs|css|json|csv|txt)$/i;
const FOLLOW = /\.(html|js|mjs|css)$/i;
const REF = /['"`(=]\s*((?:\.{1,2}\/|\/)?[A-Za-z0-9_\-./]+\.(?:mjs|js|css|png|webp|svg|ico|json|csv|xlsx|html))(?:\?[^'"`)\s]*)?['"`)]/g;

export function parseArgs(argv) {
  const a = {env: '', out: 'dist', file: ''};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--env') a.env = argv[++i];
    else if (argv[i] === '--out') a.out = argv[++i];
    else if (argv[i] === '--env-file') a.file = argv[++i];
  }
  return a;
}

export function loadEnvironment(name, file = '') {
  if (!['staging', 'production'].includes(name)) throw new Error('Use --env staging or --env production.');
  const cfg = JSON.parse(fs.readFileSync(file || path.join(root, 'environments', name + '.json'), 'utf8'));
  if (cfg.name !== name) throw new Error(`Environment file says "${cfg.name}", not "${name}".`);
  if (!/^[a-z0-9]{20}$/.test(cfg.project_ref || '')) throw new Error('project_ref must be the 20-character Supabase project reference. Fill in environments/' + name + '.json first.');
  if (!/^sb_publishable_[A-Za-z0-9_\-]{20,}$/.test(cfg.publishable_key || '')) throw new Error('publishable_key must be the project\'s publishable key (sb_publishable_...). Fill in environments/' + name + '.json first.');
  if (name === 'production' && (cfg.project_ref === STAGING.project_ref || cfg.publishable_key === STAGING.publishable_key)) {
    throw new Error('The production environment points at the staging project. Refusing to build.');
  }
  return cfg;
}

export function reachable() {
  const seen = new Set(), queue = [...ENTRY];
  while (queue.length) {
    const rel = queue.pop();
    if (seen.has(rel)) continue;
    const abs = path.join(root, rel);
    if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) continue;
    seen.add(rel);
    if (!FOLLOW.test(rel)) continue;
    const text = fs.readFileSync(abs, 'utf8');
    for (const m of text.matchAll(REF)) {
      const ref = m[1];
      const target = ref.startsWith('/') ? ref.slice(1) : path.posix.normalize(path.posix.join(path.posix.dirname(rel), ref));
      if (target.startsWith('..') || target.includes('node_modules')) continue;
      if (fs.existsSync(path.join(root, target))) queue.push(target);
    }
  }
  for (const f of EXTRA) if (fs.existsSync(path.join(root, f))) seen.add(f);
  return [...seen].sort();
}

export function build({env, out, file = ''}) {
  const cfg = loadEnvironment(env, file);
  const dist = path.resolve(root, out);
  if (dist === root || !dist.startsWith(root + path.sep)) throw new Error('The output directory must be a new folder inside the repository.');
  fs.rmSync(dist, {recursive: true, force: true});
  const files = reachable();
  for (const rel of files) {
    const to = path.join(dist, rel);
    fs.mkdirSync(path.dirname(to), {recursive: true});
    if (TEXT.test(rel) || rel === '_headers') {
      let t = fs.readFileSync(path.join(root, rel), 'utf8');
      t = t.split(STAGING.project_ref).join(cfg.project_ref).split(STAGING.publishable_key).join(cfg.publishable_key);
      fs.writeFileSync(to, t);
    } else fs.copyFileSync(path.join(root, rel), to);
  }
  fs.writeFileSync(path.join(dist, '_redirects'), '/ /staff-pilot 302\n');
  if (env !== 'staging') {
    const bad = [];
    for (const rel of [...files, '_redirects']) {
      if (!TEXT.test(rel) && rel !== '_headers' && rel !== '_redirects') continue;
      const t = fs.readFileSync(path.join(dist, rel), 'utf8');
      if (t.includes(STAGING.project_ref) || t.includes(STAGING.publishable_key)) bad.push(rel);
    }
    if (bad.length) { fs.rmSync(dist, {recursive: true, force: true}); throw new Error('Staging references remain in: ' + bad.join(', ')); }
  }
  return {env, out: dist, files: files.length, project_ref: cfg.project_ref};
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const a = parseArgs(process.argv.slice(2));
    const r = build({env: a.env, out: a.out, file: a.file});
    console.log(`Built ${r.files} files for ${r.env} (project ${r.project_ref}) into ${path.relative(root, r.out)}`);
  } catch (e) { console.error('Build failed: ' + e.message); process.exit(1); }
}
