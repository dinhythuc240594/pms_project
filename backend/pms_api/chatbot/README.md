# Codex / OpenAI sidebar chat

The PMS header has a chat button in the upper-right controls. It opens a 380px
right sidebar containing the owned `/id/chatbot/embed?tenant=<id>` iframe. At
1100px and below, the panel uses the workspace content area; closing restores the
existing page and its unsaved state. The iframe is created on first open and is
preserved while closed or navigating PMS pages. Tenant, actor or authentication
changes remount the workspace and clear the iframe conversation.

The iframe route is outside `PmsLayout` to avoid recursively mounting the shell.
It authenticates through the same PMS session and selects only an authorized
tenant. There are no external iframe URLs or credentials passed by query string.
The frontend server must allow same-origin framing of this owned page
(`frame-ancestors 'self'` / `X-Frame-Options: SAMEORIGIN` if those headers are set).
An iframe sandbox is intentionally not used for this trusted same-origin app:
it requires the app's scripts, session and storage; combining same-origin and
script exemptions would not create a useful isolation boundary.

## Verified boundaries and increment plan

1. Frontend: `Header.jsx`, `PmsLayout.jsx`, `App.jsx`, the new
   `frontend/src/apps/pms/chatbot/` components and existing locale dictionaries.
   Verify lazy iframe creation, focus return, reopen persistence, mobile layout
   and identity changes. Revert the header/layout integration to remove the tool.
2. Backend: new `pms_api/chatbot/`, app factory/model/CLI registration, server
   configuration and `chatbot.view`/`chatbot.send` permissions for hotel members.
   Verify session, CSRF, tenant boundaries, quotas and idempotency. Clear the model
   setting to stop new provider calls while keeping the rest of PMS available.
3. DB: additive `chatbot_requests` table for private actor-scoped request/answer
   reservations, FORCE RLS and a unique tenant/user/intent constraint. No existing
   booking, rate, inventory, guest or Channex schema changes. Keep this table if
   rolling back application code, so paid request reservations are not lost.

All conversation input is user-provided. The backend never reads hotel records,
repository files or secrets into the model context, and supplies no tool calls.
The model can explain or propose code; it cannot change PMS operations. No
reservation, inventory, rate/ARI or Channex workflow is invoked by the chatbot.
Request timestamps are UTC. Failed and uncertain attempts count toward the rolling
24-hour quota; timezone changes cannot reset it.

## Setup

Backend runtime configuration (never use `VITE_` for these credentials):

```dotenv
OPENAI_API_KEY=
OPENAI_CHAT_MODEL=
OPENAI_CHAT_DAILY_LIMIT=30
```

Set the model to a Codex / Responses-compatible model available to the API project.
The model is intentionally configurable rather than pinned to an API model that
may later retire. `OPENAI_API_KEY` falls back to the existing server-side
`MARKETING_AI_API_KEY` when omitted. A missing key or model returns an unavailable
state and never fabricates a chatbot reply. The API key is never returned to the
browser. API usage is separate from a ChatGPT UI session.

The adapter uses the official [Responses API](https://developers.openai.com/api/reference/resources/responses/methods/create)
with `store: false`, a 4096 output-token cap, no tools and a fixed HTTPS endpoint.
See the [Codex prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/codex_prompting_guide)
for Codex API model usage. No direct ChatGPT/Codex app is embedded.

After restoring and migrating the existing core PMS schema, run from `backend/`:

```console
python manage.py install-chatbot-schema
```

The installer uses `DATABASE_MIGRATION_URL`, requires existing core tenant/user
tables and grants the configured runtime role access. It does not guess or stamp
an Alembic revision. The 27/11/2026 source sync restored the core Alembic history;
run the core upgrade before this separate chatbot installer. The sync did not
perform live PostgreSQL schema installation or provider calls. See the
[sync verification report](../../../docs/sync/SOURCE_SYNC_2026-11-27.md).

## API and usage

- `GET /api/tenants/{tenant}/chatbot/config`: availability and limits only.
- `POST /api/tenants/{tenant}/chatbot/messages`: session + CSRF + membership and
  Idempotency-Key required. Only `messages` and `locale` are accepted. System/tool
  roles and arbitrary metadata are rejected.

The client keeps conversation history in iframe memory and sends a bounded suffix:
up to 11 messages, 4000 characters per message and 16000 characters total. The API
accepts at most 12 messages ending in a user question. Assistant output is rendered
as inert text, never HTML.

Limits are per user and hotel: configured daily attempts, five attempts per minute
and one running request. A durable reservation is committed before calling OpenAI,
releasing all tenant locks and the database transaction during transport. The
server rechecks authentication/membership/entitlements before delivering a reply.
Completed replies can be replayed with the same intent; a changed payload using
that intent is rejected. Transport uncertainty is recorded as unknown and is not
automatically retried. The UI's Check request again uses the same intent.

Raw prompts are not persisted; request hashes and reply text remain in the private
actor-scoped table for deduplication. Conversation history is not restored after a
tenant change or a full page reload. Retention/deletion of stored replies should
follow the deployment's data-retention policy; no cleanup against live data is
run implicitly.

## Verification

```console
python -m unittest discover -s backend/pms_api/chatbot/tests -v
```

From `frontend/`:

```console
node --test --test-isolation=none src/apps/pms/chatbot/Chatbot.test.js
npx oxlint src/apps/pms/chatbot
```

The backend tests reuse explicit isolated host fixtures from the marketing suite,
exercise real authentication and routes against SQLite and mock the provider.
They do not validate PostgreSQL RLS, row-lock races, deployment headers or a real
Codex model. Frontend tests exercise actual header/sidebar controls and chat form
behavior in JSDOM. Existing incomplete baseline modules still prevent a complete
PMS startup/build; no placeholders are introduced for those modules.

Verification on 15/11/2026: 12 backend tests and 6 frontend tests passed. Ruff,
module Oxlint and a production library build covering the chat components and
PMS layout passed. The broader existing i18n suite still has two failures:
unequal locale catalogs (140 pre-existing English-only keys) and existing missing
Pricing keys. Comparing with HEAD confirmed the new 16 chatbot labels introduce
no additional catalog mismatches. No live API request, database installation or
browser rendering verification was performed.
