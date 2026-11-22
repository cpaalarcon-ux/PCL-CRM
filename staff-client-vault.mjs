const portals = [['KRA_ITAX', 'KRA iTax'], ['KRA_ETIMS', 'KRA eTIMS']];
const mask = '••••••••••••';

export function mountClientVault(host, {clientId, request, esc, shortDate}) {
 const doc = host.ownerDocument, win = doc.defaultView;
 let cleanup = () => {};
 const reset = () => cleanup();
 const observer = new win.MutationObserver(() => {
  if (!host.isConnected) {
   reset();
   observer.disconnect();
   doc.removeEventListener('visibilitychange', reset);
   win.removeEventListener('pagehide', reset);
   win.removeEventListener('blur', reset);
  }
 });
 observer.observe(doc.body, {childList:true, subtree:true});
 doc.addEventListener('visibilitychange', reset);
 win.addEventListener('pagehide', reset);
 win.addEventListener('blur', reset);
 const send = (action, fields={}) => request({action, client_id:clientId, ...fields});
 void load();

 async function load() {
  try {
   const {credentials, people, activity, can_edit} = await send('client_vault_list');
   if (!host.isConnected) return;
   host.innerHTML = '<h3>KRA credentials</h3><p class="muted">Viewing a password records your name and the time of access.</p>';
   const cards = portals.map(([type, label]) => renderPortal(type, label, credentials.find(row => row.credential_type === type), can_edit));
   if (people) renderPermissions(people);
   if (activity) renderActivity(activity);
   cleanup = () => cards.forEach(clear => clear());
  } catch (error) {
   host.innerHTML = '<p class="error" role="alert"></p>';
   host.firstChild.textContent = error.message;
  }
 }
 function renderActivity(events) {
  const details = doc.createElement('details');
  details.className = 'section-space';
  details.innerHTML = '<summary>Recent vault activity</summary>'+ (events.length
   ? `<div class="scroll"><table><thead><tr><th>Staff</th><th>Account</th><th>Action</th><th>Time</th></tr></thead><tbody>${events.map(event =>
     `<tr><td>${esc(event.actor)}</td><td>${esc(portals.find(([type]) => type===event.credential_type)?.[1] || '')}</td>
      <td>${event.action==='REVEAL' ? 'Revealed' : 'Updated'}</td>
      <td>${esc(new Intl.DateTimeFormat('en-KE',{dateStyle:'medium',timeStyle:'medium',timeZone:'Africa/Nairobi'}).format(new Date(event.occurred_at)))} EAT</td></tr>`).join('')}</tbody></table></div>`
   : '<p>No recorded activity.</p>');
  host.append(details);
 }
 function renderPermissions(people) {
  const details = doc.createElement('details');
  details.className = 'section-space';
  details.innerHTML = '<summary>Manage KRA vault access</summary><p class="muted">Grant access to staff already assigned to this client. Edit access includes viewing passwords.</p>';
  host.append(details);
  if (!people.length) {
   details.insertAdjacentHTML('beforeend','<p>No eligible staff are assigned to this client.</p>');
   return;
  }
  for (const person of people) {
   const form = doc.createElement('form');
   form.className = 'actions section-space';
   form.innerHTML = `<label>${esc(person.full_name)}<select name="permission">
    <option value="Revoked">No access</option><option>View</option>${person.category_code==='MANAGER' ? '<option>Edit</option>' : ''}
   </select></label><button type="submit">Save access</button><span role="status"></span>`;
   details.append(form);
   form.elements.permission.value = person.permission;
   form.onsubmit = async event => {
    event.preventDefault();
    const select = form.elements.permission, button = form.querySelector('button'), status = form.querySelector('[role=status]');
    const permission = select.value;
    select.disabled = button.disabled = true;
    try {
     await send('client_vault_permissions',{staff_id:person.staff_id,permission,expected:person.permission});
     person.permission = permission;
     status.textContent = 'Access saved.';
    } catch (error) {
     status.textContent = error.message;
    } finally {
     select.disabled = button.disabled = false;
    }
   };
  }
 }
 function renderPortal(type, label, row, canEdit) {
  const section = doc.createElement('section');
  section.className = 'card section-space';
  section.innerHTML = `<h4>${esc(label)}</h4><p>PIN or username <strong>${esc(row?.username || 'Not recorded')}</strong></p>
   <p>Password <code class="vault-value">${row ? mask : 'Not saved'}</code></p>
   ${row ? '<p class="muted">Updated '+esc(shortDate(row.updated_at))+'</p>' : ''}
   <div class="actions">${row ? '<button type="button" data-vault-reveal>Reveal password</button>' : ''}
   ${canEdit ? '<button type="button" data-vault-edit>'+(row ? 'Update password' : 'Save password')+'</button>' : ''}</div>
   <p role="status" class="muted"></p>`;
  host.append(section);
  const value = section.querySelector('code'), reveal = section.querySelector('[data-vault-reveal]');
  const edit = section.querySelector('[data-vault-edit]'), status = section.querySelector('[role=status]');
  let attempt = 0, timer, form, pending = false;
  function maskPassword() {
   attempt++;
   win.clearTimeout(timer);
   if (reveal) {
    value.textContent = mask;
    reveal.textContent = 'Reveal password';
   }
  }
  function closeForm() {
   const secret = form?.elements.password;
   if (secret) secret.value = '';
   form?.remove();
   form = undefined;
   if (edit) edit.disabled = pending;
  }
  if (reveal) reveal.onclick = async () => {
   if (reveal.textContent === 'Hide password') return maskPassword();
   const token = ++attempt;
   reveal.disabled = true;
   status.textContent = '';
   try {
    const {password} = await send('client_vault_reveal', {credential_type:type});
    if (host.isConnected && !doc.hidden && token === attempt) {
     value.textContent = password;
     reveal.textContent = 'Hide password';
     timer = win.setTimeout(maskPassword, 30000);
    }
   } catch (error) {
    if (token === attempt) status.textContent = error.message;
   } finally {
    reveal.disabled = false;
   }
  };
  if (edit) edit.onclick = () => {
   maskPassword();
   closeForm();
   edit.disabled = true;
   form = doc.createElement('form');
   form.className = 'form-grid section-space';
   form.innerHTML = '<label>KRA PIN or username<input name="username" maxlength="255" autocomplete="off" required></label>'+
    '<label>New password<input name="password" type="password" autocomplete="new-password" maxlength="1024" required></label>'+
    '<div class="actions"><button class="primary">Save password</button><button type="button" data-cancel>Cancel</button></div>';
   form.elements.username.value = row?.username || '';
   form.querySelector('[data-cancel]').onclick = closeForm;
   section.append(form);
   form.elements[row ? 'password' : 'username'].focus();
   form.onsubmit = async event => {
    event.preventDefault();
    const {username,password} = form.elements;
    const fields = {credential_type:type, username:username.value, password:password.value, revision:row?.revision || 0};
    pending = true;
    closeForm();
    status.textContent = 'Saving…';
    try {
     await send('client_vault_update', fields);
     if (host.isConnected) {
      reset();
      await load();
     }
    } catch (error) {
     status.textContent = error.message;
    } finally {
     fields.password = '';
     pending = false;
     edit.disabled = false;
    }
   };
  };
  return () => {maskPassword(); closeForm();};
 }
}
