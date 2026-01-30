/**
 * Skills Registry Data
 * Loaded from scraped skills.sh data with support for dynamic reloading
 */

import { loadSkillsData, loadSkillsDataAsync } from '../storage/index.js';
import type { RegistrySkill, ScrapedData, Source } from './types.js';

// Cache for skills data
let cachedData: ScrapedData | null = null;

// Cached aggregation results (invalidated on reload)
let cachedSources: Source[] | null = null;
let cachedOwners: Array<{ owner: string; skillCount: number; totalInstalls: number }> | null = null;
let cachedTopSkills: Map<number, RegistrySkill[]> = new Map();

function clearAggregationCaches(): void {
  cachedSources = null;
  cachedOwners = null;
  cachedTopSkills = new Map();
}

/**
 * Get the current scraped data, loading if necessary
 */
function getData(): ScrapedData {
  if (!cachedData) {
    cachedData = loadSkillsData();
  }
  return cachedData;
}

/**
 * Reload data from storage (called after refresh)
 */
export function reloadData(): void {
  cachedData = loadSkillsData();
  clearAggregationCaches();
}

/**
 * Reload data from storage async (supports S3)
 */
export async function reloadDataAsync(): Promise<void> {
  cachedData = await loadSkillsDataAsync();
  clearAggregationCaches();
}

/**
 * Initialize data async (for startup with S3)
 */
export async function initializeData(): Promise<void> {
  if (!cachedData) {
    cachedData = await loadSkillsDataAsync();
  }
}

/**
 * All skills from the registry
 */
export function getSkills(): RegistrySkill[] {
  return getData().skills;
}

/**
 * Legacy export for backwards compatibility
 */
export const skills: RegistrySkill[] = new Proxy([] as RegistrySkill[], {
  get(_, prop) {
    const data = getSkills();
    if (prop === 'length') return data.length;
    if (typeof prop === 'string' && !isNaN(Number(prop))) {
      return data[Number(prop)];
    }
    if (prop === Symbol.iterator) {
      return data[Symbol.iterator].bind(data);
    }
    // @ts-expect-error - dynamic property access
    return typeof data[prop] === 'function' ? data[prop].bind(data) : data[prop];
  },
});

/**
 * Metadata about when the data was scraped
 */
export function getMetadata() {
  const data = getData();
  return {
    scrapedAt: data.scrapedAt,
    totalSkills: data.totalSkills,
    totalSources: data.totalSources,
    totalOwners: data.totalOwners,
  };
}

/**
 * Legacy export for backwards compatibility
 */
export const metadata = new Proxy({} as ReturnType<typeof getMetadata>, {
  get(_, prop) {
    return getMetadata()[prop as keyof ReturnType<typeof getMetadata>];
  },
});

/**
 * Get all unique sources (repositories) with counts
 */
export function getSources(): Source[] {
  if (cachedSources) return cachedSources;

  const sourceMap = new Map<string, Source>();
  const skillsData = getSkills();

  for (const skill of skillsData) {
    const existing = sourceMap.get(skill.source);
    if (existing) {
      existing.skillCount++;
      existing.totalInstalls += skill.installs;
    } else {
      sourceMap.set(skill.source, {
        source: skill.source,
        owner: skill.owner,
        repo: skill.repo,
        skillCount: 1,
        totalInstalls: skill.installs,
      });
    }
  }

  cachedSources = Array.from(sourceMap.values()).sort((a, b) => b.totalInstalls - a.totalInstalls);
  return cachedSources;
}

/**
 * Get all unique owners with counts
 */
export function getOwners(): Array<{ owner: string; skillCount: number; totalInstalls: number }> {
  if (cachedOwners) return cachedOwners;

  const ownerMap = new Map<string, { owner: string; skillCount: number; totalInstalls: number }>();
  const skillsData = getSkills();

  for (const skill of skillsData) {
    const existing = ownerMap.get(skill.owner);
    if (existing) {
      existing.skillCount++;
      existing.totalInstalls += skill.installs;
    } else {
      ownerMap.set(skill.owner, {
        owner: skill.owner,
        skillCount: 1,
        totalInstalls: skill.installs,
      });
    }
  }

  cachedOwners = Array.from(ownerMap.values()).sort((a, b) => b.totalInstalls - a.totalInstalls);
  return cachedOwners;
}

/**
 * Get top skills by installs
 */
export function getTopSkills(limit = 100): RegistrySkill[] {
  const cached = cachedTopSkills.get(limit);
  if (cached) return cached;

  const result = [...getSkills()].sort((a, b) => b.installs - a.installs).slice(0, limit);
  cachedTopSkills.set(limit, result);
  return result;
}

/**
 * Get top sources by total installs
 */
export function getTopSources(limit = 50): Source[] {
  return getSources().slice(0, limit);
}
