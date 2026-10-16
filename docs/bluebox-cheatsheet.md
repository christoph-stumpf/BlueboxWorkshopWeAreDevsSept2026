# Bluebox — Presenter Cheatsheet

## What Bluebox is
Bluebox is a production-observability layer built for AI coding agents. It watches your live production
telemetry, automatically detects incidents, diagnoses root causes with evidence traced through your service
topology, and hands agents (or you) an evidence-backed fix — typically filed as a GitHub Issue. In short: it
gives coding agents the production visibility they otherwise lack, so teams can "merge with confidence."
Bluebox is a Dynatrace product (site is copyright © 2026 Dynatrace).

## Core capabilities (verified from site)

**What it observes / reads**
- Live production telemetry — "real traffic patterns, real error rates, real service dependencies."
- Ingests via OpenTelemetry (OTLP endpoint, auto-instrumentation). Also references OpenFeature (feature
  flags) and OpenInference (AI tracing).
- Query allowances scoped by data ingest + metric datapoints (see tiers).

**What it reasons about**
- Detects incidents from live telemetry automatically.
- Runs automated RCA: traces the problem through service topology, forms and tests hypotheses against
  production spans, assembles evidence. Investigations run ~2–10 minutes.
- Commit-to-incident tracing and multi-component impact detection.
- Distinguishes runtime-only failures (lock contention, dropped attributes under real load) that pass local
  tests, unit tests, and code review.

**How you interact with it**
- **CLI** (`bluebox`): `setup`, `auth login/status`, `ask`, `workspace list/switch`, `skills install`,
  `services list`, `repos list`, `investigations list/get`, `version`, `update`.
- **Web UI** (app.bluebox.ai): overview/findings, chat interface, environments, investigations, routines.
- **"Ask" queries** — proactive production questions from the terminal, answered with an Evidence section
  (queried data + coverage gaps). Examples:
  - `bluebox ask "what are the top failing services right now?"`
  - `bluebox ask --service checkout --env production "any error rate spikes in the last 30 minutes?"`
  - `bluebox ask "list the top 5 error messages in the last hour"`
- **Routines / automations** — run agents on a schedule (cron) or on GitHub events. Pre-built templates:
  verify bugfix PRs, daily deployment health, dependency vulnerability scan. Auto-investigations with a
  configurable daily budget.
- **Coding-agent integration** — a "production-query skill" installed via `bluebox setup`; supports Claude
  Code, GitHub Copilot, Cursor, Kiro, plus AWS DevOps Agent and Azure SRE Agent.

**Integrations**
- **GitHub** (core): sign-in, connected repos, output delivered as GitHub Issues.
- **OpenTelemetry / OTLP**; OpenFeature; OpenInference.
- **Coding agents**: Claude Code, GitHub Copilot, Cursor, Kiro; AWS DevOps Agent, Azure SRE Agent.

## Primary use cases (verified)
| Use case | Who | What |
|---|---|---|
| Automated incident response & RCA | DevOps / SRE | Detect incident → automated RCA → file GitHub Issue → agent fixes → post-deploy validation. Example: payment-service arithmetic error from a feature flag, diagnosed in ~10 min vs ~1 hr manual. |
| Production performance debugging | Backend engineers / SRE | Isolate wait vs execution time, segment users, correlate traffic with degradation. Example: one-line DB update spiked p99 19x (45ms→870ms) via lock contention. |
| Runtime bug detection beyond static testing | Developers / QA | Catch logic errors that pass tests but fail on real data. Example: OTel integration passed 31 unit tests + 2 reviews but silently dropped `event.source` on ~50% of events. |

## How it fits an observability stack
Bluebox sits on top of your telemetry: it ingests OpenTelemetry data (traces/spans, error rates, service
dependencies) from production and reasons over it — tracing failures through the live service topology rather
than pattern-matching logs — then routes the diagnosis and fix into your dev workflow (CLI, chat, GitHub).

## Talking points / one-liners
- "Coding agents are great at your local codebase — they're blind to production. Bluebox is their eyes."
- "Root cause grounded in what's actually happening — traced through your real service topology, not guessed
  from log patterns."
- "From incident to a GitHub Issue with full evidence in two to ten minutes."
- "Lock contention doesn't show up in local testing. It only surfaces under real traffic — Bluebox catches it."
- "Ask production a question before you write the code: `bluebox ask 'what are the top failing services right now?'`"

## What's distinctive vs generic AIOps
- Purpose-built as the **production layer for coding agents** — output is a scoped, evidence-backed *fix plan*
  delivered into GitHub/agent workflow, not just an alert or dashboard.
- **Runtime evidence model**: traces failures through the actual service topology instead of log pattern-matching.
- **Routines** turn recurring ops jobs (deploy health, PR verification, dependency scans) into scheduled agent runs.

---

### ⚠️ Could NOT verify from the site (double-check before stage)
- **DQL / DPQL / Dynatrace Davis / "causal AI" mechanics**: The docs (what-is / how-it-works / CLI) do **not**
  name DQL, Davis, or a specific query language, and don't describe the RCA engine internals. The public
  homepage summary referenced "Dynatrace's causal AI engine," but this is not corroborated in the product docs
  — treat any DQL/Davis claim as unconfirmed.
- **Slack integration**: Not found anywhere on the site — do not claim it.
- **MCP**: Not documented.
- **Dynatrace ownership**: Confirmed via © 2026 Dynatrace and "Bluebox by Dynatrace" branding; the deeper
  Dynatrace-platform tie-in appears only as an Enterprise-tier item ("Dynatrace platform access"), which is
  listed as in development.
- **Telemetry types**: OTel ingest is confirmed; explicit "logs + metrics + traces" wording is partial — traces/
  spans and metric datapoints are named; logs are implied by "other telemetry" retention, not stated outright.

### Pricing (verified, for reference)
- **Free ($0)**: 5 GiB/mo ingest, 3M metric datapoints/mo, 5-day trace / 15-day other retention, single
  workspace, OTel auto-instrumentation, automated bugfix loop. No credit card.
- **Pro ($75/mo)**: 50 GiB/mo ingest, 50M datapoints/mo, 10-day trace / 30-day other retention, priority
  processing, multi-team.
- **Enterprise (custom, in development)**: org governance, fleet management, SSO/SAML, SCIM, multiple
  workspaces, Dynatrace platform access.

---
*Fetched 2026-09-28. Sources: https://bluebox.ai/ · https://bluebox.ai/use-cases/ · https://bluebox.ai/pricing/ ·
https://docs.bluebox.ai · https://docs.bluebox.ai/what-is-bluebox · https://docs.bluebox.ai/how-it-works ·
https://docs.bluebox.ai/cli · https://blog.bluebox.ai*
