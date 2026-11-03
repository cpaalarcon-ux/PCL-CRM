import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';

const migration=await readFile(new URL('../supabase/migrations/20261103130500_enforce_idle_timeout_server_side.sql',import.meta.url),'utf8');

test('database rejects API and refresh use after 30 minutes without server-recorded activity',()=>{
 const touch=migration.match(/CREATE OR REPLACE FUNCTION erp_private\.touch_session[\s\S]*?\$\$;/)?.[0]||'';
 const actor=migration.match(/CREATE OR REPLACE FUNCTION erp_private\.actor\(\)[\s\S]*?\$\$;/)?.[0]||'';
 assert.match(touch,/p\.last_seen_at>now\(\)-interval '30 minutes'/i);
 assert.match(actor,/p\.last_seen_at>now\(\)-interval '30 minutes'/i);
 assert.match(touch,/p_activity_age_ms BETWEEN 0 AND 1799999/i);
 assert.match(touch,/p_activity_age_ms IS NULL THEN p\.last_seen_at/i);
});
