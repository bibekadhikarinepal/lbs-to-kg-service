# lbs-to-kg — Portable Containerized REST Service

A small multi-container application that converts pounds to kilograms over a
REST API. The application is packaged as an OCI-compatible container image
and stores a persistent count of successful conversions in Redis. The whole
system is started, stopped, and recreated with Docker (or Podman) Compose.

## Architecture

| Service | Role | Host port |
|---|---|---|
| `app` | Node.js/Express REST API (`/health`, `/convert`, `/stats`) | `3000` (configurable via `HOST_PORT`) |
| `redis` | Stores the `conversions` counter, persisted to a named volume | not published — reachable only on the private `app-net` network |

The app locates Redis through the `REDIS_HOST`/`REDIS_PORT` environment
variables (set in `compose.yaml` to the Compose service name `redis`), never
through a hard-coded IP address or `localhost`. Compose's built-in DNS
resolves `redis` to the correct container on the `app-net` network.

## Prerequisites

- Docker Engine + the Compose plugin (`docker compose version`), **or**
  Podman + `podman compose` (Podman 4.7+ ships a compatible `compose`
  subcommand; all commands below also work with `podman` substituted for
  `docker`).
- Node.js 20+ only if you want to run the app or test script outside a
  container.

## Build and start the complete application

From the repository root:

```bash
docker compose up -d --build
```

This builds the `app` image from `app/Dockerfile` and starts both services on
the private `app-net` network. Redis data is persisted to the named volume
`redis_data`.

Check that both containers are healthy:

```bash
docker compose ps
```

## Testing each endpoint

### Automated

```bash
cd app
BASE_URL=http://localhost:3000 npm test
```

`test/run-tests.js` is a black-box test runner (no framework dependency —
uses the built-in `fetch`) that exercises every required case:

| Request | Expected result |
|---|---|
| `GET /convert?lbs=0` | `200`, `kg = 0` |
| `GET /convert?lbs=150` | `200`, `kg = 68.039` |
| `GET /convert?lbs=0.1` | `200`, `kg = 0.045` |
| `GET /convert` (missing) | `400` |
| `GET /convert?lbs=abc` | `400` |
| `GET /convert?lbs=-5` | `422` |
| `GET /stats` after conversions | correct persistent count |
| `GET /health` | `200`, `{"status":"ok"}` |

### Manual (curl)

```bash
curl -s http://localhost:3000/health
curl -s "http://localhost:3000/convert?lbs=150"
curl -s "http://localhost:3000/convert?lbs=0.1"
curl -s "http://localhost:3000/convert?lbs=-5"     # 422
curl -s "http://localhost:3000/convert?lbs=abc"    # 400
curl -s "http://localhost:3000/convert"            # 400
curl -s http://localhost:3000/stats
```

## Logs and runtime inspection

```bash
docker compose logs -f app          # follow app logs
docker compose logs redis           # redis logs
docker compose ps                   # status + health
docker inspect --format '{{json .State.Health}}' "$(docker compose ps -q app)"
docker network inspect $(docker compose ps -q app | xargs docker inspect --format '{{range $k,$v := .NetworkSettings.Networks}}{{$k}}{{end}}')
```

## Stopping and cleaning up

Three distinct levels of teardown:

- `docker compose stop` — stops the containers but keeps them (and the
  volume) on disk; a subsequent `docker compose start` resumes them with
  state intact.
- `docker compose down` — stops **and removes** the containers and the
  default network, but the named volume `redis_data` is preserved, so Redis
  state survives the next `docker compose up`.
- `docker compose down -v` — removes containers, network, **and** the named
  volume, permanently deleting the persisted conversion count. Use this only
  when you want a fully clean slate.

## Operational demonstration

A full transcript of build → start → health check → conversions → stats →
logs → `down` (volume kept) → recreate → verify persisted count → `down -v`
cleanup is captured in [`docs/operational-demo.log`](docs/operational-demo.log).

## Bug Fix: Requests Hung Instead of Failing Fast During a Redis Outage

While demonstrating the Redis-unreachable failure scenario (see Graduate
Extension below), `GET /convert` was found to hang indefinitely — rather than
returning `503` — whenever Redis was down. The `redis` npm client (v4)
defaults `disableOfflineQueue` to `false`, which silently queues commands
issued while disconnected and replays them once the connection is restored,
instead of rejecting them. That meant `await redisClient.incr(...)` in
[`app/src/server.js`](app/src/server.js) never threw during an outage, so the
`catch` block that returns `503` never ran — the HTTP request simply blocked
until Redis came back.

