/**
 * Fetch skill content from GitHub
 */

import matter from 'gray-matter';

export interface SkillContent {
  /** Raw SKILL.md content */
  raw: string;
  /** Parsed frontmatter metadata */
  metadata: {
    name: string;
    description: string;
    license?: string;
    version?: string;
    author?: string;
    [key: string]: unknown;
  };
  /** Markdown instructions (body without frontmatter) */
  instructions: string;
}

export interface FetchSkillResult {
  success: boolean;
  content?: SkillContent;
  error?: string;
  /** The path where the SKILL.md was found */
  path?: string;
}

/**
 * Common paths where skills might be located in a repo
 */
const SKILL_PATH_PATTERNS = [
  'skills/{skillId}/SKILL.md',
  '{skillId}/SKILL.md',
  '.skills/{skillId}/SKILL.md',
  'agent-skills/{skillId}/SKILL.md',
];

/**
 * Fetch a skill's SKILL.md content from GitHub
 */
export async function fetchSkillFromGitHub(
  owner: string,
  repo: string,
  skillId: string,
  branch = 'main',
): Promise<FetchSkillResult> {
  // Try each path pattern
  for (const pattern of SKILL_PATH_PATTERNS) {
    const path = pattern.replace('{skillId}', skillId);
    const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

    try {
      const response = await fetch(url);

      if (response.ok) {
        const raw = await response.text();

        // Parse frontmatter
        const parsed = matter(raw);
        const metadata = parsed.data as SkillContent['metadata'];
        const instructions = parsed.content.trim();

        return {
          success: true,
          content: {
            raw,
            metadata,
            instructions,
          },
          path,
        };
      }
    } catch {
      // Try next pattern
      continue;
    }
  }

  // If skill name differs from skillId (e.g., vercel-react-best-practices vs react-best-practices)
  // Try without prefix
  const simplifiedSkillId = skillId.replace(/^[a-z]+-/, '');
  if (simplifiedSkillId !== skillId) {
    for (const pattern of SKILL_PATH_PATTERNS) {
      const path = pattern.replace('{skillId}', simplifiedSkillId);
      const url = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path}`;

      try {
        const response = await fetch(url);

        if (response.ok) {
          const raw = await response.text();
          const parsed = matter(raw);
          const metadata = parsed.data as SkillContent['metadata'];
          const instructions = parsed.content.trim();

          return {
            success: true,
            content: {
              raw,
              metadata,
              instructions,
            },
            path,
          };
        }
      } catch {
        continue;
      }
    }
  }

  // Fallback: search the repo tree for any SKILL.md files
  const treeResult = await findSkillInTree(owner, repo, branch);
  if (treeResult) {
    return treeResult;
  }

  return {
    success: false,
    error: `Could not find SKILL.md for ${skillId} in ${owner}/${repo}`,
  };
}

/**
 * Search the repo tree for SKILL.md files as a fallback
 * when the skillId doesn't match the directory name
 */
async function findSkillInTree(
  owner: string,
  repo: string,
  branch: string,
): Promise<FetchSkillResult | null> {
  try {
    const url = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const response = await fetch(url, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'skills-api',
      },
    });

    if (!response.ok) return null;

    const tree = (await response.json()) as { tree: Array<{ path: string; type: string }> };
    const skillFiles = tree.tree.filter(
      (item) => item.type === 'blob' && item.path.endsWith('/SKILL.md'),
    );

    if (skillFiles.length === 0) return null;

    // Fetch the first SKILL.md found
    const skillPath = skillFiles[0].path;
    const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${skillPath}`;
    const rawResponse = await fetch(rawUrl);

    if (!rawResponse.ok) return null;

    const raw = await rawResponse.text();
    const parsed = matter(raw);
    const metadata = parsed.data as SkillContent['metadata'];
    const instructions = parsed.content.trim();

    return {
      success: true,
      content: { raw, metadata, instructions },
      path: skillPath,
    };
  } catch {
    return null;
  }
}

export interface SkillFile {
  path: string;
  content: string;
  encoding: 'utf-8' | 'base64';
}

export interface FetchSkillFilesResult {
  success: boolean;
  files?: SkillFile[];
  error?: string;
}

const TEXT_EXTENSIONS = new Set([
  '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.js', '.ts', '.py',
  '.jsx', '.tsx', '.css', '.html', '.xml', '.csv', '.sh', '.env', '.cfg',
  '.ini', '.conf', '.mjs', '.cjs', '.mts', '.cts', '.svelte', '.vue',
  '.rb', '.go', '.rs', '.java', '.kt', '.swift', '.c', '.cpp', '.h',
  '.lock', '.gitignore', '.editorconfig', '.prettierrc',
]);

function isTextFile(filePath: string): boolean {
  const lower = filePath.toLowerCase();
  // Files without extensions that are commonly text
  const basename = lower.split('/').pop() || '';
  if (['license', 'readme', 'changelog', 'makefile', 'dockerfile'].includes(basename)) {
    return true;
  }
  const dotIdx = basename.lastIndexOf('.');
  if (dotIdx === -1) return false;
  return TEXT_EXTENSIONS.has(basename.slice(dotIdx));
}

