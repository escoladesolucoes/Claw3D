# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Boundary

Claw3D is a **frontend + Studio proxy** for OpenClaw. It is not the OpenClaw runtime. OpenClaw is the source of truth for agents, sessions, runs, transcripts, approvals, and runtime events; Claw3D visualizes and interacts with that state. Do not modify upstream OpenClaw source code from here — when behavior depends on the upstream contract, inspect a separate OpenClaw checkout and apply changes only in this app. The `openclaw` npm package is intentionally **not** a dependency; the build emits a `Can't resolve 'openclaw'` warning and it is harmless (resolved optionally at runtime).

## Commands

Dev / run:
- `npm run dev` — Studio dev server on port 3000 (`node server/index.js --dev`). The UI loads even without a gateway and shows the connection form; this is expected.
- `npm run dev:https` — same with self-signed TLS.
- `npm run demo-gateway` — mock local gateway at `ws://localhost:18789` for office demos without OpenClaw/Hermes.
- `npm run hermes-adapter` — Hermes WebSocket adapter.
- `npm run build` / `npm run start` — Next.js production build / serve.

Quality gates:
- `npm run lint` — ESLint. A small number of pre-existing warnings + one pre-existing error in `RetroOffice3D.tsx` are known; don't try to fix them as part of unrelated work.
- `npm run typecheck` — `tsc --noEmit`. Pre-existing errors exist in `agentChatPanel-*.test.ts` (stale `onOpenSettings` prop).
- `npm run test` — Vitest. **Watch mode is the default** — always pass `--run` for single-shot runs (`npm run test -- --run`). A few pre-existing failures exist.
- Single test file: `npm run test -- --run tests/unit/deskDirectives.test.ts`
- Single test by name: `npm run test -- --run -t "name pattern"`
- `npm run e2e` — Playwright. Requires `npx playwright install` first.
- `npm run smoke:dev-server` — boots dev server on a random port, verifies HTTP.

Other:
- `npm run studio:setup` is **interactive (TTY prompts)** — do not invoke in non-interactive/cloud contexts.
- `npm run sync:gateway-client` — refreshes the vendored gateway browser client helpers in `src/lib/gateway`.
- `npm run cleanup:ux-artifacts` — clean before committing if the change touched generated UX audit artifacts.

## Architecture (the non-obvious parts)

Two network hops, server-managed gateway connection:
1. Browser ⇄ Studio over HTTP + same-origin WS at `/api/gateway/ws`.
2. Studio ⇄ upstream OpenClaw Gateway over a second WS opened **server-side** by `server/gateway-proxy.js`.

So `ws://localhost:18789` always means "reachable from the Studio host," not the browser. Gateway URL/token live in Studio settings (`~/.openclaw/claw3d/settings.json`), and `server/studio-settings.js` is the only thing that reads them on the server side. Browser code must never write/read filesystem or hold gateway secrets in persistent storage.

Runtime data flow (events from gateway → UI):
1. `src/lib/gateway/GatewayClient.ts` — transport + session-key helpers.
2. `src/app/office/page.tsx` installs the main runtime subscription.
3. `src/features/agents/state/gatewayRuntimeEventHandler.ts` classifies events into chat/agent/terminal workflows.
4. `runtimeChatEventWorkflow.ts`, `runtimeAgentEventWorkflow.ts`, `runtimeTerminalWorkflow.ts` plan state updates + effect commands.
5. `runtimeEventCoordinatorWorkflow.ts` bridges reducer ↔ effects.
6. `historySyncOperation.ts` reconciles canonical `chat.history` when live streams are incomplete.
7. Both the agents UI and the office UI consume the same derived state — they do **not** maintain parallel models.

There are **two distinct office stacks** — confirm which one you are touching before editing:
- `/office` (immersive live office) → React Three Fiber, lives in `src/features/retro-office` + `src/features/office/screens/OfficeScreen.tsx`. Has its own furniture defaults and persistence pipeline.
- `/office/builder` (editor) → Phaser, lives in `src/features/office` (`OfficeBuilderScene.ts`, `OfficeViewerScene.ts`). Uses the `OfficeMap` schema in `src/lib/office/schema.ts`.

Office motion is **derived**, never imperatively pushed into the scene:
- `src/lib/office/eventTriggers.ts` derives animation/interaction holds from runtime events + transcript state.
- `reduceOfficeAnimationTriggerEvent()` → `reconcileOfficeAnimationTriggerState()` → `buildOfficeAnimationState()` → consumed by `RetroOffice3D`.
- This separation keeps transport-specific runtime details out of the 3D layer.

