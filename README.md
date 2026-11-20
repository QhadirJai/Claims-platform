# ClaimsHub — Claims Platform (Take-Home Assessment)

A claims platform for motor and property claims: claimants report and track claims; claims staff
pick up, assess, and settle or reject them; managers see workload and outstanding liability exposure.

> **Local only.** This project is not publicly hosted and contains no proprietary information or branding.
> All names, policies and claims in the seed data are fabricated.

- Architecture & decisions: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)
- AI working journal: [AI_JOURNAL.md](AI_JOURNAL.md)

## Stack

| Layer | Choice |
|---|---|
| Frontend | Angular |
| Backend | .NET 8 Web API (`Claims.Api`) + .NET Worker (`Claims.Worker`) |
| Database | PostgreSQL 16 (EF Core 8) |
| Messaging | Kafka 3.8 (KRaft, single node) |
| Auth | JWT bearer, BCrypt password hashes, role policies |
| Tests | xUnit |

## Prerequisites

- Docker Desktop
- .NET 8 SDK
- Node.js 20+ (for the frontend)

## Run it

```bash
# 1. Infrastructure (Postgres on host port 5433, Kafka on 9092)
docker compose up -d

# 2. API — applies migrations and seeds demo data on first start
cd backend
dotnet run --project src/Claims.Api --launch-profile http
#    → http://localhost:5080/swagger

# 3. Worker (second terminal) — consumes Kafka events, writes notifications
cd backend
dotnet run --project src/Claims.Worker

# 4. Frontend (third terminal)
cd frontend/claims-web
npm install
npm start
#    → http://localhost:4200
```

Optional Kafka UI: `docker compose --profile tools up -d` → http://localhost:8085

### Tests

```bash
cd backend
dotnet test
```

## Demo accounts

All passwords: `Passw0rd!`

| Email | Role |
|---|---|
| alice@demo.local | Claimant |
| ben@demo.local | Claimant |
| olivia@demo.local | Claims Officer |
| oscar@demo.local | Claims Officer |
| maya@demo.local | Manager (sees exposure dashboard) |

## API overview

| Method | Path | Who |
|---|---|---|
| POST | `/api/auth/login` | anyone |
| GET | `/api/auth/me` | any logged-in user |
| POST | `/api/claims` | Claimant — report incident |
| GET | `/api/claims/mine` | Claimant |
| GET | `/api/claims/{id}` | Claimant (own claims only) |
| POST | `/api/claims/{id}/info-requests/{reqId}/response` | Claimant |
| GET | `/api/notifications` | any logged-in user |
| GET | `/api/staff/claims?scope=mine\|unassigned\|all&status=&type=&market=&openOnly=` | Staff |
| GET | `/api/staff/claims/{id}` | Staff |
| POST | `/api/staff/claims/{id}/assign` | Staff — pick up (409 if someone else got it first) |
| PUT | `/api/staff/claims/{id}/reserve` | Assigned officer / manager |
| POST | `/api/staff/claims/{id}/info-requests` | Assigned officer / manager |
| POST | `/api/staff/claims/{id}/approve` · `/reject` · `/settle` | Assigned officer / manager |
| GET | `/api/staff/dashboard/workload` | Staff |
| GET | `/api/staff/dashboard/exposure` | Manager |

Full contract: Swagger UI at `/swagger` when the API is running.

**Postman:** import [docs/postman/ClaimsHub.postman_collection.json](docs/postman/ClaimsHub.postman_collection.json) and run the whole collection in order. Logins store tokens automatically, IDs are chained between requests, and 62 assertions cover the happy path, illegal transitions and security checks. CLI: `npx newman run docs/postman/ClaimsHub.postman_collection.json`.

## Things to try

1. **Async resilience:** stop the Worker, submit a claim as Alice, start the Worker again. Notifications appear, because nothing was lost; the worker catches up from Kafka.
2. **Concurrency:** have two officers pick up the same claim at once. One gets 200, the other gets 409.
3. **Ownership:** as Alice, request one of Ben's claim ids. The API returns 404.

## Known limitations / next steps

- Kafka publish happens after the DB commit (dual write). **Transactional outbox** would close the gap.
- No real identity provider, refresh tokens or password reset. The JWT signing key is a dev-only value in `appsettings.Development.json`.
- No document uploads, payments, policy limits, deductibles or multi-currency.
- Exposure is computed on request from Postgres. At scale it would be a read model fed by Kafka.
- Notifications are polled by the UI. SignalR or WebSockets would make them push-based.
