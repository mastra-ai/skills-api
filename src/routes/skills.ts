/**
 * Skills API Routes
 * Provides endpoints for browsing, searching, and retrieving skills
 */

import { Hono } from 'hono';

import { fetchSkillFromGitHub, fetchSkillFiles } from '../github/index.js';
import { isS3Configured, loadSkillFilesFromS3, saveSkillFilesToS3 } from '../storage/s3.js';
import {
  getSkills,
  getMetadata,
  getSources,
  getOwners,
  getTopSkills,
  getTopSources,
  supportedAgents,
} from '../registry/index.js';
import { getLastRefreshIncrement, getRefreshHistory } from '../scheduler/index.js';
import type {
  PaginatedSkillsResponse,
  SkillSearchParams,
  RegistrySkill,
  IncrementalSkillUpdate,
  RefreshHistoryEntry,
  Source,
} from '../registry/types.js';

const skillsRouter = new Hono();

/**
 * Helper to search skills based on query parameters
 */
function searchSkills(params: SkillSearchParams): PaginatedSkillsResponse {
  let filtered = [...getSkills()];

  // Text search across name, displayName, source
  if (params.query) {
    const query = params.query.toLowerCase();
    filtered = filtered.filter(
      skill =>
        skill.name.toLowerCase().includes(query) ||
        skill.displayName.toLowerCase().includes(query) ||
        skill.source.toLowerCase().includes(query) ||
        skill.skillId.toLowerCase().includes(query),
    );
  }

  // Filter by owner
  if (params.owner) {
    filtered = filtered.filter(skill => skill.owner === params.owner);
  }

  // Filter by repo
  if (params.repo) {
    filtered = filtered.filter(skill => skill.source === params.repo);
  }

  // Sort
  const sortBy = params.sortBy || 'installs';
  const sortOrder = params.sortOrder || 'desc';

  filtered.sort((a, b) => {
    let comparison = 0;

    switch (sortBy) {
      case 'name':
        comparison = a.name.localeCompare(b.name);
        break;
      case 'installs':
        comparison = a.installs - b.installs;
        break;
      default:
        comparison = a.installs - b.installs;
    }

    return sortOrder === 'desc' ? -comparison : comparison;
  });

  // Pagination
  const page = Math.max(1, params.page || 1);
  const pageSize = Math.min(100, Math.max(1, params.pageSize || 20));
  const total = filtered.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedSkills = filtered.slice(startIndex, startIndex + pageSize);

  return {
    skills: paginatedSkills,
    total,
    page,
    pageSize,
    totalPages,
  };
}

type IncrementType = 'added' | 'removed' | 'updated';

function parseIncrementType(typeQuery: string | undefined): IncrementType {
  if (typeQuery === 'removed' || typeQuery === 'updated') {
    return typeQuery;
  }
  return 'added';
}

function getEntryExpectedCount(entry: RefreshHistoryEntry, type: IncrementType): number {
  if (type === 'removed') return entry.removed;
  if (type === 'updated') return entry.updated;
  return entry.added;
}

function getEntryItems(
  entry: RefreshHistoryEntry,
  type: IncrementType,
  latestIncrement: ReturnType<typeof getLastRefreshIncrement>,
): Array<RegistrySkill | IncrementalSkillUpdate> {
  if (type === 'removed' && Array.isArray(entry.removedItems)) return entry.removedItems;
  if (type === 'updated' && Array.isArray(entry.updatedItems)) return entry.updatedItems;
  if (type === 'added' && Array.isArray(entry.addedItems)) return entry.addedItems;

  // Backward compatibility for old history records without detail payload:
  // if this entry is also the in-memory latest increment, use that detail.
  if (latestIncrement?.recordedAt === entry.recordedAt) {
    if (type === 'removed') return latestIncrement.removed;
    if (type === 'updated') return latestIncrement.updated;
    return latestIncrement.added;
  }

  return [];
}

