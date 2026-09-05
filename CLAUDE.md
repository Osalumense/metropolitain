# Working on Métropolitain

Conventions this project actually follows, derived from the existing code — not aspirational. Keep new code consistent with these, and update this file the moment a convention changes rather than letting it drift out of sync.

## Code style

- Named functions use `function name() {}` declarations, not `const name = () => {}` — true everywhere in both `apps/server` and `apps/web`, no exceptions. Arrow functions are for short inline callbacks only (`.map()`, event handlers, `requestAnimationFrame`), not for anything you'd give its own name and doc comment.
- Double-quoted strings, semicolons everywhere. Nothing enforces this yet (no ESLint/Prettier config exists in this repo at all) — match what's already there by eye until that changes.
- "Not found / couldn't parse" return values: use `null` when a function is deliberately signaling "I tried and there's no result" (e.g. `parseParisDateTime`, `extractQuayCode`). Use `undefined` when the absence is inherited from a native TS/JS mechanism — optional properties (`field?: string`), `Map.get()`, plain object indexing. Don't invent a third convention.
- Comments explain WHY, not what — a hidden constraint, a bug being worked around, a non-obvious invariant (see almost any function in `idfmIngestion.ts` for the standard this is held to). Never restate what the code already says. Don't write multi-paragraph doc comments as a matter of course — most functions need one sentence, if that.

## Configuration and shared types

- Every `process.env` read, on both `apps/server` and `apps/web`, lives in that app's `src/config/index.ts` — nowhere else. This also covers hardcoded endpoint URLs and tunable numeric limits (quota ceilings, intervals) even when they aren't currently read from an env var — anything that describes "how this deployment behaves" belongs in config.
- Shared data types (things crossing the server/client boundary, like `VehicleState`/`DisruptionState`) live in `apps/server/src/types/index.ts`. Types describing one external API's raw response shape (e.g. IDFM's SIRI `EstimatedCall`) belong there too, even when only one file consumes them.
- Relative imports must include the `.js` extension (`./config/index.js`, not `./config`) on the server. It runs as native ESM with no bundler; TypeScript doesn't rewrite import specifiers when it compiles, so the source has to already say the extension the compiled output will actually have.

## No mock data path

The server requires `PRIM_API_KEY` and always runs on real IDFM data. There is no mock/offline ingestion mode — don't add one back. If local dev ever needs to run without hitting the real quota, that's a conversation to have explicitly, not a silent fallback slipped in.

## Before every push

- Lefthook runs both workspaces' `npm run build` on `git push` (`lefthook.yml`) — a broken build should never reach a branch. It installs itself via the root `prepare` script on `npm install`.
- Both Dockerfiles run `npm ci --ignore-scripts` — the `prepare` script assumes a real git checkout, which the Docker build stage doesn't have.

## Deploying

- No CI/CD — deployment is manual: `git ls-files | rsync --files-from=- . root@<vps>:/app/metropolitain/`, then `docker compose build` + `docker compose up -d` on the VPS.
- A file only needs to be `git add`ed (staged), not committed, for `git ls-files` to pick it up — but a file that's still fully untracked (`??` in `git status`) will silently never reach production. This has actually happened this project — check `git status` before assuming a deploy included everything.
- Verify a deploy with real evidence — a curl, a live WebSocket check, a screenshot — never "should work."

## What NOT to do

- Never echo `PRIM_API_KEY` or `DEEPL_API_KEY` in any output. Check their presence with `grep -c`, never print the value.
- Never start local dev servers without being asked — this project is tested against production, not a local instance.
