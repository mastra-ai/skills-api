import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { scrapeSkills } from './scrape.js';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('scrapeSkills robustness', () => {
  const fetchMock = vi.fn<typeof fetch>();
  const originalEnv = { ...process.env };

  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal('fetch', fetchMock);
    process.env = { ...originalEnv };
    delete process.env.SCRAPER_ALLOW_HTML_FALLBACK;
    delete process.env.SCRAPER_API_PAGE_CONCURRENCY;
    delete process.env.SCRAPER_API_BATCH_DELAY_MS;
    delete process.env.SCRAPER_API_MAX_RETRIES;
    delete process.env.SCRAPER_API_RETRY_BASE_MS;
    delete process.env.SCRAPER_API_TIMEOUT_MS;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    process.env = { ...originalEnv };
  });

  it('throws when all-time API fails and HTML fallback is disabled', async () => {
    process.env.SCRAPER_API_MAX_RETRIES = '1';
    fetchMock.mockRejectedValueOnce(new Error('network down'));

    await expect(scrapeSkills()).rejects.toThrow(/HTML fallback is disabled/i);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      'https://skills.sh/api/skills/all-time/0',
      expect.objectContaining({
        headers: expect.objectContaining({ accept: 'application/json' }),
      }),
    );
  });

  it('uses HTML fallback only when explicitly enabled', async () => {
    process.env.SCRAPER_ALLOW_HTML_FALLBACK = 'true';
    process.env.SCRAPER_API_MAX_RETRIES = '1';

    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const escapedSkill =
      '{\\"source\\":\\"fallback/repo\\",\\"skillId\\":\\"fallback\\",\\"name\\":\\"fallback\\",\\"installs\\":42}';
    const html = `<html><body><script>self.__next_f.push([1,"14:[{\\"initialSkills\\":[${escapedSkill}]}]"])</script></body></html>`;

    fetchMock
      .mockRejectedValueOnce(new Error('all-time api blocked'))
      .mockResolvedValueOnce(new Response(html, { status: 200 }));

    const skills = await scrapeSkills();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://skills.sh/api/skills/all-time/0', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://skills.sh');
    expect(skills).toHaveLength(1);
    expect(skills[0]?.skillId).toBe('fallback');
    expect(warnSpy).toHaveBeenCalled();
  });

  it('fetches paginated all-time API data and merges pages', async () => {
    process.env.SCRAPER_API_PAGE_CONCURRENCY = '1';
    process.env.SCRAPER_API_BATCH_DELAY_MS = '0';
    process.env.SCRAPER_API_MAX_RETRIES = '1';

    fetchMock
      .mockResolvedValueOnce(
        jsonResponse({
          skills: [
            { source: 'owner/repo', skillId: 'one', name: 'one', installs: 30 },
            { source: 'owner/repo', skillId: 'two', name: 'two', installs: 20 },
          ],
          total: 3,
          hasMore: true,
          page: 0,
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          skills: [{ source: 'owner/repo', skillId: 'three', name: 'three', installs: 10 }],
          total: 3,
          hasMore: false,
          page: 1,
        }),
      );

    const skills = await scrapeSkills();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock).toHaveBeenNthCalledWith(1, 'https://skills.sh/api/skills/all-time/0', expect.any(Object));
    expect(fetchMock).toHaveBeenNthCalledWith(2, 'https://skills.sh/api/skills/all-time/1', expect.any(Object));
    expect(skills.map(skill => skill.skillId)).toEqual(['one', 'two', 'three']);
  });
});
