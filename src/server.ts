/**
 * Skills.sh API Server
 * A marketplace API for Agent Skills
 */

import { Hono } from 'hono';
import { compress } from 'hono/compress';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import { prettyJSON } from 'hono/pretty-json';

import { renderIndexPage } from './pages/index.js';
import { getMetadata, getSkills, getTopSkills } from './registry/index.js';
import { adminRouter } from './routes/admin.js';
import { skillsRouter } from './routes/index.js';
import { startRefreshScheduler } from './scheduler/index.js';

export interface SkillsApiServerOptions {
  /**
   * Enable CORS
   * @default true
   */
  cors?: boolean;
  /**
   * CORS origin
   * @default '*'
   */
  corsOrigin?: string | string[];
  /**
   * Enable request logging
   * @default true
   */
  logging?: boolean;
  /**
   * API prefix
   * @default '/api'
   */
  prefix?: string;
  /**
   * Enable admin routes for refresh/scheduler control
   * @default true
   */
  enableAdmin?: boolean;
  /**
   * Auto-start the refresh scheduler
   * @default false
   */
  autoRefresh?: boolean;
  /**
   * Refresh interval in minutes (if autoRefresh is enabled)
   * @default 30
   */
  refreshIntervalMinutes?: number;
}

/**
 * Create the Skills API server
 */
export function createSkillsApiServer(options: SkillsApiServerOptions = {}): Hono {
  const {
    cors: enableCors = true,
    corsOrigin = '*',
    logging = true,
    prefix = '/api',
    enableAdmin = true,
    autoRefresh = false,
    refreshIntervalMinutes = 30,
  } = options;

  const app = new Hono();

  // Middleware
  if (enableCors) {
    app.use(
      '*',
      cors({
        origin: corsOrigin,
        allowMethods: ['GET', 'OPTIONS'],
        allowHeaders: ['Content-Type', 'Authorization'],
        maxAge: 86400,
      }),
    );
  }

  if (logging) {
    app.use('*', logger());
  }

  app.use('*', prettyJSON());
  app.use('*', compress());

  // Cache headers
  app.use(`${prefix}/skills/*`, async (c, next) => {
    await next();

    const path = c.req.path;

    // GitHub-fetched content gets a longer cache (already S3-cached server-side)
    if (path.endsWith('/files') || path.endsWith('/content')) {
      c.header('Cache-Control', 'public, max-age=3600, stale-while-revalidate=60');
      return;
    }

    // All other skills API routes: cache with ETag based on data freshness
    const etag = `"${getMetadata().scrapedAt}"`;
    const ifNoneMatch = c.req.header('If-None-Match');

    if (ifNoneMatch === etag) {
      return c.body(null, 304);
    }

    c.header('Cache-Control', 'public, max-age=300, stale-while-revalidate=60');
    c.header('ETag', etag);
  });

  // Health check
  app.get('/health', c => {
    return c.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      service: 'skills-api',
    });
  });

  // Root endpoint — HTML landing page
  app.get('/', c => {
    const metadata = getMetadata();
    const topSkills = getTopSkills(10);
    const totalInstalls = getSkills().reduce((sum, s) => sum + s.installs, 0);
    const html = renderIndexPage({ prefix, metadata, topSkills, totalInstalls });
    return c.html(html);
  });

  // Mount skills routes
  app.route(`${prefix}/skills`, skillsRouter);

  // Mount admin routes if enabled
  if (enableAdmin) {
    app.route(`${prefix}/admin`, adminRouter);
  }

  // Start auto-refresh scheduler if enabled
  if (autoRefresh) {
    startRefreshScheduler({
      intervalMs: refreshIntervalMinutes * 60 * 1000,
      refreshOnStart: false,
    });
  }

  // 404 handler
  app.notFound(c => {
    return c.json(
      {
        error: 'Not Found',
        message: `Route ${c.req.method} ${c.req.path} not found`,
        documentation: 'https://skills.sh/docs/api',
      },
      404,
    );
  });

  // Error handler
  app.onError((err, c) => {
    console.error('Server error:', err);
    return c.json(
      {
        error: 'Internal Server Error',
        message: err.message,
      },
      500,
    );
  });

  return app;
}

export { skillsRouter };
