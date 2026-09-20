# Unified Driver Payroll

Local implementation; not deployed. The `Driver Payroll` navigation replaces the separate payroll and settlement entry points. Existing settlement records remain authoritative. Legacy payroll runs remain readable through their existing API, but creating or modifying them is disabled to avoid two payment engines. Existing non-voided legacy claims prevent the same load/driver from being imported again.

## Workflow

1. Choose a period and driver; prepare a draft from completed movements. Drop and pickup retain their separate driver, route and rate.
2. Review movement pay and documents. Add an omitted completed movement from any date, or add a clearly described manual payment. Manual payments do not claim a load. Removal from a draft is remembered during recalculation.
3. Add or subtract a fixed amount or percentage of movement gross. Save an adjustment as an option for later selection if needed. New drafts receive no saved adjustments automatically. Select an option in Saved adjustments, review or change its amount/percentage, then add it to the current period. Each option can be selected once per settlement; removing it permits selecting it again. Existing snapshots and saved values remain unchanged unless explicitly edited.
4. Mark reviewed, then finalize. These actions do not send email or transfer money. PDF and driver details use the stored statement.
5. Record an already-made positive payment with date, method and reference. Duplicate payment recording is rejected.
6. For an unpaid finalized statement, create a revision with a reason; the old version remains downloadable. For a paid statement, create a linked supplemental draft in the selected period and include only the difference owed or omitted movements. The original payment stays unchanged.

Credits and zero-net statements are not marked paid. Automatic credit carry-forward is not implemented: payroll must explicitly review and add any credit deduction to the appropriate subsequent draft. No bank transfers are implemented.

## Validation

118 Node tests pass, including actual SQLite calculations, tenant scoping, duplicate claims/payments, saved adjustment selection and snapshots, revisions, paid corrections, driver access and PDF generation. Web and driver Vite builds pass (existing large-chunk warning).

Browser QA uses the actual React component and settlement router with an isolated in-memory database. Verified Draft → Reviewed → Finalized → Paid → supplemental draft, and separate $100 Drop / $150 Pickup for different drivers on one load. Checked desktop and 390px viewport; no browser errors. This is not a signed native build or physical-device test. Real email delivery and production document downloads were not exercised.

## Isolated preview

Run `node qa/payroll-server.mjs`, then open http://127.0.0.1:5188/qa/payroll.html . All data is synthetic and resets on process restart; email is blocked. This harness does not import production database configuration or dotenv. Use September 14–20, 2026 to inspect the seeded movements.

New supporting SQLite tables are created lazily with `IF NOT EXISTS`; production deployment and its persistent database changes remain pending explicit authorization.

Legacy review modal removed; legacy run-generation, recalculation, transition and adjustment route handlers removed. Read-only history remains available. Both previous navigation identifiers render the same new component. Regression tests verify old write endpoints return 409 while history remains readable.
