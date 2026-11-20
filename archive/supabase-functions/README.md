# Archived Supabase Edge Functions

These are the deployed sources of staging functions that were retired on 4 November 2026. They are kept
for audit and history only. They are **not** deployed, built or tested, and nothing in the ERP calls them.
The live staff workspace is `supabase/functions/staff-workspace-v12`.

| Function | Deployed version archived | Bundle sha256 | Source |
| --- | --- | --- | --- |
| staff-workspace-v7 | 11 | see `staff-workspace-v7-v11/ARCHIVE.json` | Retrieved from pcl-erp-staging |
| staff-workspace-v8 | 1 | see `staff-workspace-v8-v1/ARCHIVE.json` | Retrieved from pcl-erp-staging |
| staff-workspace-v9 | 3 | see `staff-workspace-v9-v3/ARCHIVE.json` | Retrieved from pcl-erp-staging |
| staff-workspace-v10 | 3 | see `staff-workspace-v10-v3/ARCHIVE.json` | Retrieved from pcl-erp-staging |
| staff-workspace-v6 | 12 | — | Source stays in `supabase/functions/staff-workspace-v6` (retired 3 November 2026) |
| staff-pilot | 3 | `217f568809b2538b8bc6cfdb2e82911097ca970daed071326dda62270c5afff3` | Source stays in `supabase/functions/staff-pilot` |

Each retired function now answers HTTP 410 ("This ERP endpoint is retired"). To restore one for a
reviewed reason, redeploy its archived folder unchanged and record the decision in the release status.
