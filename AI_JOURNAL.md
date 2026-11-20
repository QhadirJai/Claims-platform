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
