// Validity is evaluated against database time, independently of login sessions.
export function setupLinkState(row){
 if(!row||row.deleted_at||row.access_status==='Inactive'||row.contract_current!==true)return 'unavailable';
 if(row.revoked_at)return 'replaced';
 if(row.consumed_at)return 'used';
 if(row.expired!==false)return 'expired';
 return 'ready';
}
export const setupLinkMessages={
 unavailable:'This setup link is not available. Ask your Manager for a new link and open the complete copied address.',
 replaced:'This link has been replaced. Open the latest setup link sent by your Manager. Each new link is valid for 24 hours.',
 used:'This link has already been used to save a password. Sign in with that password, or use the newest reset link if one was generated.',
 expired:'The 24-hour setup period has ended. Ask your Manager to generate a new link; it will have a fresh 24 hours.',
 ready:'This link is ready. Saving your password uses it once.'
};
