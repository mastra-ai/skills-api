# Skills API Reference

Complete endpoint reference for this project.

## 1. Basics

- Default local base URL: `http://localhost:3456`
- Default API prefix: `/api`
- Full API base (default): `http://localhost:3456/api`
- Prefix is configurable via `createSkillsApiServer({ prefix })`.
- Admin routes are enabled by default and can be disabled via `createSkillsApiServer({ enableAdmin: false })`.

## 2. Conventions

- Response format:
  - Most endpoints return JSON.
  - `GET /` returns HTML.
- Timestamp format: ISO 8601 (for example `2026-03-10T07:30:00.000Z`)
- Pagination:
  - Most list endpoints use `page` + `pageSize` (1-based page).
  - Incremental latest mode uses `offset` + `limit`.
- Cache behavior:
  - `GET /api/skills/*` uses ETag based on current `scrapedAt`.
  - `GET /api/skills/*/files` and `.../content` use longer cache headers.

## 3. Endpoint Index

### Service

- `GET /health`
- `GET /`

### Skills

- `GET /api/skills`
- `GET /api/skills/top`
- `GET /api/skills/sources`
- `GET /api/skills/sources/top`
- `GET /api/skills/owners`
- `GET /api/skills/agents`
- `GET /api/skills/stats`
- `GET /api/skills/incremental`
- `GET /api/skills/by-source/:owner/:repo`
- `GET /api/skills/:skillId`
- `GET /api/skills/:owner/:repo/:skillId`
- `GET /api/skills/:owner/:repo/:skillId/files`
- `GET /api/skills/:owner/:repo/:skillId/content`

### Admin

- `GET /api/admin/status`
- `POST /api/admin/refresh`
- `POST /api/admin/scheduler/start`
- `POST /api/admin/scheduler/stop`

## 4. Detailed Endpoints

### 4.1 Service

#### `GET /health`

Health check.

Example response:

```json
{
  "status": "ok",
  "timestamp": "2026-03-10T08:00:00.000Z",
  "service": "skills-api"
}
```

#### `GET /`

Returns the HTML landing page (not JSON).

### 4.2 Skills Listing and Metadata

#### `GET /api/skills`

List/search skills (paginated).

Query params:

- `query` (string): fuzzy search across `name`, `displayName`, `source`, `skillId`
- `owner` (string): filter by GitHub owner
- `repo` (string): filter by exact `owner/repo`
- `sortBy` (`name` | `installs`, default `installs`)
- `sortOrder` (`asc` | `desc`, default `desc`)
- `page` (number, default `1`, min `1`)
- `pageSize` (number, default `20`, range `1..100`)

Example:

```bash
curl "http://localhost:3456/api/skills?query=react&page=1&pageSize=20"
```

Example response fields:

- `skills`: `RegistrySkill[]`
- `total`: number
- `page`: number
- `pageSize`: number
- `totalPages`: number

#### `GET /api/skills/top`

Top skills by installs.

Query params:

- `limit` (number, default `100`, range `1..100`)

Response:

- `skills`: `RegistrySkill[]`
- `total`: number

#### `GET /api/skills/sources`

All source repositories with counts (paginated).

Query params:

- `page` (number, default `1`, min `1`)
- `pageSize` (number, default `50`, range `1..100`)

Response:

- `sources`: array of `{ source, owner, repo, skillCount, totalInstalls }`
- `total`, `page`, `pageSize`, `totalPages`

#### `GET /api/skills/sources/top`

Top repositories by installs.

Query params:

- `limit` (number, default `50`, range `1..100`)

Response:

- `sources`: array of `{ source, owner, repo, skillCount, totalInstalls }`
- `total`

#### `GET /api/skills/owners`

All owners with counts (paginated).

Query params:

- `page` (number, default `1`, min `1`)
- `pageSize` (number, default `50`, range `1..100`)

Response:

- `owners`: array of `{ owner, skillCount, totalInstalls }`
- `total`, `page`, `pageSize`, `totalPages`

#### `GET /api/skills/agents`

Supported AI agents.

Response:

- `agents`: supported agent list
- `total`

#### `GET /api/skills/stats`

Registry statistics.

Response:

- `scrapedAt`
- `totalSkills`
- `totalSources`
- `totalOwners`
- `totalInstalls`

### 4.3 Incremental Changes

#### `GET /api/skills/incremental`

Supports two modes.

