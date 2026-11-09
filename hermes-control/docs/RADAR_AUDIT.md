# RADAR Strategic Audit (Hermes multi-agent system)

**Date:** 2026-11-09
**Status:** platform audited; your live configuration is NOT yet audited
**Scope:** audit and design only. Nothing has been changed.

## How to read this

I can't reach the Pi or the Mac from the session that wrote this, so every statement carries one of three labels:

| Label | Meaning | Where the evidence comes from |
|---|---|---|
| **LIVE** | Verified on your system | Output you pasted from the Pi |
| **PLATFORM** | Verified that Hermes v0.23.0 (`2bd378ed`, the exact build on the Pi) supports or does it | Hermes source code and docs |
| **UNKNOWN** | Needs evidence from the Pi | `deploy/pi/radar-audit.sh` (read-only, prints no secrets) |

Your instruction applies throughout: **a prompt saying "Jeff monitors email" is not evidence that he does.** Capabilities only count when config, a job, a service or a log shows them.

---

## Deliverable 1: Executive assessment

**Have we already built RADAR's capabilities? Partially at the platform level. No, as far as I can verify, as a working capability.**

- **The platform has nearly every building block (PLATFORM):**
  - a durable scheduler (cron);
  - **script-only jobs that cost nothing in AI fees**;
  - **a pre-check script that can skip the AI entirely when nothing changed**;
  - result delivery to Telegram, with a `[SILENT]` marker to suppress no-news messages;
  - failure alerts with cooldowns;
  - Kanban for handing work to other agents;
  - approval prompts, including Telegram buttons;
  - cost analytics (`hermes insights`);
  - per-agent memory.

  RADAR does **not** need a new framework.
- **There is no evidence any RADAR-like job exists (UNKNOWN, probably missing).** I have seen no scheduled job, no "already reported this" record, and no monitoring script. Two weaknesses in the defaults also matter:
  - **Built-in memory is far too small** to remember reported findings: about 2,200 characters per agent (PLATFORM).
  - **Hermes trusts every connected service by default** (PLATFORM: `tools/mcp_tool.py:521`, "Missing trust = full"). Writes through Gmail, Notion or Drive tools run **without asking**.
