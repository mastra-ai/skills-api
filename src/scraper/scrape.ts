/**
 * Skills.sh Scraper
 * Extracts skills data from the skills.sh website
 */

import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export interface ScrapedSkill {
  source: string;
  skillId: string;
  name: string;
  installs: number;
}

export interface EnrichedSkill extends ScrapedSkill {
  /** GitHub owner */
  owner: string;
  /** GitHub repo */
  repo: string;
  /** Full GitHub URL */
  githubUrl: string;
  /** Display name (formatted from name) */
  displayName: string;
}

interface AllTimeSkillsPage {
  skills: ScrapedSkill[];
  total: number | null;
  hasMore: boolean | null;
  page: number | null;
}

const SKILLS_BASE_URL = 'https://skills.sh';
const ALL_TIME_API_BASE = `${SKILLS_BASE_URL}/api/skills/all-time`;

interface ScraperConfig {
  maxAllTimePages: number;
  pageConcurrency: number;
  batchDelayMs: number;
  requestTimeoutMs: number;
  maxRetries: number;
  retryBaseMs: number;
  minCoverageRatio: number;
  allowHtmlFallback: boolean;
}

function parseIntEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseFloatEnv(name: string, fallback: number, min: number, max: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseFloat(raw);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function parseBoolEnv(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (!raw) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(raw.toLowerCase());
}

function getScraperConfig(): ScraperConfig {
  return {
    maxAllTimePages: parseIntEnv('SCRAPER_MAX_ALL_TIME_PAGES', 1000, 10, 5000),
    pageConcurrency: parseIntEnv('SCRAPER_API_PAGE_CONCURRENCY', 4, 1, 20),
    batchDelayMs: parseIntEnv('SCRAPER_API_BATCH_DELAY_MS', 300, 0, 10000),
    requestTimeoutMs: parseIntEnv('SCRAPER_API_TIMEOUT_MS', 15000, 1000, 120000),
    maxRetries: parseIntEnv('SCRAPER_API_MAX_RETRIES', 4, 1, 10),
    retryBaseMs: parseIntEnv('SCRAPER_API_RETRY_BASE_MS', 1000, 100, 30000),
    minCoverageRatio: parseFloatEnv('SCRAPER_API_MIN_COVERAGE_RATIO', 0.95, 0.5, 1),
    allowHtmlFallback: parseBoolEnv('SCRAPER_ALLOW_HTML_FALLBACK', false),
  };
}

/**
 * Scrape skills from skills.sh
 */
export async function scrapeSkills(): Promise<ScrapedSkill[]> {
  const config = getScraperConfig();

  try {
    return await scrapeSkillsFromAllTimeApi(config);
  } catch (apiError) {
    const message = apiError instanceof Error ? apiError.message : String(apiError);
    if (!config.allowHtmlFallback) {
      throw new Error(
        `All-time API scrape failed: ${message}. ` +
          `HTML fallback is disabled (set SCRAPER_ALLOW_HTML_FALLBACK=true to enable emergency fallback).`,
      );
    }

    console.warn(`[Scraper] All-time API scrape failed, using emergency HTML fallback: ${message}`);
    return scrapeSkillsFromPage(config);
  }
}

async function scrapeSkillsFromAllTimeApi(config: ScraperConfig): Promise<ScrapedSkill[]> {
  const firstPage = await fetchAllTimeSkillsPage(0, config);
  if (firstPage.skills.length === 0) {
    throw new Error('All-time API returned no skills on page 0');
  }

  const allSkills = [...firstPage.skills];
  const totalPages = getTotalPages(firstPage, config);

  if (totalPages !== null) {
    if (totalPages > config.maxAllTimePages) {
      throw new Error(`All-time API requires ${totalPages} pages, exceeding max ${config.maxAllTimePages}`);
    }

    const remainingPages = Array.from({ length: Math.max(0, totalPages - 1) }, (_, index) => index + 1);
    for (let i = 0; i < remainingPages.length; i += config.pageConcurrency) {
      const batch = remainingPages.slice(i, i + config.pageConcurrency);
      const pageResults = await Promise.all(batch.map(page => fetchAllTimeSkillsPage(page, config)));
      for (const result of pageResults) {
        allSkills.push(...result.skills);
      }

      if (i + config.pageConcurrency < remainingPages.length && config.batchDelayMs > 0) {
        await sleep(config.batchDelayMs);
      }
    }

    const deduped = dedupeSkills(allSkills);
    assertCoverage(deduped, firstPage.total, config.minCoverageRatio);
    return deduped;
  }

  // Fallback path if total is missing: follow hasMore until exhaustion.
  let page = 1;
  let hasMore = firstPage.hasMore ?? true;
  while (hasMore) {
    if (page >= config.maxAllTimePages) {
      throw new Error(`All-time API pagination exceeded ${config.maxAllTimePages} pages`);
    }

    const nextPage = await fetchAllTimeSkillsPage(page, config);
    if (nextPage.skills.length === 0) {
      break;
    }

    allSkills.push(...nextPage.skills);
    hasMore = nextPage.hasMore ?? false;
    page += 1;

    if (hasMore && config.batchDelayMs > 0) {
      await sleep(config.batchDelayMs);
    }
  }

  const deduped = dedupeSkills(allSkills);
  assertCoverage(deduped, firstPage.total, config.minCoverageRatio);
  return deduped;
}

function getRetryDelayMs(attempt: number, baseMs: number): number {
  const jitter = Math.floor(Math.random() * 250);
  return baseMs * 2 ** Math.max(0, attempt - 1) + jitter;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

function assertCoverage(skills: ScrapedSkill[], total: number | null, minCoverageRatio: number): void {
  if (total === null || total <= 0) return;
  const coverage = skills.length / total;
  if (coverage < minCoverageRatio) {
    throw new Error(
      `All-time API returned incomplete dataset (${skills.length}/${total}, ${(coverage * 100).toFixed(1)}% coverage)`,
    );
  }
}

async function scrapeSkillsFromPage(config: ScraperConfig): Promise<ScrapedSkill[]> {
  const response = await fetch(SKILLS_BASE_URL);
  if (!response.ok) {
    throw new Error(`Failed to load skills.sh page (${response.status})`);
  }

  const html = await response.text();
  const extracted = extractSkillsFromPageHtml(html);
  console.warn(
    `[Scraper] Emergency HTML fallback returned ${extracted.length} skills. ` +
      `For full data, fix all-time API connectivity and disable fallback in production.`,
  );
  if (config.minCoverageRatio >= 1 && extracted.length === 0) {
    throw new Error('Emergency HTML fallback returned no skills');
  }
  return extracted;
}

async function fetchAllTimeSkillsPage(page: number, config: ScraperConfig): Promise<AllTimeSkillsPage> {
  const url = `${ALL_TIME_API_BASE}/${page}`;
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= config.maxRetries; attempt++) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.requestTimeoutMs);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          accept: 'application/json',
        },
      });
      clearTimeout(timeout);

      if (!response.ok) {
        const retryable = response.status === 429 || response.status >= 500;
        const message = `All-time API request failed for page ${page} (${response.status})`;
        if (!retryable) {
          throw new Error(`${message}, non-retryable`);
        }
        throw new Error(message);
      }

      const payload = (await response.json()) as Record<string, unknown>;
      const skills = toScrapedSkills(payload.skills);
      const total = typeof payload.total === 'number' ? payload.total : null;
      const hasMore = typeof payload.hasMore === 'boolean' ? payload.hasMore : null;
      const pageFromPayload = typeof payload.page === 'number' ? payload.page : null;

      return {
        skills,
        total,
        hasMore,
        page: pageFromPayload,
      };
    } catch (error) {
      clearTimeout(timeout);
      const err = toError(error);
      lastError = err;

      if (err.message.includes('non-retryable')) {
        throw err;
      }

      if (attempt < config.maxRetries) {
        const delay = getRetryDelayMs(attempt, config.retryBaseMs);
        console.warn(
          `[Scraper] API page ${page} attempt ${attempt}/${config.maxRetries} failed: ${err.message}. Retrying in ${delay}ms`,
        );
        await sleep(delay);
        continue;
      }
    }
  }

  throw new Error(
    `All-time API request failed for page ${page} after ${config.maxRetries} attempts: ${lastError?.message ?? 'unknown error'}`,
  );
}

