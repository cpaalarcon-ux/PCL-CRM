# PCL CRM — Client, Service and Engagement Lifecycle Foundation

This build provides a browser-local, editable CRM intake module for a consulting and audit practice. Open `index.html` in a current browser.

## Included

- Mandatory company profile fields for sector and branch reporting
- Primary contact and decision-role fields
- A controlled 23-service master catalogue grouped by service line
- Sector-based service recommendations that use the controlled catalogue
- PIE, Financial Services and Public Sector IEQR quality gate
- Audit sign-off block until the IEQR assignment is complete
- Tax, SASRA, branch-routing and cross-selling workflow task generation
- Conditional tax-compliance work packs for VAT and eTIMS, payroll statutory deductions, WHT, tax credits, income tax, PPE, stock, instalment tax and client reporting
- Tax-credit posting gate requiring iTax verification and reviewer approval
- Position-based hierarchy and permission profiles for Engagement Partner, Manager, Audit Supervisor, Audit Assistant and Intern
- Protected Engagement Fee and EQR sign-off rules, defined without staff names
- Potential duplicate warning based on legal or trading name
- Client notes and engagement-letter reference fields
- A separate Lead-to-Engagement Kanban: New Lead, Scoping & KYC, Proposal Sent, EL Signed, Active Engagement, WIP / Billing and Closed / Archived
- Lead gates for scoping data, KYC document references, conflict clearance, Partner approval for Potential PIE / configured fee thresholds, signed EL, KYC verification and ICPAK reference for Statutory Audit
- Automatic Potential PIE flagging for Financial Services and Public Sector leads
- Service-specific activation tasks for Statutory Audit, SME bookkeeping/tax, Legal/LSK and NGO/donor work
- Position-based Independent Engagement Quality Reviewer task generation for Potential PIE statutory audits
- Resource assignments by staff identifier, 40-hour weekly assistant-capacity warning / override control, invoice milestones and WIP setup

## Implementation note

The first module stores data only in the browser's local storage so it can be reviewed without a backend. Before live use, connect the same fields and workflow rules to the production client database, task service and secure document repository. Enforce KYC, conflict, EL, approval, EQR and capacity gates in authenticated server-side permissions; browser checks alone are not a compliance control. The required server-side positions are Engagement Partner, Branch Manager, Practice Administration, Account Manager, Tax Manager, Tax Associate, Audit Supervisor, Audit Assistant, Financial Services team and Independent Engagement Quality Reviewer roles.