function aggregateIncrementItemsBySource(items: Array<RegistrySkill | IncrementalSkillUpdate>): Source[] {
  const sourceMap = new Map<string, Source>();

  for (const item of items) {
    const existing = sourceMap.get(item.source);
    if (existing) {
      existing.skillCount += 1;
      existing.totalInstalls += item.installs;
    } else {
      sourceMap.set(item.source, {
        source: item.source,
        owner: item.owner,
        repo: item.repo,
        githubUrl: item.githubUrl,
        skillCount: 1,
        totalInstalls: item.installs,
      });
    }
  }

  return Array.from(sourceMap.values()).sort((a, b) => {
    if (b.totalInstalls !== a.totalInstalls) {
      return b.totalInstalls - a.totalInstalls;
    }
    if (b.skillCount !== a.skillCount) {
      return b.skillCount - a.skillCount;
    }
    return a.source.localeCompare(b.source);
  });
}

/**
 * GET /api/skills
 * List and search skills with pagination
 *
 * Query Parameters:
 * - query: Search text
 * - owner: Filter by GitHub owner
 * - repo: Filter by repository (owner/repo format)
 * - sortBy: Sort field (name, installs)
 * - sortOrder: Sort order (asc, desc)
 * - page: Page number (1-indexed)
 * - pageSize: Items per page (default: 20, max: 100)
 */
skillsRouter.get('/', c => {
  const query = c.req.query('query');
  const owner = c.req.query('owner');
  const repo = c.req.query('repo');
  const sortBy = c.req.query('sortBy') as SkillSearchParams['sortBy'];
  const sortOrder = c.req.query('sortOrder') as SkillSearchParams['sortOrder'];
  const page = parseInt(c.req.query('page') || '1', 10);
  const pageSize = parseInt(c.req.query('pageSize') || '20', 10);

  const result = searchSkills({
    query,
    owner,
    repo,
    sortBy,
    sortOrder,
    page,
    pageSize,
  });

  return c.json(result);
});

/**
 * GET /api/skills/top
 * Get top skills by installs
 */
skillsRouter.get('/top', c => {
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));
  const topSkills = getTopSkills(limit);
  return c.json({
    skills: topSkills,
    total: topSkills.length,
  });
});

/**
 * GET /api/skills/sources
 * Get all source repositories with skill counts
 */
skillsRouter.get('/sources', c => {
  const sources = getSources();
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50', 10)));

  const total = sources.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedSources = sources.slice(startIndex, startIndex + pageSize);

  return c.json({
    sources: paginatedSources,
    total,
    page,
    pageSize,
    totalPages,
  });
});

/**
 * GET /api/skills/sources/top
 * Get top sources by total installs
 */
skillsRouter.get('/sources/top', c => {
  const limit = Math.min(100, Math.max(1, parseInt(c.req.query('limit') || '50', 10)));
  const topSources = getTopSources(limit);
  return c.json({
    sources: topSources,
    total: topSources.length,
  });
});

/**
 * GET /api/skills/owners
 * Get all skill owners with counts
 */
skillsRouter.get('/owners', c => {
  const owners = getOwners();
  const page = Math.max(1, parseInt(c.req.query('page') || '1', 10));
  const pageSize = Math.min(100, Math.max(1, parseInt(c.req.query('pageSize') || '50', 10)));

  const total = owners.length;
  const totalPages = Math.ceil(total / pageSize);
  const startIndex = (page - 1) * pageSize;
  const paginatedOwners = owners.slice(startIndex, startIndex + pageSize);

  return c.json({
    owners: paginatedOwners,
    total,
    page,
    pageSize,
    totalPages,
  });
});

/**
 * GET /api/skills/agents
 * Get all supported AI agents
 */
skillsRouter.get('/agents', c => {
  return c.json({
    agents: supportedAgents,
    total: supportedAgents.length,
  });
});

/**
 * GET /api/skills/stats
 * Get registry statistics
 */
skillsRouter.get('/stats', c => {
  const skills = getSkills();
  const metadata = getMetadata();
  const totalInstalls = skills.reduce((sum, s) => sum + s.installs, 0);

  return c.json({
    scrapedAt: metadata.scrapedAt,
    totalSkills: metadata.totalSkills,
    totalSources: metadata.totalSources,
    totalOwners: metadata.totalOwners,
    totalInstalls,
  });
});

/**
 * GET /api/skills/incremental
 * Get incremental changes from the latest successful refresh
 *
 * Query Parameters:
 * - since: ISO timestamp. When provided, returns aggregated changes since this time
 * - type: Change type (added, removed, updated), default: added
 * - groupBy: source (optional). Aggregate returned items by source repository.
 * - offset: Pagination offset, default: 0
 * - limit: Items per page, default: 100, max: 1000
 */