## Critical Conventions

**Office intent parsing is centralized in [`src/lib/office/deskDirectives.ts`](src/lib/office/deskDirectives.ts).** This is the *only* entry point for natural-language office directives (desks, GitHub/server-room holds, gym, QA lab, standup). When adding a new room/action, first ask: can it be a new field on `OfficeIntentSnapshot`? Consumers must use `resolveOfficeIntentSnapshot()` — do **not** scatter regex/intent checks elsewhere or write a parallel parser for Telegram/WhatsApp/UI chat transports.

**Gateway-first state.** Agent records, sessions, approvals, runtime streams, agent files = OpenClaw. Read/mutate through gateway APIs. Do not create a competing local source of truth, and do not write gateway-owned agent config directly to local OpenClaw files. Studio settings (`/api/studio`) own only UI preferences, desk assignments, and connection details — do not add parallel settings endpoints.

**Desk assignments are explicit, not sequential.** `deskAssignmentByDeskUid` is persisted in Studio settings and loaded by `OfficeScreen.tsx`; `RetroOffice3D.tsx` resolves indexes from that mapping. Unassigned agents intentionally stay put — do not "helpfully" assign defaults.

**Feature-first layout.** Start UI/workflow changes in `src/features/<area>` (`operations/` for side-effecting orchestration, `state/` for reducers/workflow planners). Only promote to `src/lib/<domain>` when something is reused across features or represents a stable contract. Route files in `src/app/*` compose feature modules; they should not become the home for business logic.

## Adding things (key extension points)

New 3D object: geometry/footprint in `src/features/retro-office/core/geometry.ts`, default placement in `core/furnitureDefaults.ts`, rendering in `objects/furniture.tsx` | `primitives.tsx` | `machines.tsx`, render switch in `RetroOffice3D.tsx`, navigation blocking in `core/navigation.ts` if relevant.

New room/activity: defaults + nav targets as above, dedicated route helper under `src/features/retro-office/core/navigation/` (see `gymRoute.ts`, `serverRoomRoute.ts`, `qaLabRoute.ts`), extend `OfficeIntentSnapshot`, update `eventTriggers.ts` to derive a hold/request, map the hold to a target in `useAgentTick()` inside `RetroOffice3D.tsx`, add unit tests alongside `deskDirectives.test.ts` / `officeEventTriggers.test.ts`.

New API route: keep handlers narrow; put shared logic in `src/lib` or a feature `operations/` module, not in the route file.

## Gotchas

- Transport-specific session keys (Telegram, WhatsApp, etc.) must map back to the correct agent — reuse session-key helpers in `src/lib/gateway`, do not ad-hoc parse.
- `NEXT_PUBLIC_GATEWAY_URL` is **build-time**; changing it requires `npm run build`. For a runtime alternative use `CLAW3D_GATEWAY_URL` + `CLAW3D_GATEWAY_TOKEN` (effective on server restart, no rebuild).
- In production, set `UPSTREAM_ALLOWLIST` to restrict which upstream gateway hosts Studio may proxy to, and `CUSTOM_RUNTIME_ALLOWLIST` for the `/api/runtime/custom` HTTP runtime seam (falls back to `UPSTREAM_ALLOWLIST` if unset).
- `STUDIO_ACCESS_TOKEN` is required when binding Studio to anything other than localhost.
- If a feature crosses Claw3D ↔ OpenClaw runtime, inspect upstream in a **separate** checkout — never modify OpenClaw source from this repo.
- Before publishing new bundled assets or vendored code, also update `THIRD_PARTY_ASSETS.md` or `THIRD_PARTY_CODE.md`.

## Reading order for new work

For runtime/agents work: `GatewayClient.ts` → `gatewayRuntimeEventHandler.ts` → `runtimeEventCoordinatorWorkflow.ts` → relevant `runtime*Workflow.ts` → nearest test in `tests/unit/`.

For office work: `src/app/office/page.tsx` → `OfficeScreen.tsx` → `eventTriggers.ts` → `deskDirectives.ts` → `RetroOffice3D.tsx` → `core/navigation.ts`.

Deeper background lives in `ARCHITECTURE.md` (boundaries + decisions) and `CODE_DOCUMENTATION.md` (code map + extension recipes).
