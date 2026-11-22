// Use the same scope for the picker, issuance and redemption. Keep this query
// separate from roster access so a password reset cannot expose staff profiles.
export function managerResetTargets(tx, issuerId, targetId = null) {
 return tx`
  with active_memberships as (
   select a.staff_id,a.firm_id
   from erp_private.staff_firm_access a
   join erp_private.firms f on f.firm_id=a.firm_id
   where a.deleted_at is null and f.deleted_at is null and f.is_active
  ), issuer_firms as (
   select firm_id from active_memberships where staff_id=${issuerId}::uuid
  )
  select peer.staff_id,peer.full_name
  from erp_private.staff_members peer
  join erp_private.staff_members issuer on issuer.staff_id=${issuerId}::uuid
  where peer.staff_id<>issuer.staff_id
   and (${targetId}::uuid is null or peer.staff_id=${targetId}::uuid)
   and issuer.category_code='MANAGER' and issuer.access_status='Active' and issuer.deleted_at is null
   and peer.category_code='MANAGER' and peer.access_status in ('Active','Pending setup')
   and peer.deleted_at is null and peer.auth_user_id is not null
   and (issuer.contract_end_date is null or issuer.contract_end_date>=(now() at time zone 'Africa/Nairobi')::date)
   and (peer.contract_end_date is null or peer.contract_end_date>=(now() at time zone 'Africa/Nairobi')::date)
   and exists (select 1 from active_memberships m where m.staff_id=peer.staff_id)
   and not exists (
    select 1 from active_memberships m where m.staff_id=peer.staff_id
    and not exists (select 1 from issuer_firms f where f.firm_id=m.firm_id)
   )
  order by peer.full_name,peer.staff_id`;
}
