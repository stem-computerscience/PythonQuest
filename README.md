# Python Quest: Galactic Academy

A browser-based introductory Python RPG for grades 6–8. Two themes, Space Quest and Dungeon Quest, share the same Python missions.

## Architecture

- `web/`: GitHub Pages frontend.
- `web/python-worker.js`: Pyodide execution in a browser Web Worker.
- `worker/src/index.js`: Cloudflare Worker authentication and progress API.
- `worker/migrations/0001_init.sql`: Cloudflare D1 schema.

## Deployment

1. Create a free Cloudflare account and D1 database named `pythonquest`.
2. Replace `REPLACE_WITH_D1_DATABASE_ID` in `worker/wrangler.toml` with the actual D1 database ID.
3. From `worker/`, run `npm install` and `npx wrangler d1 migrations apply pythonquest --remote`.
4. Set a strong one-time bootstrap secret with `npx wrangler secret put SETUP_SECRET`.
5. Deploy with `npm run deploy`.
6. Replace the placeholder URL in `web/config.js` with the deployed Worker URL.
7. Enable GitHub Pages using GitHub Actions as the deployment source.
8. Provision the first teacher using `POST /api/setup` with JSON `{"username":"teacher","password":"a-unique-long-password"}` and the `x-setup-secret` header. Never put either secret in the repository.
9. Remove the bootstrap secret after setup.

## Security and readiness

**Prototype only; do not use with real students yet.** The current frontend checks mission completion and sends XP to the server; this is not trustworthy and must be replaced by server-validated mission events. Add login throttling, stricter session protections, and a security review before classroom rollout. Browser-side Python execution has a timeout, but it is not a complete sandbox guarantee. Do not store student passwords or personal records in the public repository.

## Current scope

Student login, two world themes, six introductory missions, progress saving, and a basic teacher dashboard. The RPG maps and battle system are placeholders, not a finished game.