**Fix:** set `disableOfflineQueue: true` on the client in
[`app/src/redisClient.js`](app/src/redisClient.js), so commands reject
immediately while disconnected instead of queuing.

**Verified in `docs/operational-demo.log`:** with Redis stopped,
`GET /convert?lbs=10` now returns `503
{"error":"Storage unavailable, please retry"}` in ~0.025s instead of hanging;
once Redis is restarted, the client reconnects automatically and normal
`200` responses resume with no restart of `app`.

## Design Decisions

**How the application locates Redis.** The app never hard-codes an address;
it reads `REDIS_HOST` and `REDIS_PORT` from the environment
([`app/src/redisClient.js`](app/src/redisClient.js)). `compose.yaml` sets
`REDIS_HOST=redis`, the Compose service name, which Docker's embedded DNS
resolves to the current Redis container's address on `app-net`. This keeps
the image identical across environments — only the environment variables
change.

**Why Redis is not exposed to the host.** Redis has no authentication
configured and is meant to be an internal implementation detail of this
service, not a resource other host processes or the outside world should
reach. Omitting a `ports:` mapping for `redis` keeps it reachable only from
containers on `app-net`, minimizing the attack surface.

**Why the Redis volume is separate from the Redis container.** Containers
are meant to be disposable — recreated on every deploy, upgrade, or crash.
A named volume (`redis_data`) decouples persistent state from the container's
lifecycle, so `redis`'s container can be stopped, removed, upgraded to a new
image tag, or rescheduled without losing the `conversions` counter. Deleting
data becomes an explicit, separate action (`down -v`) instead of an accidental
side effect of removing a container.

**Containers vs. a single VM — one benefit, one limitation.**
- *Benefit:* the same `compose.yaml` and images run identically on a laptop,
  CI runner, or cloud host — no manual installation of Node, Redis, or
  matching-version system libraries on the VM, and no risk of one service's
  dependencies clashing with the other's.
- *Limitation:* an extra layer (the container runtime and its networking/
  storage drivers) sits between the application and the host, which adds
  operational overhead and a small amount of runtime resource overhead
  compared to two processes installed and talking over `localhost` on a
  single VM.

### Graduate extension (CS 554)

**Restart policy.** Both services use `restart: unless-stopped`
(`compose.yaml`). This restarts a container automatically after it exits due
to a crash or after the Docker daemon/host reboots, but — as the name implies
— it does **not** restart a container that was deliberately stopped by the
operator (`docker compose stop` or `docker stop`). That keeps automatic
recovery from failures while still respecting an explicit operator decision
to take a service down.

**Failure scenario: Redis becomes unreachable.** If the `redis` container
crashes, is being restarted, or the network between the services is
disrupted, `app/src/redisClient.js`'s `reconnectStrategy` keeps retrying the
connection with capped exponential backoff rather than crashing the process.
Meanwhile, `GET /convert` catches the `incr` failure and returns `503
Storage unavailable, please retry` instead of a `200` with a lost increment
([`app/src/server.js`](app/src/server.js)) — so the API degrades gracefully
and never reports success without persisting the count, and once Redis
(with its restart policy) comes back up, the client reconnects automatically
and normal operation resumes with no code changes or restart of `app`
required.

**Compose vs. single-VM deployment — tradeoffs.**
1. *Isolation & reproducibility vs. resource efficiency:* each service in
   Compose gets its own filesystem, dependency set, and network namespace,
   so upgrading Redis's version can never break the app's Node runtime (and
   vice versa) — but two containers carry more overhead (separate base
   layers, network bridge, health-check processes) than two bare processes
   sharing one OS on a VM.
2. *Operational simplicity vs. control:* Compose gives declarative,
   one-command lifecycle management (`up`/`down`/`stop`) and consistent
   networking/DNS across environments, whereas a hand-configured VM requires
   manually installing, versioning, and networking each service (and
   reproducing that setup on every new VM) — but the VM approach can be
   simpler to reason about when only a single, static deployment target
   exists and no reproducibility across environments is needed.
