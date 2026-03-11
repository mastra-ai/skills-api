/**
 * Types for the Skills Registry API
 * Following the Agent Skills specification: https://agentskills.io
 */

/**
 * Skill data scraped from skills.sh
 */
export interface RegistrySkill {
  /** Source repository (owner/repo) */
  source: string;
  /** Unique skill identifier within the repository */
  skillId: string;
  /** Skill name (directory name) */
  name: string;
  /** Install count */
  installs: number;
  /** GitHub owner */
  owner: string;
  /** GitHub repo name */
  repo: string;
  /** Full GitHub URL */
  githubUrl: string;
  /** Human-readable display name */
  displayName: string;
}

/**
 * Skill update delta between two refreshes
 */
export interface IncrementalSkillUpdate extends RegistrySkill {
  previousInstalls: number;
  currentInstalls: number;
  installDelta: number;
}

/**
 * Scraped data file structure
 */
export interface ScrapedData {
  scrapedAt: string;
  totalSkills: number;
  totalSources: number;
  totalOwners: number;
  skills: RegistrySkill[];
}

/**
 * Paginated response for skill listings
 */
export interface PaginatedSkillsResponse {
  skills: RegistrySkill[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

/**
 * Search parameters for skills
 */
export interface SkillSearchParams {
  /** Search query string */
  query?: string;
  /** Filter by owner */
  owner?: string;
  /** Filter by repository */
  repo?: string;
  /** Sort field */
  sortBy?: 'name' | 'installs';
  /** Sort order */
  sortOrder?: 'asc' | 'desc';
  /** Page number (1-indexed) */
  page?: number;
  /** Items per page */
  pageSize?: number;
}

/**
 * Source (repository) with skill counts
 */
export interface Source {
  /** GitHub path (owner/repo) */
  source: string;
  /** GitHub owner */
  owner: string;
  /** Repository name */
  repo: string;
  /** Full GitHub URL */
  githubUrl: string;
  /** Number of skills in this repo */
  skillCount: number;
  /** Total installs across all skills */
  totalInstalls: number;
}

/**
 * Refresh history entry used for "since" incremental summaries
 */
export interface RefreshHistoryEntry {
  recordedAt: string;
  previousScrapedAt: string | null;
  currentScrapedAt: string;
  added: number;
  removed: number;
  updated: number;
  /**
   * Optional detail payload for since-based incremental data queries.
   * Older history entries may not contain these fields.
   */
  addedItems?: RegistrySkill[];
  removedItems?: RegistrySkill[];
  updatedItems?: IncrementalSkillUpdate[];
}
