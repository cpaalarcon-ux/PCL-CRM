# PCL CRM — Clients and Services Foundation

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
- Potential duplicate warning based on legal or trading name
- Client notes and engagement-letter reference fields

## Implementation note

The first module stores data only in the browser's local storage so it can be reviewed without a backend. Before live use, connect the same fields and workflow rules to the production client database, task service and secure document repository. The required server-side roles are the three Branch Managers, Practice Administration, the Account Manager, Tax team, Financial Services team and CPA Alarcon.
