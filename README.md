# The App Sucks

A multi-provider AI chat workspace designed to deploy as a Cloudflare Worker with Static Assets + D1. Bring your own provider API keys; chats, settings, per-chat files, and plugins live in D1.

## What's included

- Responsive chat interface with animated transitions, separate conversations, AI-generated first-message titles, Markdown rendering, and a mobile sidebar.
- Provider adapters for OpenAI Responses, Anthropic Messages, Gemini `generateContent`, xAI Responses, and OpenAI-compatible chat-completions providers: OpenRouter, DeepSeek, Mistral, Groq, Together AI, and Fireworks AI.
- Editable model IDs. Provider model catalogs change often, so use the exact ID shown by your provider dashboard rather than relying on a hard-coded list.
- Multiple API keys per provider/model scope. A server-side round-robin key ring rotates across matching keys on each model call, including agent tool-loop calls and title generation.
- API keys and plugin secrets encrypted with AES-GCM using a Cloudflare Worker secret. The browser only receives key labels and last-four-character hints.
- Per-chat model/provider selection, temperature, top-p, max output tokens, and a user-authored system/personality description.
- Optional shared memory, disabled by default and editable by the user.
- A constrained YAML plugin DSL for declared HTTPS hosts, JSON-shaped inputs, HTTP methods, request bodies, and encrypted plugin secrets. Enabled plugin tools can be called by the assistant using a small tool-call protocol.
- Separate per-chat file storage (up to 30 files, 500 KB total) and a JavaScript scratchpad executed in a network-disabled sandboxed iframe.
- Email/password accounts with HTTP-only, SameSite session cookies.

## Important limits / design choices

- **This does not make model APIs free.** Cloudflare can host the app within its current free-plan limits, but every provider still applies its own API access, billing, rate limits, and usage policies. The app is a router and workspace, not an AI inference provider.
- There is no adult-content mode. The interface is intended to be a general-purpose assistant workspace.
- The code workspace is not a real shell. JavaScript executes in an isolated browser iframe with network connections disabled; it cannot execute commands on the Worker or access the chat database.
- Plugins are declarative HTTP tools, not arbitrary JavaScript or executable MCP servers. Each plugin must declare its exact public HTTPS hosts. Redirects are blocked, tool inputs are checked, and requests time out. Do not add private/internal endpoints or untrusted hosts. A hostname allowlist is not a complete SSRF defense against hostile DNS or a malicious plugin author; do not enable community plugin uploads or store sensitive secrets in third-party plugins until you have completed an independent SSRF/security review.
- The plugin format is MCP-inspired but is not a full MCP client/server implementation. The current tool-call protocol is text-based and provider-neutral. It is intentionally simpler than provider-native tool-calling APIs, so a model may occasionally fail to format a tool call correctly.
- Streaming tokens, image/audio inputs, model discovery, provider OAuth, user invitations, and hosted user-level billing are not included in this starter.
- This is a serious starter project, not an audited production identity or secrets platform. Add rate limiting, email verification, abuse controls, account recovery, and a security review before opening registration to the public.

## Local development

Requirements: Node.js 20+ and an available Cloudflare account for a deployed database. Local Wrangler development can use a local D1 database.

```bash
npm install
npx wrangler d1 create the-app-sucks-db
```

Copy the `database_id` returned by Wrangler into `wrangler.jsonc`, replacing `REPLACE_WITH_DATABASE_ID`.

Create `.dev.vars` in the project root with a local encryption secret (do not commit it):

```dotenv
KEY_ENCRYPTION_SECRET="replace-this-with-a-long-random-secret-at-least-32-characters"
```

Apply the local migration, build the front end, and run the Worker:

```bash
npm run db:migrate:local
npm run dev
```

`npm run dev` builds the static front end and starts `wrangler dev`, so the UI and `/api/*` routes use one local origin. Use `npm run dev:frontend` only when you are working on the Vite UI in isolation; the API routes are not served by Vite itself.

## Deploy to Cloudflare Workers

1. Create a D1 database:

   ```bash
   npx wrangler d1 create the-app-sucks-db
   ```

2. Put its returned database ID into `wrangler.jsonc`.
3. Create a strong encryption secret and add it to the Worker. Example secret generation on macOS/Linux:

   ```bash
   openssl rand -base64 48
   npx wrangler secret put KEY_ENCRYPTION_SECRET
   ```

   Paste the generated value when Wrangler prompts. Never put this value in frontend code, Git, or `wrangler.jsonc`.