/**
 * Fetch all files in a skill's directory from GitHub
 */
export async function fetchSkillFiles(
  owner: string,
  repo: string,
  skillId: string,
  branch = 'main',
): Promise<FetchSkillFilesResult> {
  try {
    // Get the full repo tree
    const treeUrl = `https://api.github.com/repos/${owner}/${repo}/git/trees/${branch}?recursive=1`;
    const treeResponse = await fetch(treeUrl, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'skills-api',
      },
    });

    if (!treeResponse.ok) {
      return { success: false, error: `Failed to fetch repo tree for ${owner}/${repo}` };
    }

    const tree = (await treeResponse.json()) as { tree: Array<{ path: string; type: string }> };

    // Find the skill directory by locating its SKILL.md
    const skillDir = findSkillDir(tree.tree, skillId);
    if (!skillDir) {
      return { success: false, error: `Could not find skill "${skillId}" in ${owner}/${repo}` };
    }

    // Get all files under the skill directory
    const dirPrefix = skillDir + '/';
    const fileEntries = tree.tree.filter(
      (item) => item.type === 'blob' && item.path.startsWith(dirPrefix),
    );

    // Fetch all file contents in parallel
    const files = await Promise.all(
      fileEntries.map(async (entry): Promise<SkillFile> => {
        const rawUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${entry.path}`;
        const relativePath = entry.path.slice(dirPrefix.length);

        const response = await fetch(rawUrl);
        if (!response.ok) {
          return { path: relativePath, content: '', encoding: 'utf-8' };
        }

        if (isTextFile(entry.path)) {
          const text = await response.text();
          return { path: relativePath, content: text, encoding: 'utf-8' };
        } else {
          const buffer = await response.arrayBuffer();
          const base64 = Buffer.from(buffer).toString('base64');
          return { path: relativePath, content: base64, encoding: 'base64' };
        }
      }),
    );

    return { success: true, files };
  } catch (error) {
    const err = error as { message?: string };
    return { success: false, error: err.message || 'Unknown error fetching skill files' };
  }
}

/**
 * Find the skill directory path in the repo tree.
 * Tries exact skillId match, simplified name, then falls back to first SKILL.md found.
 */
function findSkillDir(
  tree: Array<{ path: string; type: string }>,
  skillId: string,
): string | null {
  const skillMdFiles = tree.filter(
    (item) => item.type === 'blob' && item.path.endsWith('/SKILL.md'),
  );

  if (skillMdFiles.length === 0) return null;

  // Try exact match: any path where the parent directory is the skillId
  for (const file of skillMdFiles) {
    const dir = file.path.slice(0, file.path.lastIndexOf('/'));
    const dirName = dir.split('/').pop();
    if (dirName === skillId) return dir;
  }

  // Try simplified skillId (strip first prefix segment)
  const simplified = skillId.replace(/^[a-z]+-/, '');
  if (simplified !== skillId) {
    for (const file of skillMdFiles) {
      const dir = file.path.slice(0, file.path.lastIndexOf('/'));
      const dirName = dir.split('/').pop();
      if (dirName === simplified) return dir;
    }
  }

  // Fallback: return the first skill directory found
  const firstPath = skillMdFiles[0].path;
  return firstPath.slice(0, firstPath.lastIndexOf('/'));
}

/**
 * List all skills in a GitHub repository
 */
export async function listSkillsInRepo(
  owner: string,
  repo: string,
  branch = 'main',
): Promise<{ skills: string[]; path: string } | null> {
  const SKILLS_DIRS = ['skills', '.skills', 'agent-skills', ''];

  for (const dir of SKILLS_DIRS) {
    const path = dir ? `${dir}` : '';
    const url = `https://api.github.com/repos/${owner}/${repo}/contents/${path}?ref=${branch}`;

    try {
      const response = await fetch(url, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'skills-api',
        },
      });

      if (!response.ok) continue;

      const items = (await response.json()) as Array<{ name: string; type: string }>;
      const directories = items.filter(item => item.type === 'dir').map(item => item.name);

      // Check if any directory contains a SKILL.md
      const skillDirs: string[] = [];
      for (const dirName of directories.slice(0, 20)) {
        // Limit to first 20 to avoid rate limiting
        const skillUrl = `https://raw.githubusercontent.com/${owner}/${repo}/${branch}/${path ? path + '/' : ''}${dirName}/SKILL.md`;
        try {
          const skillResponse = await fetch(skillUrl, { method: 'HEAD' });
          if (skillResponse.ok) {
            skillDirs.push(dirName);
          }
        } catch {
          continue;
        }
      }

      if (skillDirs.length > 0) {
        return { skills: skillDirs, path };
      }
    } catch {
      continue;
    }
  }

  return null;
}
