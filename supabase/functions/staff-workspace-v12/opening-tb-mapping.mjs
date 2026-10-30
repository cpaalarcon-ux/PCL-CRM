const key=(value)=>String(value??'').trim().toLowerCase();

// Opening TB templates put the client's original account code in legacy_code.
// Match that code first; name matching is only a fallback for setup rows that
// were intentionally saved without a source code.
export function openingTbMappingMatches(mappings,sourceCode,sourceName){
 const code=key(sourceCode),name=key(sourceName);
 if(code){
  const coded=mappings.filter(m=>key(m.source_account_code)===code);
  if(coded.length)return coded;
 }
 if(!name)return [];
 return mappings.filter(m=>!key(m.source_account_code)&&key(m.source_account_name)===name);
}
