# AI Working Journal

Running log of how I directed the AI assistant (Claude Code) during this assessment:
what I asked, what I accepted, what I challenged, and what I overrode.
Not polished by design — entries are written as the work happens.

---

## Session 1 — Understanding the brief (before writing any code)

**Asked:** Read the assessment brief and explain what is actually being asked. Explicitly told the AI *not to build anything yet*.

**Accepted:**
- Summary of the two user groups (claimant vs claims staff) and the scoring signals: backend first, decisions + explanation, commit history, this journal.
- Compliance interpretation of the recruiter's disclaimer: run locally only (no public hosting), neutral app name ("ClaimsHub"), no Chubb branding, generic market codes, fabricated demo data only.

**Challenged / decided myself:**
- **Security layer.** I proposed a single middleware layer handling both user types for security. AI agreed but pushed further: a middleware that only checks "is the user logged in" still leaves IDOR open (claimant A reading claimant B's claim by changing the ID). Result: three layers in one backend — JWT authentication, role-based authorization policies, and ownership checks using the user id *from the token*, never from the URL. Angular route guards are UX only.
- **Real login vs role switcher.** AI first suggested a fake role switcher to save time. Because I want security to be a strength of the submission, we switched to real JWT login with seeded, BCrypt-hashed demo users.
- **Separate API gateway?** Rejected for this sprint — adds a moving part without adding real security; authorization must live in the service anyway. Noted as a scale-up option.
- **Tech stack — my decision:** .NET backend, Angular frontend, PostgreSQL, JWT.
- **Is Kafka optional?** I questioned whether "REST/HTTP and Kafka — you decide what uses which" meant I could pick one. AI's reading: "what uses which" implies both are used; the brief's questions about sync vs event-driven point the same way. Accepted — use both, with Kafka kept small and purposeful.
- **"Is Angular only for apps?"** Clarified Angular = web app (SPA) in the browser. One application, two portals by role. Claimant pages responsive (people report from their phone at the scene); staff pages optimised for desktop (tables, dashboards).
- **Do we need Docker?** Not required by the brief, and it is local (complies with no-hosting rule). Kept it because Kafka on native Windows is painful and reviewers can start everything with one command.

**Overrode / adjusted AI defaults:**
- Docker Postgres mapped to host port **5433** — I already have Postgres 18 on 5432.
- Global `dotnet-ef` on my machine is v10 (incompatible with SDK 8) — pinned v8.0.11 as a local tool in `.config/dotnet-tools.json`.

---

## Session 2 — Domain model & lifecycle rules

**Asked:** Generate the Claim aggregate with the agreed lifecycle, plus unit tests.

**Accepted:**
- Rich domain model: every status change is a method on `Claim` (`AssignTo`, `RequestInformation`, `Approve`...).
  Illegal transitions throw `DomainException`. Rules live in one place and are unit-testable without a DB.
- Each change appends a `ClaimEvent` (timeline) — the same records are later published to Kafka.
- `uint Version` mapped to Postgres `xmin` for optimistic concurrency on pick-up.

**AI went beyond the agreed design — reviewed and kept (to confirm in walkthrough):**
- *Exposure fallback:* before an officer sets a reserve, exposure uses the **claimed amount**.
  Otherwise brand-new claims would show zero liability, which understates risk. Approved-but-unsettled claims count at the approved amount.
- *Only the assigned officer (or a manager) can act on a claim.* Not in the brief, but prevents two
  officers working the same claim and gives managers an override.
- *Approved amount cannot exceed claimed amount.* Simplification — no policy limits/deductibles modelled.

**Result:** 15 unit tests passing (happy path, illegal transitions, ownership, exposure).

---

## Session 3 — Persistence, API, security layers

**Asked:** EF Core + Postgres, JWT auth, claimant + staff endpoints, dashboards.

**Accepted:**
- `SaveChangesAsync` override collects new `ClaimEvent`s, commits, *then* publishes to Kafka — never announce a change that rolled back.
- Secure-by-default `FallbackPolicy` (every endpoint needs auth unless `[AllowAnonymous]`).
- Ownership enforced in the query (`c.ClaimantId == tokenUserId`); another user's claim returns **404, not 403**, so we don't leak that it exists.
- Login returns the same error for unknown email vs wrong password (no account enumeration).
- Exposure endpoint reuses `Claim.OutstandingExposure` (rule defined once, in the domain). Loads open claims into memory — fine at this scale; at scale I'd push it to SQL or a read model.

**Caught during review (AI-generated code had issues):**
- **Reserve leak:** first version of the claimant endpoints returned `ReserveAmount` and the "Reserve set to X" timeline entry. Reserves are the insurer's internal estimate — claimants must not see them. Now stripped in the claimant view.
- **EF Guid gotcha:** with client-generated Guid keys, EF treats new children added to a loaded aggregate as *existing* rows (UPDATE → concurrency failure). Fixed with `ValueGeneratedNever()`.
- Name clash between our domain `Claim` and `System.Security.Claims.Claim` — aliased.

**Verified manually (curl):** 401 without token / bad password; IDOR → 404; claimant → staff API 403; officer → exposure 403;
**two officers picking up the same claim simultaneously → one 200, one 409**; full lifecycle incl. info request round-trip.

**Open question I'm leaving as-is:** non-assigned officer acting on a claim returns 400 (domain rule) rather than 403. Defensible either way.

---

## Session 4 — Kafka worker (notifications)

**Asked:** A separate worker process consuming `claims.events` and producing notifications.

**Accepted:**
- Manual offset commit *after* DB write → at-least-once delivery. Duplicates handled by unique `(UserId, SourceEventId)` index + pre-check → idempotent consumer.
- Transient errors: no commit, seek back, retry. Unreadable (poison) messages: log + skip (production: dead-letter topic).
- `ReserveSet` deliberately produces **no** claimant notification (internal figure).

**Verified:** Started the worker *after* events had been published — it caught up from Kafka and produced all notifications.
This is the demo for "what happens if the async side is down": nothing is lost, it catches up.

**Tests:** 18 passing (added notification routing tests).

---
