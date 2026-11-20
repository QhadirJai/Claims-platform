# ClaimsHub — Architecture & Decisions

> Assessment project. Runs locally only. Uses no proprietary information or branding; all data is fabricated.

## 1. Problem

Two user groups, one Angular web application:

| Claimant | Claims staff (Officer / Manager) |
|---|---|
| Report an incident | Pick up incoming claims |
| Track the claim | Review, assess, set reserve |
| Respond to information requests | Approve / reject / settle |
| Receive the decision | See team workload; managers see liability exposure |

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
└───────────────┬───────────────────────────────────┼──────────────────┘
          ┌─────▼──────┐                     ┌──────▼──────┐
          │ PostgreSQL │◄────────────────────│    Kafka    │
          └────────────┘  notifications      │ claims.events│
                                             └──────┬──────┘
                          Claims.Worker ◄───────────┘
                          (consumer → notifications)
```

**Why one API + one worker, not microservices?** A modular monolith with clear internal
boundaries (Domain / Infrastructure / Api) is the right size for the problem and the
time-box. The Worker is a genuinely separate process so the async boundary is real:
if it is down, claims are still accepted and notifications catch up from Kafka on restart.

## 3. REST vs Kafka

| REST (caller needs the answer now) | Kafka (side effects that must not block or break the action) |
|---|---|
| Login, submit claim, list/view claims | `ClaimSubmitted` → notify claimant & staff |
| Pick up, set reserve, request info, approve/reject/settle | `ClaimStatusChanged` etc. → notify the right people |
| Respond to info request, dashboards | Future: read models, analytics, external integrations |

Single topic `claims.events`, keyed by `ClaimId` so events for one claim stay ordered.

**Known gap:** events are published after the DB commit (dual write). If Kafka is unavailable
at that instant the event is lost. Production fix: transactional outbox.

## 4. Security

1. **Authentication** — JWT bearer, issued by `/api/auth/login`, BCrypt-hashed passwords.
2. **Role authorization** — policies: `Claimant`, `Staff` (Officer + Manager), `Manager`.
3. **Ownership** — claimant queries are filtered by the user id from the token, never from the request. Prevents IDOR.

Angular route guards only improve UX; the API is the security boundary.

## 5. Domain model

- **User** — Id, Email, PasswordHash, FullName, Role
- **Claim** — Id, ClaimNumber, ClaimantId, AssignedOfficerId?, Type (Motor/Property), Market,
  PolicyNumber, IncidentDate, Location, Description, ClaimedAmount, ReserveAmount?, ApprovedAmount?,
  Status, RejectionReason?, CreatedAt, UpdatedAt
- **InformationRequest** — Id, ClaimId, RequestedById, Question, Response?, RequestedAt, RespondedAt?
- **ClaimEvent** — timeline/audit entry, written in the same transaction as the change
- **Notification** — written by the Worker from Kafka events

### Lifecycle

```
Submitted ──pick up──► UnderReview ──request info──► InfoRequested
                          ▲  │                          │
                          │  └──── claimant responds ◄──┘
             UnderReview ─┼──approve──► Approved ──settle──► Settled
                          └──reject───► Rejected
```

Transitions are enforced inside the `Claim` aggregate; illegal transitions throw.
Pick-up uses optimistic concurrency so two officers cannot take the same claim.

### Liability exposure

Exposure = `ReserveAmount` of open claims (Submitted / UnderReview / InfoRequested)
+ `ApprovedAmount` of Approved-but-unsettled claims, grouped by market and type.
Computed live from Postgres (accurate, cheap at this scale). At scale: a Kafka-fed read model.

## 6. Out of scope (deliberate)

Real identity provider / SSO, file uploads, payments, multi-currency, SLA engine,
transactional outbox, API gateway.