4. Apply the production schema:

   ```bash
   npx wrangler d1 migrations apply the-app-sucks-db --remote
   ```

5. Install, build, and deploy:

   ```bash
   npm install
   npm run deploy
   ```

Wrangler deploys the `dist/` static assets and `src/worker.ts` as one Worker. `/api/*` routes are sent to the Worker first; the remaining routes are served as a single-page app.

### Free-plan expectations

Cloudflare's free Worker plan currently lists a daily request allowance and a CPU-time cap; D1 also has daily free-plan row-read/write limits. These quotas can change, so check Cloudflare's current pricing/limits pages before relying on them. A chat request also calls an external model provider, which is billed independently by that provider.

## Connecting models

Open **Settings → Models & keys**. Choose a provider, optionally enter a model scope, paste the API key, and save. Add more than one key for the same provider/model to rotate between them. Leave model scope empty to make the key eligible for any model at that provider.

Then choose a provider in the top bar and enter its exact model ID. A display nickname such as `Opus 5.5` is not necessarily the API model ID. Use the actual identifier from the provider's developer documentation or dashboard.

| Provider | API adapter |
|---|---|
| OpenAI | Responses API |
| Anthropic / Claude | Messages API |
| Google Gemini | `generateContent` |
| xAI / Grok | Responses API |
| OpenRouter, DeepSeek, Mistral, Groq, Together AI, Fireworks AI | OpenAI-compatible Chat Completions |

## Plugin DSL v1

Plugins are YAML manifests. A tool declares a method, fixed HTTPS URL, host allowlist, input schema, optional body, and optional secrets. Secrets are stored separately and encrypted.

```yaml
name: hello-world
version: 1
description: A small public API example.
hosts:
  - api.github.com
secrets: []
tools:
  - name: get_repo
    description: Get public metadata for a GitHub repository.
    method: GET
    url: https://api.github.com/repos/${input.owner}/${input.repo}
    headers:
      Accept: application/vnd.github+json
      User-Agent: the-app-sucks
    input_schema:
      type: object
      properties:
        owner:
          type: string
          description: Repository owner
        repo:
          type: string
          description: Repository name
      required: [owner, repo]
```

Template variables:

- `${input.field}` references a validated tool input.
- `${secret.API_TOKEN}` references an encrypted plugin secret declared under `secrets`.

Example authenticated header:

```yaml
secrets:
  - API_TOKEN
# inside a tool:
headers:
  Authorization: Bearer ${secret.API_TOKEN}
```

The tool runner allows only HTTPS on the default port, exact hosts listed under `hosts`, common HTTP methods, and a maximum 15-second request. Redirects are not followed. Plugin request/response bodies are capped. Tool output is labeled untrusted before being passed back to a model.

## Storage and security notes

- All application routes are same-origin; the Worker does not enable permissive CORS.
- Session IDs are random, stored as SHA-256 hashes in D1, and sent in HTTP-only, Secure, SameSite=Strict cookies.
- Passwords are PBKDF2-SHA-256 hashes with per-user random salts.
- Provider keys and plugin secrets use AES-GCM with a key derived from `KEY_ENCRYPTION_SECRET` through HKDF. Back up the Worker secret securely. **Losing it makes saved keys and plugin secrets unrecoverable.** Rotating it requires a planned re-encryption migration.
- D1 stores user chat content and plugin source. Treat the database as sensitive user data and enable suitable backups/access controls.
- The app does not log provider keys. Avoid adding request-body logging to Worker middleware.

## Project layout

```text
src/
  App.tsx          React application, settings UI, plugin editor, code workspace
  api.ts           Same-origin API client
  index.css        Responsive dark UI and animations
  plugins.ts       YAML DSL validation and HTTPS tool runner
  providers.ts     Model-provider adapters
  security.ts      Password/session helpers and AES-GCM vault
  worker.ts        Cloudflare Worker API and D1 data access
migrations/
  0001_init.sql    D1 schema
wrangler.jsonc     Worker assets + D1 bindings
```

## Before public launch

Use an invitation-only registration flow or add email verification, account recovery, strict per-user rate limits, abuse monitoring, and an application privacy policy. Consider using Cloudflare Turnstile for registration and a managed auth provider instead of treating this starter's basic email/password flow as a finished identity product. Add a formal SSRF review before allowing untrusted people to upload plugins.
