import {choice, fail, uuid} from './validation.mjs';
import {validVaultKeyVersion, sealClientPassword, openClientPassword} from './credential-vault-crypto.mjs';

const types = ['KRA_ITAX', 'KRA_ETIMS'];
const activeVersion = () => Deno.env.get('PCL_CLIENT_VAULT_ACTIVE_KEY') || '';
const versionKey = (version: string) => validVaultKeyVersion(version) ? Deno.env.get('PCL_CLIENT_VAULT_KEY_' + version) : undefined;
const configured = () => /^[0-9a-f]{64}$/i.test(versionKey(activeVersion()) || '');

export async function clientVaultAccess(tx: any, staff: string, areas: string[], off: string[]) {
 if (!areas.includes('clients') || off.includes('clientvault.view') || !configured()) return [];
 return (await tx`select distinct p.client_id from erp_private.project_assignments a join erp_private.projects p using(project_id)
  where a.staff_id=${staff} and a.deleted_at is null and p.deleted_at is null and p.status='Active' and erp_private.client_credential_scope(p.client_id)`).map((row: any) => row.client_id);
}

export async function clientVaultAction(tx: any, actor: any, p: any) {
 if (!['client_vault_list', 'client_vault_reveal', 'client_vault_update', 'client_vault_permissions'].includes(p.action)) return;
 const client = uuid(p.client_id).toLowerCase(), editing = ['client_vault_update','client_vault_permissions'].includes(p.action);
 const [access] = await tx`select erp_private.client_credential_scope(${client}) as can_view,
  erp_private.client_credential_scope(${client},true) as can_edit`;
 if (!access.can_view || (editing && !access.can_edit)) fail(403, 'KRA credentials require an active assignment and credential permission for this client.');
 if (!configured()) fail(503, 'The client credential vault has not been configured.');
 if (p.action === 'client_vault_permissions') {
  if (actor.category_code !== 'PARTNER') fail(403, 'An assigned Engagement Partner must manage credential access.');
  const choices = ['View','Edit','Revoked'];
  await tx`select erp_private.client_credential_permission(${client},${uuid(p.staff_id)},${choice(p.permission,choices)},${choice(p.expected,choices)})`;
  return {ok:true};
 }
 if (p.action === 'client_vault_list') {
  const credentials = await tx`select credential_type,username,updated_at,revision from erp_private.client_credentials
   where client_id=${client} order by credential_type`;
  const people = access.can_edit && actor.category_code === 'PARTNER'
   ? await tx`select * from erp_private.client_credential_people(${client})` : null;
  const activity = actor.category_code === 'PARTNER' ? await tx`select * from erp_private.client_credential_activity(${client})` : null;
  return {credentials, people, activity, can_edit: access.can_edit};
 }
 const type = p.credential_type;
 if (!types.includes(type)) fail(400, 'Choose iTax or eTIMS.');
 if (editing && (!Number.isSafeInteger(p.revision) || p.revision < 0)) fail(400, 'Refresh the credential before saving.');
 const log = async (action: string, revision: number) => {
  await tx`insert into erp_private.client_credential_events(client_id,credential_type,actor_id,actor_auth_id,credential_revision,action)
   values (${client},${type},${actor.staff_id},${actor.auth_user_id},${revision},${action})`;
 };
 if (!editing) {
  await tx`select pg_advisory_xact_lock(hashtextextended(${client + ':' + type + ':credential'},0))`;
  const [entry] = await tx`select nonce,ciphertext,key_version,revision from erp_private.client_credentials
   where client_id=${client} and credential_type=${type}`;
  if (!entry) fail(404, 'No password has been saved for this account.');
  let password: string;
  try {
   password = await openClientPassword(versionKey(entry.key_version), client, type, entry.key_version, entry);
  } catch {
   fail(503, 'This credential is temporarily unavailable. Ask your administrator to check the vault keys.');
  }
  await log('REVEAL', entry.revision);
  return {password: password!};
 }
 const username = typeof p.username === 'string' ? p.username.trim() : '';
 if (!username || username.length > 255 || /[\u0000-\u001f\u007f]/.test(username)) fail(400, 'Enter the KRA PIN or portal username.');
 if (typeof p.password !== 'string' || !p.password || new TextEncoder().encode(p.password).length > 1024
     || new TextDecoder('utf-8', {ignoreBOM: true}).decode(new TextEncoder().encode(p.password)) !== p.password) {
  fail(400, 'Enter a password of up to 1,024 UTF-8 bytes.');
 }
 const version = activeVersion();
 const {nonce,ciphertext} = await sealClientPassword(versionKey(version), client, type, version, p.password);
 await tx`select pg_advisory_xact_lock(hashtextextended(${client + ':' + type + ':credential'},0))`;
 const saved = p.revision === 0
  ? await tx`insert into erp_private.client_credentials(client_id,credential_type,username,nonce,ciphertext,key_version,updated_by)
     values (${client},${type},${username},${nonce},${ciphertext},${version},${actor.staff_id})
     on conflict do nothing returning revision,updated_at`
  : await tx`update erp_private.client_credentials
     set username=${username},nonce=${nonce},ciphertext=${ciphertext},key_version=${version},updated_by=${actor.staff_id},
      updated_at=now(),revision=revision+1 where client_id=${client} and credential_type=${type} and revision=${p.revision}
     returning revision,updated_at`;
 if (!saved.length) fail(409, 'Someone updated this credential. Reopen the tab before trying again.');
 await log('UPDATE', saved[0].revision);
 return {credential_type: type, username, ...saved[0]};
}