skillsRouter.get('/incremental', async c => {
  const type = parseIncrementType(c.req.query('type'));
  const groupBy = c.req.query('groupBy');
  const groupBySource = groupBy === 'source';
  const offset = Math.max(0, parseInt(c.req.query('offset') || '0', 10));
  const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') || '100', 10)));
  const sinceQuery = c.req.query('since');

  if (sinceQuery) {
    const sinceMs = Date.parse(sinceQuery);
    if (!Number.isFinite(sinceMs)) {
      return c.json(
        {
          error: 'Invalid since timestamp. Use ISO 8601 format.',
          example: '2026-03-10T07:30:00.000Z',
        },
        400,
      );
    }

    const history = await getRefreshHistory();
    const entries = history
      .filter(entry => Date.parse(entry.recordedAt) > sinceMs)
      .sort((a, b) => Date.parse(a.recordedAt) - Date.parse(b.recordedAt));

    const latestIncrement = getLastRefreshIncrement();
    const entryDetails = entries.map(entry => {
      const detailItems = getEntryItems(entry, type, latestIncrement);
      const expected = getEntryExpectedCount(entry, type);
      const detailsAvailable = expected === 0 || detailItems.length > 0;

      return {
        recordedAt: entry.recordedAt,
        previousScrapedAt: entry.previousScrapedAt,
        currentScrapedAt: entry.currentScrapedAt,
        added: entry.added,
        removed: entry.removed,
        updated: entry.updated,
        detailsAvailable,
        detailCount: detailItems.length,
        detailItems,
      };
    });

    const summary = entries.reduce(
      (acc, entry) => {
        acc.added += entry.added;
        acc.removed += entry.removed;
        acc.updated += entry.updated;
        return acc;
      },
      { added: 0, removed: 0, updated: 0 },
    );

    const items = entryDetails.flatMap(entry => entry.detailItems);
    const paginatedItems = items.slice(offset, offset + limit);
    const missingDetailEntries = entryDetails.filter(entry => !entry.detailsAvailable).length;

    if (groupBySource) {
      const sourceItems = aggregateIncrementItemsBySource(items);
      const paginatedSources = sourceItems.slice(offset, offset + limit);

      return c.json({
        mode: 'since',
        available: history.length > 0,
        since: new Date(sinceMs).toISOString(),
        until: getMetadata().scrapedAt,
        refreshes: entries.length,
        summary,
        type,
        groupBy: 'source',
        total: sourceItems.length,
        itemTotal: items.length,
        offset,
        limit,
        hasMore: offset + paginatedSources.length < sourceItems.length,
        details: {
          complete: missingDetailEntries === 0,
          missingEntries: missingDetailEntries,
        },
        sources: paginatedSources,
        entries: entryDetails.map(({ detailItems, ...entry }) => entry),
      });
    }

    return c.json({
      mode: 'since',
      available: history.length > 0,
      since: new Date(sinceMs).toISOString(),
      until: getMetadata().scrapedAt,
      refreshes: entries.length,
      summary,
      type,
      total: items.length,
      offset,
      limit,
      hasMore: offset + paginatedItems.length < items.length,
      details: {
        complete: missingDetailEntries === 0,
        missingEntries: missingDetailEntries,
      },
      items: paginatedItems,
      entries: entryDetails.map(({ detailItems, ...entry }) => entry),
    });
  }

  const increment = getLastRefreshIncrement();
  if (!increment) {
    return c.json({
      mode: 'latest',
      available: false,
      message: 'No incremental data available yet. Trigger /api/admin/refresh first.',
    });
  }

  const items = type === 'added' ? increment.added : type === 'removed' ? increment.removed : increment.updated;
  const paginatedItems = items.slice(offset, offset + limit);

  if (groupBySource) {
    const sourceItems = aggregateIncrementItemsBySource(items);
    const paginatedSources = sourceItems.slice(offset, offset + limit);

    return c.json({
      mode: 'latest',
      available: true,
      refresh: {
        previousScrapedAt: increment.previousScrapedAt,
        currentScrapedAt: increment.currentScrapedAt,
        recordedAt: increment.recordedAt,
      },
      summary: {
        added: increment.added.length,
        removed: increment.removed.length,
        updated: increment.updated.length,
      },
      type,
      groupBy: 'source',
      total: sourceItems.length,
      itemTotal: items.length,
      offset,
      limit,
      hasMore: offset + paginatedSources.length < sourceItems.length,
      sources: paginatedSources,
    });
  }

  return c.json({
    mode: 'latest',
    available: true,
    refresh: {
      previousScrapedAt: increment.previousScrapedAt,
      currentScrapedAt: increment.currentScrapedAt,
      recordedAt: increment.recordedAt,
    },
    summary: {
      added: increment.added.length,
      removed: increment.removed.length,
      updated: increment.updated.length,
    },
    type,
    total: items.length,
    offset,
    limit,
    hasMore: offset + paginatedItems.length < items.length,
    items: paginatedItems,
  });
});

