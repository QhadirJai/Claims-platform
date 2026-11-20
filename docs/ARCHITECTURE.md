# ClaimsHub — Architecture & Decisions

> Assessment project. Runs locally only. Uses no proprietary information or branding; all data is fabricated.

## 1. Problem

Two user groups, one Angular web application:

| Claimant | Claims staff (Officer / Manager) |
|---|---|
| Report an incident, with photos | Pick up incoming claims |
| Track the claim | Review, assess, set reserve, request information |
| Respond to information requests (text and photos) | Approve / reject / settle |
| Receive the decision | See team workload and performance; managers see liability exposure |

**Prioritisation.** The backend came first: domain rules, API, security and the Kafka worker. The frontend
followed, then automated tests. Photo evidence was added last because it closes a gap in the main flow:
an officer asking for photos had no way to receive them.

## 2. System overview

```
┌──────────────────────────── Angular SPA ─────────────────────────────┐
│  Claimant portal (responsive)        Staff portal (desktop-first)    │
└───────────────────────────────┬──────────────────────────────────────┘
                                │ REST + JWT
┌───────────────────────────────▼──────────────────────────────────────┐
│ Claims.Api (.NET 8)                                                  │
│  JWT authn → role policies → ownership checks → controllers          │
│  Commit to DB, then publish domain event ─────────┐                  │
└──────┬─────────────────────┬──────────────────────┼──────────────────┘
 ┌─────▼──────┐     ┌────────▼─────────┐     ┌──────▼───────┐
 │ PostgreSQL │     │ S3-compatible    │     │    Kafka     │
 │ claims,    │     │ object store     │     │ claims.events│
 │ metadata   │     │ (photo bytes,    │     └──────┬───────┘
 └─────▲──────┘     │  private bucket) │            │
       │            └──────────────────┘            │
       └──────── notifications ─── Claims.Worker ◄──┘
```

**Why one API + one worker, not microservices?** A modular monolith with clear internal
boundaries (Domain / Infrastructure / Api) is the right size for the problem and the
time-box. The Worker is a genuinely separate process so the async boundary is real:
if it is down, claims are still accepted and notifications catch up from Kafka on restart.

**Why object storage for photos?** Image bytes don't belong in Postgres: they bloat backups and every
query that touches the table. The database keeps metadata (name, type, size, storage key); the bytes
live in a private S3-compatible bucket. Locally that is SeaweedFS in Docker (MinIO no longer publishes
images). The API uses the AWS S3 SDK, so the same code works against S3.

## 3. REST vs Kafka

| REST (caller needs the answer now) | Kafka (side effects that must not block or break the action) |
|---|---|
| Login, submit claim, list/view claims | Notifications to the claimant or the assigned officer |
| Pick up, set reserve, request info, approve/reject/settle | Future: read models (exposure), analytics, external integrations |
| Respond to info request, upload/download photos, dashboards | |

Every state change appends a `ClaimEvent` to the claim's timeline in the same transaction, and the
same event is then published to Kafka. The topic is `claims.events`, keyed by `ClaimId` so events for one claim stay in order.

| Event | Notifies |
|---|---|
| `ClaimSubmitted`, `ClaimAssigned`, `InfoRequested`, `ClaimApproved`, `ClaimRejected`, `ClaimSettled` | Claimant |
| `InfoProvided`, `EvidenceAdded` (photos) | Assigned officer |
| `ReserveSet` | Nobody: the reserve is internal and never shown to claimants |

The worker commits the Kafka offset only after writing to the database (at-least-once delivery).
A unique index on (user, source event) makes it idempotent, so a redelivered event never duplicates a notification.

**Known gap:** events are published after the DB commit (dual write). If Kafka is unavailable
at that instant the event is lost. Production fix: transactional outbox.

## 4. Frontend–backend contract

**The API owns the contract.** The C# request and response records in `Claims.Api/Contracts.cs` are the
source of truth, and Swagger (`/swagger`) publishes them. The Angular interfaces in `core/models.ts` mirror them by hand.

- Enums travel as strings (`"UnderReview"`, not `1`), so the JSON is readable and tolerates reordering.
- Errors use ProblemDetails (RFC 9110). Business-rule violations return 400 with a readable `detail`,
  concurrency conflicts 409, and another user's claim 404.
- The claimant and staff views of the same claim are different contracts. The claimant view drops the
  reserve and reserve timeline entries on the server, so the UI cannot leak what it never receives.

At this size, mirroring the interfaces by hand is fine. Next step: generate the TypeScript client from the
OpenAPI spec in CI, so a contract change breaks the frontend build rather than the running app.

## 5. Async across both tiers

- **Backend:** user actions are synchronous and transactional, so the caller gets the new state back
  immediately. Notifications are eventual: they appear once the worker has processed the event, usually
  within a second, and later if the worker was down. The Playwright suite polls for them for this reason.
