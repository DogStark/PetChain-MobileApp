/**
 * notificationTemplateService.ts
 *
 * Resolves localized notification templates from the DB, interpolates
 * named {{variable}} placeholders, and caches results via the existing
 * Redis-backed cacheService.
 */

import { randomUUID } from 'crypto';

import { cacheKey, get as cacheGet, invalidate, set as cacheSet } from '../services/cacheService';
import { sendToUser, type NotificationTopic } from '../services/pushService';
import { query } from '../src/db';
import logger from '../utils/logger';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface NotificationTemplate {
  id: string;
  key: string;
  locale: string;
  title: string;
  body: string;
  isActive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface RenderedNotification {
  title: string;
  body: string;
  locale: string; // actual locale used (may differ from requested if fell back)
}

export type TemplateVariables = Record<string, string>;

// ─── Cache helpers ────────────────────────────────────────────────────────────

const TEMPLATE_TTL = 300; // 5 minutes

function templateCacheKey(key: string, locale: string): string {
  return cacheKey('notif_tmpl', key, locale);
}

// ─── Interpolation ────────────────────────────────────────────────────────────

/**
 * Replaces {{varName}} placeholders with values from `vars`.
 * Throws if any placeholder in the template has no corresponding value.
 */
export function interpolate(template: string, vars: TemplateVariables): string {
  const missing: string[] = [];

  const result = template.replace(/\{\{(\w+)\}\}/g, (_match, name: string) => {
    if (!(name in vars)) {
      missing.push(name);
      return _match;
    }
    return vars[name];
  });

  if (missing.length > 0) {
    throw new Error(`Missing template variables: ${missing.join(', ')}`);
  }

  return result;
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

function rowToTemplate(row: Record<string, unknown>): NotificationTemplate {
  return {
    id: row.id as string,
    key: row.key as string,
    locale: row.locale as string,
    title: row.title as string,
    body: row.body as string,
    isActive: row.is_active as boolean,
    createdBy: (row.created_by as string | null) ?? null,
    createdAt: (row.created_at as Date).toISOString(),
    updatedAt: (row.updated_at as Date).toISOString(),
  };
}

// ─── Core resolution ─────────────────────────────────────────────────────────

/**
 * Fetches a single template row for (key, locale), with Redis caching.
 * Returns null if not found or inactive.
 */
async function fetchTemplate(key: string, locale: string): Promise<NotificationTemplate | null> {
  const ck = templateCacheKey(key, locale);
  const cached = await cacheGet<NotificationTemplate>(ck);
  if (cached) return cached;

  const { rows } = await query(
    `SELECT * FROM notification_templates
     WHERE key = $1 AND locale = $2 AND is_active = TRUE
     LIMIT 1`,
    [key, locale],
  );

  if (rows.length === 0) return null;

  const tmpl = rowToTemplate(rows[0]);
  await cacheSet(ck, tmpl, TEMPLATE_TTL);
  return tmpl;
}

/**
 * Resolves a template for the given key and preferred locale, falling back
 * to 'en' automatically. Interpolates variables and returns the rendered
 * title + body.
 *
 * @throws if no template exists for the key in any supported locale
 * @throws if required variables are missing
 */
export async function resolveTemplate(
  key: string,
  vars: TemplateVariables = {},
  preferredLocale = 'en',
): Promise<RenderedNotification> {
  const locale = preferredLocale.toLowerCase().split('-')[0]; // 'en-US' → 'en'

  let tmpl = locale !== 'en' ? await fetchTemplate(key, locale) : null;
  let usedLocale = locale;

  if (!tmpl) {
    tmpl = await fetchTemplate(key, 'en');
    usedLocale = 'en';
  }

  if (!tmpl) {
    throw new Error(`No notification template found for key: "${key}"`);
  }

  return {
    title: interpolate(tmpl.title, vars),
    body: interpolate(tmpl.body, vars),
    locale: usedLocale,
  };
}

// ─── User locale lookup ───────────────────────────────────────────────────────

/**
 * Looks up a user's preferred_language. Falls back to 'en' if the user
 * is missing or the column is empty for any reason.
 */
async function getUserPreferredLanguage(userId: string): Promise<string> {
  const { rows } = await query('SELECT preferred_language FROM users WHERE id = $1', [userId]);
  const lang = rows[0]?.preferred_language as string | undefined;
  return lang && lang.trim() ? lang : 'en';
}

// ─── Send ─────────────────────────────────────────────────────────────────────

export interface SendNotificationOptions {
  /** Push topic used for subscription/preference gating in pushService. */
  topic: NotificationTopic;
  /** Extra payload passed through to the push job (e.g. for deep-linking). */
  data?: Record<string, unknown>;
}

/**
 * Sends a push notification to `userId` using the localized template for
 * `key`, rendered with `vars`. The user's `preferred_language` is read from
 * the DB and used to select the template locale, falling back to English
 * (via resolveTemplate) if no translation exists for that locale.
 *
 * Returns the number of push jobs enqueued (see pushService.sendToUser),
 * and the locale that was actually used for the rendered copy.
 *
 * @throws if no template exists for the key in any supported locale
 * @throws if required variables are missing for the resolved template
 */
export async function sendNotification(
  userId: string,
  key: string,
  vars: TemplateVariables = {},
  options: SendNotificationOptions,
): Promise<{ enqueued: number; locale: string }> {
  const preferredLanguage = await getUserPreferredLanguage(userId);
  const rendered = await resolveTemplate(key, vars, preferredLanguage);

  const enqueued = await sendToUser(
    userId,
    options.topic,
    rendered.title,
    rendered.body,
    options.data,
  );

  logger.info('notification_sent', {
    userId,
    key,
    locale: rendered.locale,
    topic: options.topic,
    enqueued,
  });

  return { enqueued, locale: rendered.locale };
}

// ─── Admin CRUD ───────────────────────────────────────────────────────────────

export async function listTemplates(opts: {
  key?: string;
  locale?: string;
  isActive?: boolean;
  limit?: number;
  offset?: number;
}): Promise<{ data: NotificationTemplate[]; total: number }> {
  const conditions: string[] = [];
  const values: unknown[] = [];

  if (opts.key) {
    values.push(opts.key);
    conditions.push(`key = $${values.length}`);
  }
  if (opts.locale) {
    values.push(opts.locale);
    conditions.push(`locale = $${values.length}`);
  }
  if (opts.isActive !== undefined) {
    values.push(opts.isActive);
    conditions.push(`is_active = $${values.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const limit = Math.min(opts.limit ?? 50, 200);
  const offset = opts.offset ?? 0;

  const [countRes, dataRes] = await Promise.all([
    query(`SELECT COUNT(*)::int AS count FROM notification_templates ${where}`, values),
    query(
      `SELECT * FROM notification_templates ${where}
       ORDER BY key, locale
       LIMIT $${values.length + 1} OFFSET $${values.length + 2}`,
      [...values, limit, offset],
    ),
  ]);

  return {
    total: (countRes.rows[0]?.count as number) ?? 0,
    data: dataRes.rows.map(rowToTemplate),
  };
}

export async function getTemplateById(id: string): Promise<NotificationTemplate | null> {
  const { rows } = await query('SELECT * FROM notification_templates WHERE id = $1', [id]);
  return rows.length ? rowToTemplate(rows[0]) : null;
}

export interface CreateTemplateInput {
  key: string;
  locale: string;
  title: string;
  body: string;
  isActive?: boolean;
  createdBy?: string;
}

export async function createTemplate(input: CreateTemplateInput): Promise<NotificationTemplate> {
  const id = randomUUID();
  const { rows } = await query(
    `INSERT INTO notification_templates (id, key, locale, title, body, is_active, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING *`,
    [
      id,
      input.key.trim(),
      input.locale.toLowerCase(),
      input.title.trim(),
      input.body.trim(),
      input.isActive ?? true,
      input.createdBy ?? null,
    ],
  );
  const tmpl = rowToTemplate(rows[0]);
  logger.info('notification_template_created', { id, key: tmpl.key, locale: tmpl.locale });
  return tmpl;
}

export interface UpdateTemplateInput {
  title?: string;
  body?: string;
  isActive?: boolean;
}

export async function updateTemplate(
  id: string,
  input: UpdateTemplateInput,
): Promise<NotificationTemplate | null> {
  const sets: string[] = [];
  const values: unknown[] = [];

  if (input.title !== undefined) {
    values.push(input.title.trim());
    sets.push(`title = $${values.length}`);
  }
  if (input.body !== undefined) {
    values.push(input.body.trim());
    sets.push(`body = $${values.length}`);
  }
  if (input.isActive !== undefined) {
    values.push(input.isActive);
    sets.push(`is_active = $${values.length}`);
  }

  if (sets.length === 0) return getTemplateById(id);

  values.push(id);
  const { rows } = await query(
    `UPDATE notification_templates SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
    values,
  );

  if (rows.length === 0) return null;

  const tmpl = rowToTemplate(rows[0]);
  // Invalidate cache for this key+locale
  await invalidate(templateCacheKey(tmpl.key, tmpl.locale));
  logger.info('notification_template_updated', { id, key: tmpl.key, locale: tmpl.locale });
  return tmpl;
}

export async function deleteTemplate(id: string): Promise<boolean> {
  const existing = await getTemplateById(id);
  if (!existing) return false;

  await query('DELETE FROM notification_templates WHERE id = $1', [id]);
  await invalidate(templateCacheKey(existing.key, existing.locale));
  logger.info('notification_template_deleted', { id, key: existing.key, locale: existing.locale });
  return true;
}