Mode A: latest refresh delta (default, no `since`)

- Query params:
  - `type` (`added` | `removed` | `updated`, default `added`)
  - `offset` (number, default `0`, min `0`)
  - `limit` (number, default `100`, range `1..1000`)
- Response fields:
  - `mode: "latest"`
  - `available`
  - `refresh: { previousScrapedAt, currentScrapedAt, recordedAt }`
  - `summary: { added, removed, updated }`
  - `type`
  - `total`, `offset`, `limit`, `hasMore`
  - `items`

Mode B: since-based summary (`since` provided)

- Query params:
  - `since` (ISO 8601 timestamp, required for this mode)
- Response fields:
  - `mode: "since"`
  - `available`
  - `since`, `until`
  - `refreshes` (number of matched refreshes)
  - `summary: { added, removed, updated }`
  - `entries`: array of `{ recordedAt, previousScrapedAt, currentScrapedAt, added, removed, updated }`

Notes:

- If `since` is invalid, returns `400`.
- In `since` mode, `type/offset/limit` are ignored.
- If no refresh has run yet, latest mode returns:
  - `available: false`
  - `message: "No incremental data available yet. Trigger /api/admin/refresh first."`

Examples:

```bash
# Latest: only added items
curl "http://localhost:3456/api/skills/incremental?type=added&limit=50"

# Since: aggregate summary
curl "http://localhost:3456/api/skills/incremental?since=2026-03-10T00:00:00.000Z"
```

### 4.4 Skill Detail and GitHub-backed Endpoints

#### `GET /api/skills/by-source/:owner/:repo`

All skills under a repository.

Response:

- `source`
- `githubUrl`
- `skills`: sorted by installs desc
- `total`
- `totalInstalls`

Not found (`404`) when no skills exist for the repo.

#### `GET /api/skills/:skillId`

Lookup by skill ID (or `name`), returns first match.

Not found (`404`) if missing.

#### `GET /api/skills/:owner/:repo/:skillId`

Lookup by exact source + skill ID (or `name`).

Adds:

- `installCommand` (example: `npx skills add owner/repo/skill-id`)

Not found (`404`) if missing.

#### `GET /api/skills/:owner/:repo/:skillId/files`

Fetch all files in skill directory from GitHub.

Query params:

- `branch` (string, default `main`)

Response:

- `skillId`, `owner`, `repo`, `branch`
- `files` (file map, with text/binary handling from GitHub fetcher)

Not found (`404`) on fetch failure.

#### `GET /api/skills/:owner/:repo/:skillId/content`

Fetch parsed `SKILL.md` from GitHub.

Query params:

- `branch` (string, default `main`)

Response:

- `source`, `skillId`, `path`
- `metadata`
- `instructions`
- `raw`

Not found (`404`) on fetch failure.

### 4.5 Admin Endpoints

#### `GET /api/admin/status`

Scheduler/data/storage status.

Response:

- `scheduler: { running, refreshing }`
- `storage` (storage config info)
- `data: { lastUpdated, lastRefresh }`

#### `POST /api/admin/refresh`

Trigger manual refresh.

Responses:

- `200`: refresh success, includes `RefreshResult`
- `409`: refresh already in progress
- `500`: refresh failed

`RefreshResult` fields include:

- `success`, `timestamp`
- `skillCount`, `sourceCount`, `ownerCount`
- `durationMs`, `storageType`, `savedTo`
- `changes: { added, removed, updated }`
- `error` (on failure)

#### `POST /api/admin/scheduler/start`

Start scheduler.

Query params:

- `interval` (minutes, default `30`, min `5`)

Response:

- `message`
- `intervalMinutes`

#### `POST /api/admin/scheduler/stop`

Stop scheduler.

Response:

- `message`

## 5. Errors and Status Codes

- `200` OK
- `304` Not Modified (ETag hit on skills endpoints)
- `400` Bad Request (for example invalid `since`)
- `404` Not Found
- `409` Conflict (refresh already in progress)
- `500` Internal Server Error

## 6. Quick Call Examples

```bash
# Health
curl "http://localhost:3456/health"

# Skills search
curl "http://localhost:3456/api/skills?query=react&page=1&pageSize=20"

# Incremental since
curl "http://localhost:3456/api/skills/incremental?since=2026-03-10T00:00:00.000Z"

# Trigger refresh
curl -X POST "http://localhost:3456/api/admin/refresh"
```