/**
 * GET /api/skills/by-source/:owner/:repo
 * Get all skills from a specific repository
 */
skillsRouter.get('/by-source/:owner/:repo', c => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const source = `${owner}/${repo}`;

  const repoSkills = getSkills().filter(s => s.source === source);

  if (repoSkills.length === 0) {
    return c.json({ error: `No skills found for source "${source}"` }, 404);
  }

  return c.json({
    source,
    githubUrl: `https://github.com/${source}`,
    skills: repoSkills.sort((a, b) => b.installs - a.installs),
    total: repoSkills.length,
    totalInstalls: repoSkills.reduce((sum, s) => sum + s.installs, 0),
  });
});

/**
 * GET /api/skills/:skillId
 * Get a specific skill by ID
 * Note: skillId may not be unique across sources, returns first match
 */
skillsRouter.get('/:skillId', c => {
  const skillId = c.req.param('skillId');
  const skill = getSkills().find(s => s.skillId === skillId || s.name === skillId);

  if (!skill) {
    return c.json({ error: `Skill "${skillId}" not found` }, 404);
  }

  return c.json(skill);
});

/**
 * GET /api/skills/:owner/:repo/:skillId
 * Get a specific skill by source and ID
 */
skillsRouter.get('/:owner/:repo/:skillId', c => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const skillId = c.req.param('skillId');
  const source = `${owner}/${repo}`;

  const skill = getSkills().find(s => s.source === source && (s.skillId === skillId || s.name === skillId));

  if (!skill) {
    return c.json({ error: `Skill "${skillId}" not found in source "${source}"` }, 404);
  }

  // Include install command
  const installCommand = `npx skills add ${source}/${skillId}`;

  return c.json({
    ...skill,
    installCommand,
  });
});

/**
 * GET /api/skills/:owner/:repo/:skillId/files
 * Fetch all files in a skill's directory from GitHub
 * Returns file contents with appropriate encoding (utf-8 for text, base64 for binary)
 * Results are cached in S3 when configured
 */
skillsRouter.get('/:owner/:repo/:skillId/files', async c => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const skillId = c.req.param('skillId');
  const branch = c.req.query('branch') || 'main';

  // Check S3 cache first
  if (isS3Configured()) {
    const cached = await loadSkillFilesFromS3(owner, repo, skillId);
    if (cached) {
      return c.json(cached);
    }
  }

  // Fetch from GitHub
  const result = await fetchSkillFiles(owner, repo, skillId, branch);

  if (!result.success || !result.files) {
    return c.json({ error: result.error }, 404);
  }

  const response = {
    skillId,
    owner,
    repo,
    branch,
    files: result.files,
  };

  // Cache in S3 (fire and forget)
  if (isS3Configured()) {
    saveSkillFilesToS3(owner, repo, skillId, response).catch((err) =>
      console.error('[S3] Failed to cache skill files:', err),
    );
  }

  return c.json(response);
});

/**
 * GET /api/skills/:owner/:repo/:skillId/content
 * Fetch the full SKILL.md content from GitHub
 */
skillsRouter.get('/:owner/:repo/:skillId/content', async c => {
  const owner = c.req.param('owner');
  const repo = c.req.param('repo');
  const skillId = c.req.param('skillId');
  const branch = c.req.query('branch') || 'main';

  const result = await fetchSkillFromGitHub(owner, repo, skillId, branch);

  if (!result.success) {
    return c.json({ error: result.error }, 404);
  }

  return c.json({
    source: `${owner}/${repo}`,
    skillId,
    path: result.path,
    metadata: result.content?.metadata,
    instructions: result.content?.instructions,
    raw: result.content?.raw,
  });
});

export { skillsRouter };