function getTotalPages(page: AllTimeSkillsPage, config: ScraperConfig): number | null {
  if (page.total === null || page.total <= 0) {
    return null;
  }

  const pageSize = page.skills.length;
  if (pageSize <= 0) {
    return null;
  }

  const totalPages = Math.ceil(page.total / pageSize);
  if (totalPages > config.maxAllTimePages) {
    throw new Error(`All-time API requires ${totalPages} pages, exceeding max ${config.maxAllTimePages}`);
  }
  return totalPages;
}

function extractSkillsFromPageHtml(html: string): ScrapedSkill[] {
  for (const key of ['allTimeSkills', 'initialSkills']) {
    const parsed = tryExtractEscapedArrayByKey(html, key);
    if (parsed !== null) {
      return parsed;
    }
  }

  throw new Error('Could not find allTimeSkills or initialSkills in page');
}

function tryExtractEscapedArrayByKey(html: string, key: string): ScrapedSkill[] | null {
  const escapedKey = escapeRegExp(key);
  const candidates = [
    {
      regex: new RegExp(`${escapedKey}\\\\":\\[([\\s\\S]*?)\\]`),
      unescape: true,
    },
    {
      regex: new RegExp(`"${escapedKey}":\\[([\\s\\S]*?)\\]`),
      unescape: false,
    },
  ];

  for (const candidate of candidates) {
    const match = html.match(candidate.regex);
    if (!match) {
      continue;
    }

    let jsonStr = `[${match[1]}]`;
    if (candidate.unescape) {
      jsonStr = jsonStr.replace(/\\"/g, '"');
    }

    try {
      const parsed = JSON.parse(jsonStr);
      return toScrapedSkills(parsed);
    } catch {
      continue;
    }
  }

  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function toScrapedSkills(value: unknown): ScrapedSkill[] {
  if (!Array.isArray(value)) {
    throw new Error('Expected skills to be an array');
  }

  return value.map((entry, index) => {
    if (!entry || typeof entry !== 'object') {
      throw new Error(`Invalid skill at index ${index}: expected object`);
    }

    const source = (entry as { source?: unknown }).source;
    const skillId = (entry as { skillId?: unknown }).skillId;
    const name = (entry as { name?: unknown }).name;
    const installsRaw = (entry as { installs?: unknown }).installs;
    const installs =
      typeof installsRaw === 'number'
        ? installsRaw
        : typeof installsRaw === 'string'
          ? Number.parseInt(installsRaw, 10)
          : Number.NaN;

    if (
      typeof source !== 'string' ||
      typeof skillId !== 'string' ||
      typeof name !== 'string' ||
      !Number.isFinite(installs)
    ) {
      throw new Error(`Invalid skill at index ${index}: malformed fields`);
    }

    return {
      source,
      skillId,
      name,
      installs,
    };
  });
}

function dedupeSkills(skills: ScrapedSkill[]): ScrapedSkill[] {
  const deduped = new Map<string, ScrapedSkill>();
  for (const skill of skills) {
    deduped.set(`${skill.source}::${skill.skillId}`, skill);
  }

  return Array.from(deduped.values());
}

/**
 * Enrich skills with additional computed fields
 */
export function enrichSkills(skills: ScrapedSkill[]): EnrichedSkill[] {
  return skills.map(skill => {
    const parts = skill.source.split('/');
    const owner = parts[0] ?? '';
    const repo = parts[1] ?? '';
    return {
      ...skill,
      owner,
      repo,
      githubUrl: `https://github.com/${skill.source}`,
      displayName: formatDisplayName(skill.name),
    };
  });
}

/**
 * Format skill name as display name
 */
function formatDisplayName(name: string): string {
  return name
    .split('-')
    .map(word => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');
}

/**
 * Get unique sources (repositories) from skills
 */
export function getUniqueSources(skills: ScrapedSkill[]): string[] {
  const sources = new Set<string>();
  for (const skill of skills) {
    sources.add(skill.source);
  }
  return Array.from(sources).sort();
}

/**
 * Get unique owners from skills
 */
export function getUniqueOwners(skills: ScrapedSkill[]): string[] {
  const owners = new Set<string>();
  for (const skill of skills) {
    const owner = skill.source.split('/')[0];
    if (owner) {
      owners.add(owner);
    }
  }
  return Array.from(owners).sort();
}

/**
 * Main scraper function - scrapes and saves to JSON file
 */
export async function scrapeAndSave(outputPath?: string): Promise<void> {
  console.info('Scraping skills from skills.sh...');

  const scrapedSkills = await scrapeSkills();
  console.info(`Found ${scrapedSkills.length} skills`);

  const enriched = enrichSkills(scrapedSkills);

  const output = {
    scrapedAt: new Date().toISOString(),
    totalSkills: enriched.length,
    totalSources: getUniqueSources(scrapedSkills).length,
    totalOwners: getUniqueOwners(scrapedSkills).length,
    skills: enriched,
  };

  const defaultPath = join(__dirname, '..', 'registry', 'scraped-skills.json');
  const filePath = outputPath ?? defaultPath;
  writeFileSync(filePath, JSON.stringify(output, null, 2));
  console.info(`Saved to ${filePath}`);
}

// Run if called directly
if (import.meta.url === `file://${process.argv[1]}`) {
  scrapeAndSave().catch(console.error);
}