- **Frontend:** pages load fresh data on navigation and after every action. There is **no live push**:
  a claimant sees a status change made by an officer on the next page load. This was a deliberate cut
  for the time-box. Next step: a server-sent events or SignalR channel fed by the same Kafka events.
- **Staff inbox:** officers get an Inbox page with an unread count in the sidebar. The count is refreshed on
  every navigation and polled every 30 seconds while the tab is visible (`GET /api/notifications/unread-count`,
  a single indexed count). Opening a notification marks it read and goes to the claim.
- **Stale responses:** the queue cancels the previous request when filters change, so a slow older
  response can't overwrite newer results.
- **Concurrency:** two officers picking up the same claim are protected by optimistic concurrency
  (Postgres `xmin`). One succeeds; the other gets 409 and the queue reloads.

## 6. Security

1. **Authentication** — JWT bearer, issued by `/api/auth/login`, BCrypt-hashed passwords. Unknown email and wrong password return the same error.
2. **Role authorization** — policies: `Claimant`, `Staff` (Officer + Manager), `Manager`. Every endpoint requires a signed-in user unless marked otherwise.
3. **Ownership** — claimant queries are filtered by the user id from the token, never from the request. Another user's claim or photo returns 404, not 403, so its existence isn't revealed. This prevents IDOR.

Angular route guards only improve UX; the API is the security boundary. A signed-in user is redirected away
from the login page, and an expired token counts as signed out.

**Photo uploads** treat the client as untrusted:
- File type is decided from the actual bytes (JPEG/PNG only), not the file name or `Content-Type`; 10 MB per photo, 10 per claim.
- Metadata is stripped on the server (JPEG EXIF/XMP/IPTC/comments, PNG text and `eXIf` chunks), because GPS coordinates are personal data.
- Storage keys are generated by the server (`claims/{claimId}/{attachmentId}`); the original file name is only a display label.
- Downloads go through the API with the ownership check and are sent with `X-Content-Type-Options: nosniff` and a sandbox CSP.
- The browser also resizes and re-encodes before upload (faster on mobile, drops metadata). That is convenience, not a security boundary.

**Trade-off:** the JWT is kept in `sessionStorage`. An httpOnly cookie would be safer against XSS.

## 7. Domain model

- **User** — Id, Email, PasswordHash, FullName, Role
- **Claim** (aggregate root) — Id, ClaimNumber, ClaimantId, AssignedOfficerId?, Type (Motor/Property), Market,
  PolicyNumber, IncidentDate, Location, Description, ClaimedAmount, ReserveAmount?, ApprovedAmount?,
  Status, RejectionReason?, CreatedAt, UpdatedAt, ClosedAt?, Version (concurrency)
- **InformationRequest** — Id, ClaimId, RequestedById, Question, Response?, RequestedAt, RespondedAt?
- **ClaimAttachment** — Id, ClaimId, UploadedById, FileName, ContentType, SizeBytes, StorageKey, UploadedAt
- **ClaimEvent** — timeline/audit entry, written in the same transaction as the change
- **Notification** — written by the Worker from Kafka events; unique per (user, source event)

InformationRequest, ClaimAttachment and ClaimEvent belong to the Claim aggregate: they are only changed through `Claim` methods.

### Lifecycle

```
Submitted ──pick up──► UnderReview ──request info──► InfoRequested
                          ▲  │                          │
                          │  └──── claimant responds ◄──┘
             UnderReview ─┼──approve──► Approved ──settle──► Settled
                          └──reject───► Rejected
```

Transitions are enforced inside the `Claim` aggregate; illegal transitions throw.
- Only the assigned officer or a manager can act on a claim.
- The approved amount cannot exceed the claimed amount.
- Photos can be added by the claimant only before a decision (Submitted, UnderReview, InfoRequested).
  Adding photos does not change the status.

### Liability exposure

Outstanding exposure per open claim:

| Status | Counts at |
|---|---|
| Submitted / UnderReview / InfoRequested | `ReserveAmount`, or `ClaimedAmount` if no reserve is set yet |
| Approved (not yet settled) | `ApprovedAmount` |
| Rejected / Settled | 0 |

The claimed-amount fallback avoids showing zero liability for new claims, which would understate risk.
The rule lives once, in `Claim.OutstandingExposure`, and the dashboard groups it by market and type.
It is computed live from Postgres: accurate and cheap at this scale. At scale it would be a Kafka-fed read model.

### Workload and performance (staff dashboard)

Per officer: open claims by status, the oldest open claim, claims closed in the last 30 days, and average days to close.
Team-wide: total open, unassigned, and the oldest unassigned claim. The queue sorts oldest first and highlights unassigned claims older than 7 days.

## 8. Out of scope (deliberate)

Real identity provider / SSO, payments, multi-currency, policy limits and deductibles, SLA engine,
transactional outbox, API gateway, live push to the browser (polling is used instead), a caching layer (Redis).
Each has a stated next step above or in the README; none was needed to prove the core flow.
