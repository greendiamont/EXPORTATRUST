# ExportaTrust — External Migration Readiness

## Current source of truth

- Repository: `greendiamont/EXPORTATRUST`
- Branch: `main`
- Audited main commit: `fbfd2f5b99cf9112ef5ea11c9265f01d5bde587b`
- Current ChatGPT Sites project id: `appgprj_6a6986ac552c8191bab402559a005189`
- Current managed bindings:
  - D1: `DB`
  - R2: `BUCKET`

## Audit result

The published ChatGPT Site is not yet visually aligned with the latest GitHub `main`.

The latest `main` has:
- main navigation reduced to Dashboard, Processos and Relatórios, with Cadastros grouped separately;
- legacy Shipment Tracking hidden;
- Environmental News hidden;
- Asana migration panel removed from operational integrations;
- technical Agent panels removed from operational integrations;
- Agent Discovery removed from operational integrations;
- Payments / Stripe / x402 removed from operational integrations.

The currently observed published site still shows Portal Cliente, Riscos and Segurança in the main sidebar. That indicates the published site is behind the current `main` UI.

## Important: code and production data are separate

GitHub contains the application source code, schema and migrations.

Production operational data is not stored in GitHub. It currently depends on:
- Cloudflare D1 for relational/operational data;
- Cloudflare R2 for uploaded documents and files;
- ChatGPT Sites authentication headers/routes;
- ChatGPT Sites hosting/project bindings.

Therefore a safe external migration must migrate infrastructure as well as code.

## Platform-specific dependencies to replace

### 1. ChatGPT authentication
Current implementation reads:
- `oai-authenticated-user-email`
- `oai-authenticated-user-full-name`

and relies on:
- `/signin-with-chatgpt`
- `/signout-with-chatgpt`
- `/callback`

External production must replace this with an independent identity provider.

### 2. D1 binding
`db/index.ts` imports `cloudflare:workers` and uses `env.DB`.

This means the database layer is already Cloudflare-native and can be retained if production moves directly to a standalone Cloudflare Workers account/project.

### 3. R2 binding
Document upload/download uses `env.BUCKET`.

This can also be retained when moving to standalone Cloudflare.

### 4. ChatGPT Sites packaging
The build includes:
- `.openai/hosting.json`
- custom Sites Vite plugin
- Sites artifact validation

These pieces should become optional or be removed only after the new external environment is validated.

## Recommended migration target

### Phase 1 — Standalone Cloudflare production

This is the lowest-risk route because the current application already uses:
- Cloudflare Workers runtime;
- Cloudflare Vite plugin;
- D1;
- R2;
- Wrangler;
- Worker entry point.

The objective is to remove only the ChatGPT-specific control plane while preserving the existing runtime and data model.

### Phase 2 — Independent authentication

Add an external identity layer and preserve the current tenant/role model.

Required behavior:
- login independent from ChatGPT;
- administrator, analyst, supplier, auditor and client roles;
- organization isolation;
- no operational data exposed before authorization.

### Phase 3 — Data migration / ownership

Before cutover:
1. export current D1 schema + data;
2. inventory all R2 objects;
3. create new production D1 and R2 resources;
4. import/clone data into the new account/project;
5. validate record counts and document object keys;
6. run both environments in parallel;
7. freeze writes briefly for final delta/cutover;
8. point the new domain to standalone production.

No destructive migration is permitted.

## Acceptance checklist before leaving ChatGPT Sites

- [ ] New environment builds from GitHub `main`
- [ ] New environment has independent authentication
- [ ] Supplier count matches current production
- [ ] Client count matches current production
- [ ] Operation count matches current production
- [ ] Rural property / CAR count matches current production
- [ ] Operation documents count matches current production
- [ ] Forest documents count matches current production
- [ ] Shipment Advice opens and uses correct invoice/bank data
- [ ] Gmail integration works in the external environment
- [ ] Dossier generation works
- [ ] Process duplication works
- [ ] Supply Chain tasks work
- [ ] EUDR conditional logic works
- [ ] Audit trail remains intact
- [ ] R2 documents open/download correctly
- [ ] No ChatGPT-only auth route remains required
- [ ] New production URL validated before old site is retired

## Migration principle

The ChatGPT Site remains live as the reference production environment until the external environment passes the complete acceptance checklist.

Do not delete or modify the original D1/R2 data during the first migration stage.
