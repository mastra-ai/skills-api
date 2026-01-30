/**
 * Validation for scraped skills data
 * Ensures we don't overwrite good data with bad/empty data
 */

import type { ScrapedData } from '../registry/types.js';
import type { EnrichedSkill } from './scrape.js';
import { isS3Configured, loadValidationCacheFromS3, saveValidationCacheToS3 } from '../storage/s3.js';

/**
 * Cached validation result per repo.
 * Stores the actual directory names so we can filter without re-fetching.
 */
interface RepoCacheEntry {
  validatedAt: string;
  dirs: string[];
}

export type ValidationCache = Record<string, RepoCacheEntry>;

const VALIDATION_TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

export interface ValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  stats: {
    skillCount: number;
    sourceCount: number;
    ownerCount: number;
    avgInstalls: number;
  };
}

export interface ValidationOptions {
  /** Minimum number of skills required (default: 1000) */
  minSkillCount?: number;
  /** Minimum number of sources required (default: 100) */
  minSourceCount?: number;
  /** Maximum percentage drop from previous data allowed (default: 50%) */
  maxDropPercentage?: number;
  /** Previous data for comparison */
  previousData?: ScrapedData | null;
}

/**
 * Validate scraped skills data before saving
 */
export function validateScrapedData(
  skills: EnrichedSkill[],
  options: ValidationOptions = {}
): ValidationResult {
  const {
    minSkillCount = 1000,
    minSourceCount = 100,
    maxDropPercentage = 50,
    previousData,
  } = options;

  const errors: string[] = [];
  const warnings: string[] = [];

  // Calculate stats
  const sources = new Set(skills.map(s => s.source));
  const owners = new Set(skills.map(s => s.owner));
  const totalInstalls = skills.reduce((sum, s) => sum + s.installs, 0);
  const avgInstalls = skills.length > 0 ? totalInstalls / skills.length : 0;

  const stats = {
    skillCount: skills.length,
    sourceCount: sources.size,
    ownerCount: owners.size,
    avgInstalls: Math.round(avgInstalls),
  };

  // Check minimum skill count
  if (skills.length < minSkillCount) {
    errors.push(
      `Skill count (${skills.length}) below minimum threshold (${minSkillCount}). ` +
      `This likely indicates a scraping failure.`
    );
  }

  // Check minimum source count
  if (sources.size < minSourceCount) {
    errors.push(
      `Source count (${sources.size}) below minimum threshold (${minSourceCount}). ` +
      `This likely indicates incomplete data.`
    );
  }

  // Check for empty skills array
  if (skills.length === 0) {
    errors.push('No skills scraped. The page structure may have changed.');
  }

  // Validate skill structure (sample check)
  const sampleSize = Math.min(100, skills.length);
  let malformedCount = 0;
  
  for (let i = 0; i < sampleSize; i++) {
    const skill = skills[i];
    if (!skill || !skill.source || !skill.skillId || !skill.name) {
      malformedCount++;
    }
  }

  if (malformedCount > sampleSize * 0.1) {
    errors.push(
      `${malformedCount}/${sampleSize} sampled skills have missing required fields. ` +
      `Data structure may have changed.`
    );
  }

  // Compare with previous data if available
  if (previousData && previousData.skills.length > 0) {
    const dropPercentage = 
      ((previousData.skills.length - skills.length) / previousData.skills.length) * 100;

    if (dropPercentage > maxDropPercentage) {
      errors.push(
        `Skill count dropped by ${dropPercentage.toFixed(1)}% ` +
        `(${previousData.skills.length} → ${skills.length}). ` +
        `This exceeds the maximum allowed drop of ${maxDropPercentage}%.`
      );
    } else if (dropPercentage > 10) {
      warnings.push(
        `Skill count dropped by ${dropPercentage.toFixed(1)}% ` +
        `(${previousData.skills.length} → ${skills.length}).`
      );
    }

    // Check if install counts make sense (shouldn't drop dramatically)
    const prevTotalInstalls = previousData.skills.reduce((sum, s) => sum + s.installs, 0);
    if (totalInstalls < prevTotalInstalls * 0.5) {
      warnings.push(
        `Total installs dropped significantly. This may indicate data issues.`
      );
    }
  }

  // Check for suspicious patterns
  const uniqueNames = new Set(skills.map(s => s.name));
  if (uniqueNames.size < skills.length * 0.9) {
    warnings.push(
      `High duplicate name ratio detected (${uniqueNames.size} unique / ${skills.length} total).`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    stats,
  };
}

export interface FilterStaleResult {
  filtered: EnrichedSkill[];
  removed: number;
  removedSkills: Array<{ skillId: string; source: string }>;
  reposChecked: number;
  skipped: boolean;
}

/**
 * Filter stale skills by checking if they actually exist in their GitHub repos.
 * Groups skills by source repo, fetches the tree for each, and drops skills
 * whose skillId doesn't match any directory containing a SKILL.md.
 *
 * Only drops skills from repos where registry count > actual SKILL.md count,
 * so single-skill repos with mismatched names are never affected.
 *
 * Requires GITHUB_TOKEN env var for authenticated API access (5,000 req/hr).
 */
export async function filterStaleSkills(
  skills: EnrichedSkill[],
): Promise<FilterStaleResult> {
  const token = process.env.GITHUB_TOKEN;
  if (!token) {
    console.warn('[Validate] GITHUB_TOKEN not set, skipping stale skill filtering');
    return { filtered: skills, removed: 0, removedSkills: [], reposChecked: 0, skipped: true };
  }

  // Load validation cache from S3
  let cache: ValidationCache = {};
  if (isS3Configured()) {
    cache = (await loadValidationCacheFromS3()) || {};
  }

  const now = Date.now();

  // Group skills by source repo
  const byRepo = new Map<string, EnrichedSkill[]>();
  for (const skill of skills) {
    const existing = byRepo.get(skill.source) || [];
    existing.push(skill);
    byRepo.set(skill.source, existing);
  }

  // Split repos into cached (still valid) and needs-check
  const reposToCheck: Array<[string, EnrichedSkill[]]> = [];
  const cachedRepos: Array<[string, EnrichedSkill[]]> = [];

  for (const [source, repoSkills] of byRepo) {
    const cached = cache[source];
    if (cached && (now - new Date(cached.validatedAt).getTime()) < VALIDATION_TTL_MS) {
      cachedRepos.push([source, repoSkills]);
    } else {
      reposToCheck.push([source, repoSkills]);
    }
  }

  console.info(`[Validate] ${byRepo.size} repos total: ${cachedRepos.length} cached, ${reposToCheck.length} to check`);

  const kept: EnrichedSkill[] = [];
  const removedSkills: Array<{ skillId: string; source: string }> = [];
  let reposChecked = 0;
  let reposSkipped = 0;

  // Apply cached results for repos we've recently validated
  for (const [source, repoSkills] of cachedRepos) {
    const cachedDirs = new Set(cache[source].dirs);
    const { keptSkills, droppedSkills } = filterRepoSkills(source, repoSkills, cachedDirs);
    kept.push(...keptSkills);
    removedSkills.push(...droppedSkills);
  }

  // Fetch fresh data for repos that need checking
  const BATCH_SIZE = 10;

  for (let i = 0; i < reposToCheck.length; i += BATCH_SIZE) {
    const batch = reposToCheck.slice(i, i + BATCH_SIZE);

    const results = await Promise.all(
      batch.map(async ([source, repoSkills]) => {
        const [owner, repo] = source.split('/');
        const actualDirs = await fetchSkillDirs(owner, repo, token);

        // If we couldn't fetch the tree, keep all skills and don't cache
        if (actualDirs === null) {
          reposSkipped++;
          return { source, kept: repoSkills, removed: [] as Array<{ skillId: string; source: string }>, dirs: null };
        }

        reposChecked++;

        // Update cache with fresh data
        cache[source] = {
          validatedAt: new Date().toISOString(),
          dirs: Array.from(actualDirs),
        };

        const { keptSkills, droppedSkills } = filterRepoSkills(source, repoSkills, actualDirs);

        return { source, kept: keptSkills, removed: droppedSkills, dirs: actualDirs };
      }),
    );

    for (const result of results) {
      kept.push(...result.kept);
      removedSkills.push(...result.removed);
    }
  }

  // Save updated cache to S3
  if (isS3Configured()) {
    saveValidationCacheToS3(cache).catch((err) =>
      console.error('[Validate] Failed to save validation cache:', err),
    );
  }

  console.info(`[Validate] Repos checked: ${reposChecked}, cached: ${cachedRepos.length}, skipped: ${reposSkipped}`);

  if (removedSkills.length > 0) {
    console.info(`[Validate] Removed ${removedSkills.length} stale skills`);
  } else {
    console.info(`[Validate] No stale skills found`);
  }

  return { filtered: kept, removed: removedSkills.length, removedSkills, reposChecked, skipped: false };
}

/**
 * Filter skills for a single repo given its actual directory set.
 */
function filterRepoSkills(
  source: string,
  repoSkills: EnrichedSkill[],
  actualDirs: Set<string>,
): { keptSkills: EnrichedSkill[]; droppedSkills: Array<{ skillId: string; source: string }> } {
  if (actualDirs.size === 0) {
    return {
      keptSkills: [],
      droppedSkills: repoSkills.map((s) => ({ skillId: s.skillId, source: s.source })),
    };
  }

  if (actualDirs.size >= repoSkills.length) {
    return { keptSkills: repoSkills, droppedSkills: [] };
  }

  const matched: EnrichedSkill[] = [];
  const unmatched: EnrichedSkill[] = [];

  for (const skill of repoSkills) {
    if (actualDirs.has(skill.skillId) || actualDirs.has(skill.name)) {
      matched.push(skill);
    } else {
      unmatched.push(skill);
    }
  }

  if (unmatched.length > 0) {
    console.info(`[Validate] ${source}: registry=${repoSkills.length}, actual=${actualDirs.size}, dropping ${unmatched.map(s => s.skillId).join(', ')}`);
  }

  return {
    keptSkills: matched,
    droppedSkills: unmatched.map((s) => ({ skillId: s.skillId, source: s.source })),
  };
}

/**
 * Fetch the set of directory names that contain a SKILL.md in a GitHub repo.
 * Returns null if the tree couldn't be fetched (don't remove skills we can't verify).
 */
async function fetchSkillDirs(
  owner: string,
  repo: string,
  token: string,
): Promise<Set<string> | null> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/main?recursive=1`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        Authorization: `Bearer ${token}`,
        'User-Agent': 'skills-api',
      },
    });

    // Rate limited or error — don't remove skills we can't verify
    if (!response.ok) {
      if (response.status === 403 || response.status === 429) {
        console.warn(`[Validate] Rate limited fetching tree for ${owner}/${repo} (${response.status})`);
      }
      return null;
    }

    const tree = (await response.json()) as { tree: Array<{ path: string; type: string }> };
    const dirs = new Set<string>();

    for (const item of tree.tree) {
      if (item.type === 'blob' && item.path.endsWith('/SKILL.md')) {
        // Extract the immediate parent directory name
        const parentDir = item.path.slice(0, item.path.lastIndexOf('/'));
        const dirName = parentDir.split('/').pop();
        if (dirName) dirs.add(dirName);
      }
    }

    return dirs;
  } catch {
    return null;
  }
}

/**
 * Quick validation for emergency checks
 */
export function isDataUsable(skills: EnrichedSkill[]): boolean {
  // Absolute minimum - we need SOME data
  if (skills.length < 100) return false;
  
  // Check basic structure
  const sample = skills.slice(0, 10);
  return sample.every(s => s.source && s.skillId && s.name);
}
