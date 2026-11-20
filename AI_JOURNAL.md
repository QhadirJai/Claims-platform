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

## Session 5 — Angular frontend

**Asked:** One Angular app, two portals by role: claimant (responsive) and staff (desktop-first).

**Accepted:**
- Standalone components, lazy-loaded routes per portal, signals for state, functional interceptor + role guard.
- Route guard is explicitly **UX only** — API remains the security boundary.
- Plain SCSS, no UI library: faster install, fully neutral/unbranded look.
- Queue sorted oldest-first and highlights unassigned claims older than 7 days (what an officer needs to manage workload).
- Staff action panel only shows actions valid for the current status, mirroring the domain rules.

**Overrode:**
- AI first used the `currency:'USD'` pipe on claimant screens. Six markets = six currencies; showing "$" would be wrong.
  Switched to plain number formatting (multi-currency is listed as out of scope).

**Trade-off noted:** JWT kept in `sessionStorage` (cleared on tab close). An httpOnly cookie would be safer against XSS — listed as next step.

---

## Session 6 — API and end-to-end testing

**Asked:** A Postman collection for every endpoint, then Playwright tests that drive the real stack in a browser.

**Accepted:**
- Postman: 43 requests, 62 assertions, including the security cases (401, 403, IDOR → 404, 409 on simultaneous pick-up).
- Playwright runs against the real API, Postgres, Kafka and worker, not mocks. One worker, serial, because the tests share a database.
- The lifecycle test covers both portals and three users, and polls until the Kafka-driven notification arrives (asynchronous by design).
- A separate mobile project (Pixel 7 viewport) checks a claimant can report from a phone with no horizontal scrolling.

**Caught:** Two tests failed after the UI showed the same text in two places (request panel and timeline). The app was right; the tests were ambiguous. Fixed by scoping each check to its panel.

**Lost a session mid-way.** The chat history was gone, but this journal, the commit history and the code were enough to rebuild the context and carry on.

---

## Session 7 — Photo evidence, redesign, session handling

**Asked:** Make the claim scenario realistic with photos, and add Redis "to make it smooth".

**Challenged / decided myself:**
- **Redis — dropped.** AI pushed back: everything runs locally with small data, so Redis would not make the UI feel smoother. It would add stale-data and per-user cache-key risks. Where it would earn its place (caching the exposure dashboard, rate-limiting login, token revocation) goes under "at scale" in the README. I agreed.
- **Photos — yes.** The officer's "please upload photos" request had no way to be answered except "sent via email".

**Accepted (photo design):**
- Photo rules live in the domain (`Claim.AddAttachments`): owner only, only before a decision, max 10 per claim, one timeline event per batch.
- Bytes go to S3-compatible object storage, not Postgres. The bucket is private and photos are only served through the API with the same ownership rule (other claimant → 404).
- Server-side checks don't trust the client: file type from the actual bytes, 10 MB limit, EXIF/XMP/IPTC and PNG text chunks stripped (GPS is personal data), server-generated storage keys (the file name is display-only), `nosniff` and a sandbox CSP on download.
- The browser resizes to 2048px and re-encodes as JPEG before upload. A phone photo goes from ~6 MB to ~400 KB, which is the "smooth" I actually wanted. It also bakes in camera orientation. Not a security boundary; the server still checks.
- New `EvidenceAdded` event → the worker notifies the assigned officer.

**Overrode / adjusted:**
- **MinIO → SeaweedFS.** MinIO no longer publishes Docker images (pull denied on Docker Hub and Quay). Swapped to SeaweedFS's S3 gateway. No code change, because the API talks plain S3 via the AWS SDK.
- **Session:** I asked that Back after login must not show the login form again. Added a guest guard on `/login`, `replaceUrl` on login and logout, and an expired token now counts as signed out.
- **Redesign:** I asked for a modern look that doesn't feel AI-generated, and no emoji. Result: one accent colour, warm neutrals, one hand-drawn SVG icon set, no gradients.
- **Claimant layout:** The first version still had the timeline stacked under the claim. I didn't find that user-friendly, so the claimant portal got the same sidebar as staff and a two-column layout: timeline and updates in a side panel, the claim in the main column. Claims are grouped by "Needs your action / In progress / Closed".

**Tests:** 34 backend (photo rules, sanitiser with crafted JPEG/PNG, file-name cleaning, notification routing). 25 Playwright, including photo upload and preview, client-side and server-side rejection of a disguised file, cross-claimant 404 on a photo URL, and the Back-button behaviour.

---

## Session 8 — Checking against the brief, staff inbox

**Asked:** Check the build against the original brief, then add the missing piece.

**Accepted:**
- Everything the brief asks for was built. The gaps were in the explanation: `ARCHITECTURE.md` still called file uploads out of scope, had the wrong exposure formula and named an event that doesn't exist. It also didn't answer two of the brief's questions (who owns the contract, async across both tiers). Fixed and documented honestly, including what is *not* built.
- That review showed officers were notified (claimant replied, new photos) but had nowhere to see it. Added a staff Inbox with an unread count in the sidebar.
- Unread count is polled every 30 s and refreshed on navigation, not pushed. That is honest and cheap at this scale. Live push (SSE/SignalR) stays the documented next step.

**Caught:** The new test run exposed a real race in the queue. Changing filters quickly could let a slow, older response overwrite the newer results. Fixed by cancelling the previous request. The old test had passed by luck.

**Time:** the brief targets 2–3 hours with a 5-hour cap. Photos, the redesign and the inbox went beyond the core. I'll state the total time openly in the walkthrough and explain why each extra was worth it.

---