- **Bottom line:** RADAR is a set of scheduled jobs plus one small "findings ledger" (a file recording what's been seen and reported), owned by Jeff. It is not a new bot. Two things must come first: the security default above, and checking that the Mac and the Pi aren't **both** running the same jobs.

## Deliverable 2: Current architecture (as far as verified)

```
iPhone/Mac ──Tailscale HTTPS──► Hermes Control (Pi, user service, :8787 loopback)        [LIVE: installed; Tailscale "done" per you, outputs not seen]
                                   │ bearer key per profile, loopback only
Telegram ◄──long-poll──►  hermes-gateway.service (Pi, user systemd, linger on)            [LIVE]
                           one process multiplexing profiles:                              [LIVE: 7 profiles, all "running"]
                             default (sonnet-4-6) · jeff · harry · lena · roxy · scout (sonnet-4-6) · debra (opus-4-8)
                           ├─ cron scheduler (60s tick)            [PLATFORM; jobs UNKNOWN]
                           ├─ Kanban dispatcher (~/.hermes/kanban.db, global board)       [PLATFORM; usage UNKNOWN]
                           ├─ MCP servers (5 node/npx children seen)                      [LIVE: processes; which servers UNKNOWN]
                           └─ API server 127.0.0.1:8642 (/p/<profile>/)                   [enabled per you; verification output not seen]
Storage: ~/.hermes/profiles/<p>/{state.db, memories/, skills/, cron/}  on a 1 TB USB *spinning* HDD   [LIVE: WD10JMVW]
Mac: Hermes v0.23.0 still installed as fallback; whether its gateway/cron is still RUNNING: UNKNOWN  ← critical
Nightly Hermes auto-update: script published; enabled? UNKNOWN
```

**Seen but unexplained (LIVE):** the gateway log shows repeating `WARNING` lines that retry with growing gaps (2, 4, 8 s…) at 12:38 and 12:46. Something keeps retrying, possibly an integration that broke in the move from the Mac.

## Deliverable 3: Gap analysis (capability by capability)

| Capability | Current implementation | Evidence | Working? | Gap | Recommended improvement |
|---|---|---|---|---|---|
| Commitment tracking | None known | No ledger or job seen | UNKNOWN, likely no | Nothing joins "I promised X" across Gmail, Calendar and Notion | Collector scripts plus a findings ledger; the AI extracts commitments only from *changed* threads |
| Email monitoring | Gmail access possible via Debra's Google setup (in progress) | `debra-google-client.json` copied (LIVE); MCP config UNKNOWN | UNKNOWN | No scheduled scan; write access probably ungated | **Read-only** Gmail credentials for monitoring; collector diffs by history ID |
| Calendar awareness | Unknown | — | UNKNOWN | — | Collector for the next 14 days of events; flags conflicts and prep gaps |
| Notion task awareness | Unknown | — | UNKNOWN | — | Collector queries Notion tasks with overdue or no-owner filters |
| Opportunity detection | Harry (Research) exists | Profile exists (LIVE); jobs UNKNOWN | UNKNOWN | No standing research job; no check against what's already known | A weekly research job owned by Harry, results checked against the ledger |
| Production intelligence | None known | — | UNKNOWN | — | Part of Harry's job: incentives, studios, productions in your markets |
| Financial exceptions | Debra (Production Accounting) on Opus 4.8 | LIVE profile | UNKNOWN | No deterministic overdue-invoice check | A script compares invoice due dates with paid status; the AI only explains |
| Cross-system correlation | None | — | No | No shared state across runs | The ledger keyed by business, project and counterparty is what makes correlation possible |
| Persistent memory | Built-in MEMORY.md / USER.md per profile | PLATFORM: about 2,200 + 1,375 characters | Works, but too small | Can't hold finding history | Keep it for preferences; the ledger is RADAR's memory |
| Deduplication | None | — | No | Repeated alerts guaranteed without state | Fingerprint each finding (source + object ID + kind); alert only on new or changed |
| Alert prioritization | None | — | No | — | Score urgency × impact × confidence; a script applies the threshold, not the AI's mood |
| Telegram delivery | Cron delivery to Telegram, `[SILENT]`, cron topic thread | PLATFORM | Configured: UNKNOWN | — | Daily digest plus an urgent lane; use the cron Telegram topic to keep the main chat clean |
| User approvals | Dangerous shell commands (`approvals.mode`, default **smart** = an AI judge); untrusted-MCP writes; Telegram buttons | PLATFORM | Partly | **External writes through trusted MCP aren't gated**; "smart" lets an AI auto-approve | Mark write-capable MCP servers untrusted; consider `manual` for profiles that read external content |
| Agent delegation | Kanban plus `delegate_task` | PLATFORM | UNKNOWN in practice | — | RADAR findings become Kanban cards assigned to the specialist; Jeff coordinates |
| Audit logs | Cron output saved locally; run history; Hermes Control `audit_log` | PLATFORM / LIVE (Hermes Control) | Partly | No single record of "what was alerted / approved / done" | The ledger records alert, decision and outcome for each finding |
| Automatic startup | Gateway and Hermes Control user services, linger | LIVE | Yes | — | — |
| Failure recovery | systemd restart; cron catch-up; failure incidents "alert once, remind on cooldown" | PLATFORM + LIVE (services) | Probably | Unexplained gateway warnings | Explain the warnings; `hermes cron doctor` daily as a script-only job |
| Security / access | Per-profile `.env`; API server on loopback with a key per profile; Tailscale | LIVE / PLATFORM | Partly | MCP trust default; public GitHub repo; loose OAuth secret file; **injection path from email/web into tools** | See P0 |
| Cost monitoring | `hermes insights` (tokens and cost) | PLATFORM | Available, unused | No budget or alert | A weekly script-only cost report; per-job model pins |
| Duplicate execution | — | — | **UNKNOWN: critical** | If the Mac gateway still runs, both machines may poll Telegram and fire the same cron jobs | Verify the Mac is stopped or paused (`hermes pause` on the Mac) |

**Underused (PLATFORM):**
- pre-check script gates;
- script-only cron jobs;
- per-job model and effort pins;
- `context_from` job chaining;
- failure incidents;
- `hermes insights`;
- Kanban for agent hand-offs.

**Possibly unnecessary:** six specialist profiles on full-size models for occasional work. Each one adds its own memory, credentials and MCP processes.

## Section 3: The RADAR concept, challenged

**Architecture**
- **Separate RADAR agent?** No. In Hermes, cron jobs already run in fresh isolated sessions, so a "RADAR agent" would mostly add another profile: more credentials, memory and MCP processes, plus a second voice on Telegram. Reliability comes from **deterministic collectors and a ledger**, not from another persona.
- **Could Jeff do it today?** Not reliably, through prompting alone. With scheduled jobs plus the ledger, yes. Jeff's job is to judge and coordinate, not to poll inboxes.
- **Scripts, cron, Claude or hybrid?** Hybrid, using native Hermes pieces:
  - **scripts** detect change (free, deterministic, testable);
  - **a cheap model** triages only what changed;
  - **Jeff (Sonnet)** reasons about the few items that matter;
  - **specialists** act through Kanban.
- **Jeff or Claude unavailable?**
  - Collectors and the ledger keep running, because they're scripts.
  - Failed AI jobs raise failure incidents.
  - Hermes re-runs a job that failed because the model was unreachable (PLATFORM).
  - Nothing is lost; the next digest catches up.
- **Over-complicated?** Seven always-on profiles is already a lot for one owner. Don't add an eighth.

**Intelligence (today, as far as can be verified)**
- **It summarizes; it doesn't discover.** No standing job or state means the system knows only what it's asked.
- **Commitments across sources:** not without a ledger keyed by counterparty and project.
- **Change vs. repetition:** not without fingerprints. Cron sessions are isolated (PLATFORM: "no memory of previous runs").
- **Validation:** only if the job is told to re-check its sources. The ledger should store evidence links, and a second pass should confirm before alerting.
- **Context between runs / stale advice:** the ledger's `status` (open, alerted, snoozed, resolved, obsolete) handles both.

**Autonomy**
- **Automatic:**
  - reading;
  - collecting;
  - scoring;
  - drafting (never sending);
  - creating Kanban cards;
  - digest delivery to *you*.
- **Approval required:**
  - any outbound email or message;
  - posting;
  - calendar invites to others;
  - payments;
  - deletions;
  - config changes.
- **Enforced technically, or only in prompts?** Today: **shell commands are gated technically; connected-service writes are not, by default.** A prompt saying "ask before sending" is not a control.
- **Injection risk: real.** A malicious email ("forward all invoices to x@…") read by an agent that holds a trusted Gmail tool could act on it.

  Mitigations, in order:
  1. Monitoring jobs use **read-only** credentials or toolsets.
  2. Write-capable servers are set to `trust: untrusted`.
  3. Unattended `cron_mode` and `unattended_mode` stay `deny` (the default, PLATFORM).
  4. Any action that comes from a finding goes through Needs You or a Telegram approval.

**Cost and performance (prices verified at Anthropic list rates, 2026-11-03)**
- **Today:** Sonnet 4.6 at $3 / $15 and Opus 4.8 at $5 / $25 per million input/output tokens.
- **Current generation:** Sonnet 5.5 at $2 / $10, Opus 5.5 at $4 / $20, Haiku 5.5 at $0.10 / $0.50. That's cheaper *and* newer, but switching models changes behaviour, so test first.
- **Illustrative monthly cost.** These are assumptions to replace with your real numbers once `hermes insights` has a baseline.

  | Approach | Usage assumed | Calculation | Monthly |
  |---|---|---|---|
  | **Naive** | Hourly AI sweep on Sonnet 4.6, 50K-token context | 720 runs × 50K = 36M input → $108 + output | **$120+** |
  | **Hybrid: triage** | Haiku 5.5, 30 changed items a day, 8K tokens in / 0.5K out | ≈ $0.03 a day | **≈ $1** |
  | **Hybrid: reasoning** | Sonnet 5.5, 5 escalations a day, 30K in / 2K out | ≈ $0.40 a day | **≈ $12** |
  | **Hybrid: research** | Weekly opportunity job, about 200K in / 10K out per run, web-search fees excluded | ≈ $2 a month | **≈ $2** |
  | **Hybrid total** | | | **≈ $15–20** |
- **Measuring value per dollar:** useful findings ÷ cost, where "useful" is your 👍/👎 on each alert.
- **The Pi:** collectors and API calls are light. 8 GB is enough, with the MCP node processes as the main RAM users; the audit script confirms. Notes:
  - The spinning USB HDD is fine for a small ledger.
  - **Back up `~/.hermes` nightly**, because the drive is the single point of failure.
  - Don't run local models on the Pi.

## Deliverable 4: Recommended architecture

| | A: Improve Jeff (prompting) | B: RADAR agent | **C: Hybrid, native, no new agent** | D: Redesign |
|---|---|---|---|---|
| Reliability | Low (memory, no state) | Medium | **High** (scripts plus ledger) | Unknown |
| Complexity | Low | High | **Medium** | High |
| Operating cost | High (AI does the polling) | High | **Low** | — |
| Maintainability | Fragile prompts | Two personas to keep in step | **Scripts are testable** | Rebuild risk |
| Security | Weak (prompt-only rules) | Weak, plus more credentials | **Strong** (read-only collectors, gated writes) | — |
| Latency | Slow | Medium | **Fast** (minutes; events can trigger jobs) | — |
| Extensibility | Low | Medium | **High** (add a collector) | — |
| Duplicated work | High | High | **Low** (one ledger) | — |

**Choice: C, implemented inside existing agents.**
- **Jeff** owns the RADAR jobs and the daily digest.
- **Harry** owns opportunity research.
- **Debra** owns financial exceptions.
- **No new profile.**

```
Sources (Gmail, Calendar, Notion, Drive, web)
  └─► collectors = Hermes cron pre-check / script-only jobs (read-only creds, ~/.hermes/scripts/)
        └─► findings ledger (SQLite in ~/.hermes/data/radar.db:
            fingerprint, business, project, counterparty, kind, evidence URLs, first/last seen, status, score)
              └─ only NEW/CHANGED → triage job (Haiku 5.5, cheap) → score
                    └─ above threshold → Jeff job (Sonnet) writes the digest / urgent alert
                          → Telegram via cron delivery ([SILENT] when nothing)
                          → Kanban card to Debra/Harry/Lena when action is needed
                          → any outbound action → approval (Needs You / Telegram button)
```

Business boundaries:
- Every finding carries `business`: FilmLV, Atomic Fox, VCC or personal.
- Digests are grouped by business.
- Credentials stay with the profile that already owns them.

## Section 6: Telegram as a command interface

| Capability | Native in Hermes v0.23.0 | Needs building |
|---|---|---|
| Separate bot identity per agent | **Yes** (each profile has its own bot token) | Only setup |
| Jeff as the main contact | **Yes** (his bot or chat) | — |
| Specialist alerts only when relevant | Partly (cron delivery per job, `[SILENT]`) | Thresholds in the ledger |
| Inline approve / reject | **Yes for dangerous commands and untrusted-MCP writes** (yes/no buttons) | **For findings ("Do it / Dismiss / Snooze"): custom.** Simplest is reply-by-number to Jeff, or Hermes Control's Needs You |
| Actionable daily summary | Yes (a cron job delivering to Telegram) | The digest prompt plus the ledger |
| Investigation requests | Yes (chat with Jeff) | Ledger lookup ("tell me more about #12") |
| Status tracking | Kanban (PLATFORM), notifier to chat | Link findings to cards |
| Source links / evidence | Whatever the job writes | Store evidence URLs in the ledger and require them in alerts |
| Follow-up questions | `clarify` with inline keyboard in chats (PLATFORM); not in unattended cron | — |
| Notification suppression | `[SILENT]`, cron topic thread, failure-incident cooldowns | Snooze per finding (ledger) |
| Urgent escalation | Separate job and delivery; Hermes Control push (planned) | Urgency rule |
| Record of approved / completed actions | Hermes Control audit log; cron output files | Ledger `decision` and `outcome` columns |

## Section 7: Success criteria (baseline first, no invented numbers)

**Weeks 1–2: shadow mode.**
- Jobs write to the ledger but **don't** alert you.
- You note issues you discover yourself.
- Collect: findings per day, duplicates, cost (`hermes insights`), job failures (`hermes cron doctor`).

**Targets** are set after the baseline. Proposed measures:

| Measure | Formula |
|---|---|
| Early detection | Issues RADAR logged before you found them ÷ all issues you logged |
| Precision | 👍 alerts ÷ all alerts (you rate each alert) |
| Duplicate rate | Alerts whose fingerprint was already alerted and unchanged ÷ alerts. Target: ≈ 0 by design |
| Missed commitments | Commitments you found that RADAR didn't. False positives: alerts rated "not a commitment" |
| Evidence coverage | Alerts with at least one working source link ÷ alerts |
| Cost | Monthly AI spend per job (`hermes insights`) and per useful finding |
| Reliability | Failed scheduled runs per week; time from Pi reboot to the first successful job |
| Delegation | Kanban cards from findings that reach "done" ÷ cards created |
| Time saved | Your weekly estimate. Self-reported, so labelled as such |

## Deliverable 5: Roadmap

**P0: Critical (before any RADAR work)**

| # | Change | Why | Owner | Complexity / cost | Risk | Acceptance test | Additive? |
|---|---|---|---|---|---|---|---|
| P0-1 | Run `radar-audit.sh` (read-only) | Turns every UNKNOWN into evidence | You (2 min) | S / $0 | None | Report pasted; this document updated | — |
| P0-2 | Confirm the Mac isn't also running the gateway and cron (`hermes pause` and stop the gateway on the Mac if so) | Prevents double Telegram polling and **double execution of jobs** (e.g. emails sent twice) | Mac Hermes | S / $0 | Low; the Mac stays a fallback | Mac: `hermes gateway status` stopped; Pi: no 409 Conflict in the log | Config |
| P0-3 | Set `trust: untrusted` on write-capable MCP servers (Gmail, Notion, Drive, social) in every profile | External writes currently need no approval (default trust = full) | Each profile config | S / $0 | Some flows will start asking; that's intended | A test draft-send asks for approval; reads still work | Config |
| P0-4 | Explain and fix the repeating gateway warnings | Possibly a broken integration after the migration | Gateway | S–M | — | 24 h log grouping shows no repeating warning | Fix |
| P0-5 | Nightly backup of `~/.hermes` plus the Hermes Control data (`hermes backup -o …` as a script-only cron job; copy off the Pi) | A single HDD holds all agent memory and state | Pi | S / $0 | Disk use | Restore test on the Mac succeeds | Additive |
| P0-6 | Make the GitHub repo private; secure or delete `~/debra-google-client.json` | Business information is public; a loose secret file | You | S | Updates switch to an authenticated download | Repo private; file is mode 600 or gone | — |

**P1: Immediate value (no new infrastructure)**

| # | Change | Why | Owner | Cost | Acceptance |
|---|---|---|---|---|---|
| P1-1 | Pin cron jobs to the right model and effort; evaluate moving chat to Sonnet 5.5 / Opus 5.5 | Same quality, lower price, on a newer model; must be A/B tested | Profiles | Saves money | Two weeks of side-by-side replies rated equal or better |
| P1-2 | Weekly cost and health digest (script-only job using `hermes insights` and `cron doctor`) | You see spend and failures without asking | Jeff (script) | $0 | Arrives Monday; numbers match the CLI |
| P1-3 | Shared "business" tags and routing rules in each agent's SOUL.md (FilmLV, Atomic Fox, VCC) | Keeps the businesses separate | Profiles | $0 | Spot-check: no cross-business leakage in 20 replies |

**P2: Proactive intelligence (RADAR, hybrid)**

| # | Change | Owner | Ongoing cost (assumptions above) | Acceptance |
|---|---|---|---|---|
| P2-1 | Findings ledger (`radar.db`) plus a fingerprint library (script) | Jeff's scripts | $0 | Unit tests: the same input never creates two findings |
| P2-2 | Gmail collector: unanswered threads older than N days from known clients, read-only | Jeff | ≈ $0–1 / month triage | Shadow mode finds threads you confirm |
| P2-3 | Calendar and Notion collectors | Jeff | ≈ $0–1 | — |
| P2-4 | Triage job (Haiku 5.5) gated by a pre-check | Jeff | ≈ $1 | Runs only when the ledger changed |
| P2-5 | Daily digest plus urgent lane (Sonnet), `[SILENT]` when empty | Jeff | ≈ $10–12 | 2 weeks: precision ≥ the target set after baseline |
| P2-6 | Opportunity research weekly (web), checked against the ledger | Harry | ≈ $2 plus search fees | Every item carries a source link; no repeats week to week |
| P2-7 | Financial exceptions (overdue invoices, missing documents) | Debra (script first) | ≈ $1 | Matches Debra's manual list |

**P3: Advanced autonomy**
- Findings become Kanban cards with owners.
- "Do it / Dismiss / Snooze" from Telegram (reply-by-number) and from Hermes Control's Needs You (push notifications).
- Pre-drafted replies saved as drafts, never sent without approval.
- Event-triggered jobs (webhooks) instead of polling where providers support it.

## Deliverable 6: First recommended action

**First action (no change): run `bash radar-audit.sh > radar-audit.txt` on the Pi and send me the output.** It's read-only and prints no secrets.

**First change (needs your approval, once the audit confirms the default): P0-3, mark write-capable connected services `trust: untrusted`.**

- **What it improves:** every write through Gmail, Notion, Drive or social tools needs your explicit approval. That closes the main route by which a malicious email or web page could make an agent act. This must be in place *before* agents read untrusted content on a schedule, which is what RADAR does.
- **Verification:** ask an agent to *draft* an email (no prompt) and then to *send* one to yourself; you should get an approval prompt, which you can then deny. Reads keep working.
- **Risks to control:**
  - Some existing automations will start asking. List them from the audit first.
  - Scheduled jobs that try to write will be **refused**, because nobody can answer in cron, and that's the safe default. They need redesigning to draft-and-approve.
  - Keep the Mac config unchanged until the cutover is final.
