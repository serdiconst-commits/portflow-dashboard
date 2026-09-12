# Port Houston EIR company scope

Each PortFlow company has an independent `companies.portHoustonScac`. It defaults to an empty string. Admins configure it in Settings → Port Houston → Company SCAC. For Liberty Container Transport LLC, the requested code is LCTM. Do not set LCTM as a global default or copy it when onboarding another company.

Port Houston's official July 20, 2026 documentation ZIP includes `Postman Collections/Requests.postman_collection.json`. Its Road Service examples include `GetGateTransactions(By trkcoId)` with `predicate=trkcoId%3DSCAC` and combined predicates using `and`:
https://porthouston.com/wp-content/uploads/2026/07/API-Documents-7-20-2026.zip

Container queries now combine `ctrId=<container> and trkcoId=<SCAC>`; number and unitId fallbacks also keep the SCAC predicate. Server-side validation requires the returned trucking company and container to match. Number lookups additionally require the exact transaction number. Empty or invalid SCAC settings cannot trigger unrestricted gate queries. Container availability and credentials are unchanged.

Both manual checks and the automatic EIR job use scoped transactions. Downloads require verified metadata. Generated/downloaded documents store `documents.portHoustonMetadataJson` and their company/container scope is checked again for load attachments, direct file access and customer packets. Existing recognizable automatic EIRs and external EIR links without provenance are withheld, not deleted. A scoped refresh can regenerate/re-download valid documents. Other manually uploaded paperwork is retained. Filenames alone cannot identify every historic third-party upload: audit unidentified legacy EIRs separately before redistribution. No broad deletion or data cleanup is part of this change.

Internal callbacks must send companyId and scac in the mapping (events), or form fields (eir-upload). Ambiguous matches are rejected. Event source fields must identify the carrier/container. Uploaded EIR transaction numbers are checked against EVP for that company and container. Existing microservices sending only container/BOL must be updated before their callbacks will be accepted; scheduled/manual REST queries remain independent.

Before production activation:
1. Deploy the additive schema/code changes and set LCTM on Liberty's actual account.
2. Run a scoped read-only provider lookup for TCKU6053101. EIR 21416143 is JVXC (DM, Bayport, September 10, 2026), as shown in the supplied PortFlow summary for LD-0432; it must not be included for Liberty.
3. Refresh the load to recover only verified LCTM EIRs. Do not delete historic files without a separate audit.
4. Register the next company with its own credentials and SCAC. Verify that its results and paperwork remain separate.

Tests use simulated provider responses and isolated SQLite databases, including the reported JVXC case. A live provider response has not yet been verified because current Port Houston credentials are not available in this local checkout. SCAC identifies the carrier, not a particular trip: repeated use by the same carrier may require additional visit/date matching after examining a real response. This change does not invent a date window or modify EIR direction mapping.
