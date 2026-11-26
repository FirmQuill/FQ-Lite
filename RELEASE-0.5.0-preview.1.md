# FirmQuill 0.5.0-preview.1

Early Development preview, published November 26, 2026.

- Both editions: multi-line commercial documents with discounts, partial fulfillment or receipt, and line-level returns; warehouse bins, tracking labels, lot and serial history, expiry flags and reorder suggestions; recurring commercial drafts and project budgets.
- Full Suite: reviewed grouped service CSV migration and flat QuickBooks Desktop IIF contact lists; shared picks and inventory count assignments; purchase requests and matching, project templates, Kanban, dependencies, and employee time-off requests.
- Both editions: Manual payroll records company-defined tax rules and finalized calculations, with PDF statements and CSV exports. Full Suite can use approved time and publish pay statements to authorized workers. The built-in 2026 federal worksheet is separate. No tax filings, direct deposits, or ledger postings are automated by Manual payroll.

Verified on Node.js 24 and headless Chromium: 70 Lite source tests and 190 Full Suite source tests passed; two optional external private-manual tests were not configured. Extracted-runtime smoke tests passed for both editions (5 Lite, 11 Full). Native migration verification applies only to the exact flat Desktop IIF contact-list shape, not QuickBooks Online, IIF transactions, Wave or ADP.

Start with a fresh workspace or copy of your data. Keep an encrypted backup before upgrading. Full Suite needs a running self-hosted server; Lite remains offline-capable in its encrypted single-owner vault.
