# Hotel marketing builder

The module is wired into the PMS app factory, model registry, CLI, React routes,
sidebar and owner permission map. The UI is at `/id/marketing/pages`; public pages
are served by Flask at `/p/<siteSlug>/<pageSlug>`. Vite proxies `/p` during development.

## Prepare the existing application

This checkout already references missing modules, including `pms_api.admin`,
`pms_api.subscriptions`, `pms_api.plan_pricing`, and several PMS frontend pages.
It also lacks the original Alembic migration directory and
`frontend/scripts/bundle-manifest.mjs`. Restore the project's matching baseline
before attempting a full application startup/build. The marketing module does not
create placeholder implementations for those dependencies.

Install backend dependencies from `backend/requirements.txt` and frontend
dependencies with `npm ci`. Pillow is the only new runtime dependency.

## Configuration

Set these **backend** runtime variables, using `backend/.env` only for development:

```dotenv
MARKETING_ENABLED=true
MARKETING_PUBLIC_ORIGIN=https://your-public-origin.example
MARKETING_AI_API_KEY=
MARKETING_AI_MODEL=
MARKETING_AI_DAILY_LIMIT=20
```

Use a model supporting strict structured output through the OpenAI Responses API.
The adapter uses `POST https://api.openai.com/v1/responses`, `text.format` JSON
schema, `store: false` and a 6,000 output-token cap. See the official
[Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
and [Structured Outputs](https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses).
No API key or model credential is sent to the browser. Without a key/model,
manual editing/templates remain available and the UI disables AI generation;
the backend returns `marketing_ai_unconfigured`, never a fake AI response.

The public origin must be HTTPS in production, with no path/query/credentials.
Route both `/api/*` and `/p/*` to Flask before the SPA fallback in the production
reverse proxy. Keep full-page CDN caching disabled; publication/status checks run
before conditional ETag responses.

## Additive database installation

The checkout lacks the original Alembic history, so this module ships an explicit,
transactional schema extension rather than guessing a core migration revision.
After restoring/migrating the core PMS schema, from `backend/` run:

```console
python manage.py install-marketing-schema
```

It uses `DATABASE_MIGRATION_URL`, requires existing `tenants`, `users`,
`tenant_users`, and `audit_logs`, creates only marketing tables, installs
ENABLE/FORCE RLS and immutable-history triggers, grants the configured runtime
role access and records version 1 in `marketing_schema_versions`. It refuses an
unknown/partially created schema; it never stamps Alembic or recreates core data.
Run it on a development/test database first. No migration was executed during
implementation. When restoring the Alembic history, a future migration can invoke
the same extension with the real dependency revision, avoiding a second root.

## AI worker

Run a separate process with the same database and AI configuration:

```console
python manage.py process-marketing-jobs --watch
```

Use `--tenant <id>` or `--limit 10` for bounded runs. Jobs are persisted before the
HTTP response. The worker claims a lease, commits, then calls the provider without
holding database locks. It checks the owner's active membership and subscription
again before calling. Expired running leases and uncertain transport outcomes
become `unknown`; there is no automatic paid retry. The rolling 24-hour limit is
per hotel, with at most two queued/running jobs. Completed proposals require an
explicit Apply and reject a changed base revision. Published pages never depend
on the worker being available.

## Review and publication

Saving creates an immutable revision. Preparing review creates a deterministic
HTML artifact. Approval binds that exact artifact/revision/manifest hash and all
five human checks. Publish locks the tenant/page, validates the version, current
approval, slug and idempotency key, then atomically switches a public projection.
New drafts do not modify live HTML. Restore uses a saved approved artifact.
Unpublish removes the projection; a suspended tenant returns 404 even with an old
ETag. Global SaaS administration alone does not grant hotel access.

The existing `require_tenant` entitlement policy is retained, including for
unpublish. The design's proposed exception allowing unpublish after subscription
expiry is not silently added to the missing subscription module. A future
permission-grant/editor role and independent reviewer are also outside this owner
workflow. The new frontend feature code is `AI_MARKETING_PAGES`; register its
mapping in the restored subscription/feature catalogue if that catalogue uses an
explicit action allowlist.

## Images

Owners can upload JPEG/PNG/WebP up to 700 KB and 12 megapixels. The server decodes,
resizes and re-encodes them as JPEG without source metadata; SVG is not accepted.
MVP stores up to 50 unique images per tenant in the database. Draft image endpoints
require owner authorization. Review/public artifacts embed the exact processed
bytes, so there is no public draft-asset URL and replacing an original photo
cannot change an approved artifact. Displayed uploaded images total at most 2 MB
per page. External image URLs can be previewed via the document API but must be
replaced by uploads before review. This bounded DB storage can later move to
immutable object storage without changing the page workflow.

## Focused verification

From the repository root, with backend dependencies installed:

```console
python -m unittest discover -s backend/pms_api/marketing/tests -v
```

From `frontend/`:

```console
node --test --test-isolation=none src/apps/pms/marketing/api.test.js src/apps/pms/marketing/pages/MarketingBuilder.test.js
npx oxlint src/apps/pms/marketing
```

Backend tests exercise the real HTTP/security and marketing handlers against an
isolated SQLite database. Missing pricing/IP/entitlement adapters are explicit test
fixtures; PostgreSQL GUCs are replaced for SQLite. These are not a verification of
PostgreSQL RLS, row-lock concurrency, the production migration or subscription
rules. Verify those against a dedicated PostgreSQL test instance after restoring
the core schema. Frontend tests mount the actual builder in JSDOM, exercise
review/approval/publication and switch tenants while a previous request is pending.
No real AI request or production publication was made.

Verification on 15/11/2026: 22 marketing backend tests and 7 frontend tests passed;
Ruff, module Oxlint and a production library build of all three marketing screens
passed. The existing configuration suite passed 10 of 11 tests; its CLI startup
test is blocked by the missing `pms_api.admin` baseline. Full application import
also stops there. `npm run build` stops at the already missing
`frontend/scripts/bundle-manifest.mjs`. PostgreSQL migration/RLS and real AI calls
remain unverified. Dependency installation was confined to workspace caches.

Rollback: turn off `MARKETING_ENABLED` to stop management mutations and AI worker
processing. Existing public projections continue to be served; gỡ trang/unpublish
requires the management flag on. Stop the worker before rolling back application
code. Keep marketing tables, artifacts and schema ledger; do not drop stored
history to roll back an application release.
