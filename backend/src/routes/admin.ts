import { Router, type Response } from 'express';

import {
  authenticate,
  requireAdmin,
  requireAdminMfa,
  type AuthenticatedRequest,
} from '../../middleware/adminAuth';
import { type UserRole } from '../../models/UserRole';
import { ok, sendError } from '../../server/response';
import { store } from '../../server/store';
import {
  getSupportRequest,
  listSupportRequests,
  updateSupportRequest,
} from '../../server/supportRequests';
import {
  getAllSyncResults,
  getSyncResults,
} from '../../services/shelterIntegrationService';

const router = Router();

type DbClient = {
  query: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>> }>;
  totalCount?: number;
  idleCount?: number;
  waitingCount?: number;
};

interface DashboardAnalytics {
  activeUsers: {
    last7Days: number;
    last30Days: number;
  };
  recordCounts: {
    users: number;
    pets: number;
    medicalRecords: number;
    appointments: number;
    medications: number;
  };
  blockchain: {
    transactionVolume: number;
    verifiedRecords: number;
  };
  errorRates: {
    errorsLast24h: number;
    errorRateLast24h: number;
  };
  generatedAt: string;
}

interface AdminUserView {
  id: string;
  email: string;
  name: string;
  phone?: string;
  role: UserRole;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string;
  isEmailVerified: boolean;
  lastLoginAt?: string;
}

interface SupportRequestView {
  id: string;
  userId?: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: 'open' | 'in_progress' | 'resolved';
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
  assignedTo?: string;
  notes?: string;
  resolvedAt?: string;
}

function getDb(req: AuthenticatedRequest): DbClient | undefined {
  return req.app.locals.db as DbClient | undefined;
}

function csvEscape(value: unknown): string {
  const text = String(value ?? '');
  if (/[",\n]/.test(text)) {
    return `"${text.replace(/"/g, '""')}"`;
  }
  return text;
}

function toCsv(rows: Array<Record<string, unknown>>): string {
  if (rows.length === 0) {
    return '';
  }

  const headers = Object.keys(rows[0]);
  const lines = [headers.join(',')];
  for (const row of rows) {
    lines.push(headers.map((header) => csvEscape(row[header])).join(','));
  }
  return lines.join('\n');
}

async function query<T extends Record<string, unknown>>(
  req: AuthenticatedRequest,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const db = getDb(req);
  if (!db) return [];
  const result = await db.query(sql, params);
  return result.rows as T[];
}

function getStoredUsers(includeDeleted: boolean): AdminUserView[] {
  return [...store.users.values()]
    .filter((user) => includeDeleted || !user.deletedAt)
    .map((user) => ({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      deletedAt: user.deletedAt,
      isEmailVerified: user.isEmailVerified,
      lastLoginAt: user.lastLoginAt,
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}

function matchesSearch(user: AdminUserView, search?: string): boolean {
  if (!search) return true;
  const needle = search.toLowerCase();
  return (
    user.id.toLowerCase().includes(needle) ||
    user.email.toLowerCase().includes(needle) ||
    user.name.toLowerCase().includes(needle) ||
    user.role.toLowerCase().includes(needle)
  );
}

function paginate<T>(items: T[], page: number, limit: number): T[] {
  const start = (page - 1) * limit;
  return items.slice(start, start + limit);
}

function getSupportView(): SupportRequestView[] {
  return listSupportRequests();
}

function getSupportSummary() {
  const tickets = getSupportView();
  return {
    total: tickets.length,
    open: tickets.filter((ticket) => ticket.status === 'open').length,
    inProgress: tickets.filter((ticket) => ticket.status === 'in_progress').length,
    resolved: tickets.filter((ticket) => ticket.status === 'resolved').length,
  };
}

async function collectAnalytics(req: AuthenticatedRequest): Promise<DashboardAnalytics> {
  const [dau7] = await query<{ count: string }>(
    req,
    `SELECT COUNT(DISTINCT id) AS count
     FROM users
     WHERE last_login_at >= NOW() - INTERVAL '7 days'`,
  );

  const [dau30] = await query<{ count: string }>(
    req,
    `SELECT COUNT(DISTINCT id) AS count
     FROM users
     WHERE last_login_at >= NOW() - INTERVAL '30 days'`,
  );

  const [blockchainRow] = await query<{ transaction_volume: string; verified_records: string }>(
    req,
    `SELECT
       COUNT(*) FILTER (WHERE blockchain_tx_hash IS NOT NULL) AS transaction_volume,
       COUNT(*) FILTER (WHERE is_blockchain_verified = TRUE) AS verified_records
     FROM medical_records`,
  );

  const [errorRow] = await query<{ error_count: string }>(
    req,
    `SELECT COUNT(*) AS error_count
     FROM audit_logs
     WHERE action = 'error'
       AND created_at >= NOW() - INTERVAL '24 hours'`,
  );

  const recordCounts = {
    users: getStoredUsers(true).length,
    pets: store.pets.size,
    medicalRecords: store.medicalRecords.size,
    appointments: store.appointments.size,
    medications: store.medications.size,
  };

  const blockchain = {
    transactionVolume:
      Number(blockchainRow?.transaction_volume) ||
      [...store.medicalRecords.values()].filter((record) => Boolean(record.blockchainTxHash))
        .length,
    verifiedRecords:
      Number(blockchainRow?.verified_records) ||
      [...store.medicalRecords.values()].filter((record) => Boolean(record.isBlockchainVerified))
        .length,
  };

  const errorsLast24h = Number(errorRow?.error_count) || 0;
  const errorRateLast24h =
    recordCounts.medicalRecords + recordCounts.appointments > 0
      ? Number(
          (
            (errorsLast24h / (recordCounts.medicalRecords + recordCounts.appointments)) *
            100
          ).toFixed(2),
        )
      : 0;

  return {
    activeUsers: {
      last7Days: Number(dau7?.count) || 0,
      last30Days: Number(dau30?.count) || 0,
    },
    recordCounts,
    blockchain,
    errorRates: {
      errorsLast24h,
      errorRateLast24h,
    },
    generatedAt: new Date().toISOString(),
  };
}

function buildDashboardCsv(analytics: DashboardAnalytics, users: AdminUserView[]): string {
  const rows = [
    ['metric', 'value'],
    ['active_users_7d', analytics.activeUsers.last7Days],
    ['active_users_30d', analytics.activeUsers.last30Days],
    ['users', analytics.recordCounts.users],
    ['pets', analytics.recordCounts.pets],
    ['medical_records', analytics.recordCounts.medicalRecords],
    ['appointments', analytics.recordCounts.appointments],
    ['medications', analytics.recordCounts.medications],
    ['blockchain_transactions', analytics.blockchain.transactionVolume],
    ['verified_records', analytics.blockchain.verifiedRecords],
    ['errors_last_24h', analytics.errorRates.errorsLast24h],
    ['error_rate_last_24h', analytics.errorRates.errorRateLast24h],
  ].map(([metric, value]) => ({ metric, value }));

  const userRows = users.map((user) => ({
    metric: `user:${user.id}`,
    value: `${user.email} (${user.role})${user.deletedAt ? ' [deleted]' : ''}`,
  }));

  return `${toCsv(rows)}\n${toCsv(userRows)}`.trim();
}

router.use(authenticate, requireAdmin, requireAdminMfa);

router.get('/dashboard', async (req, res) => {
  const analytics = await collectAnalytics(req as AuthenticatedRequest);
  const users = getStoredUsers(false);

  return res.json(
    ok({
      analytics,
      users: {
        total: users.length,
        deleted: getStoredUsers(true).filter((user) => Boolean(user.deletedAt)).length,
      },
      supportRequests: getSupportSummary(),
      serverMetrics: getServerMetrics(req as AuthenticatedRequest),
    }),
  );
});

router.get('/analytics', async (req, res) => {
  return res.json(ok(await collectAnalytics(req as AuthenticatedRequest)));
});

router.get('/analytics/export.csv', async (req, res) => {
  const analytics = await collectAnalytics(req as AuthenticatedRequest);
  const users = getStoredUsers(true);
  const csv = buildDashboardCsv(analytics, users);

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="admin-analytics.csv"');
  return res.send(csv);
});

router.get('/metrics', (req, res) => {
  return res.json(ok(getServerMetrics(req as AuthenticatedRequest)));
});

router.get('/support-requests', (_req, res) => {
  return res.json(ok(getSupportView(), 'Support requests loaded'));
});

router.get('/support-requests/:id', (req, res) => {
  const ticket = getSupportRequest(req.params.id);
  if (!ticket) {
    return sendError(res, 404, 'NOT_FOUND', 'Support request not found');
  }
  return res.json(ok(ticket));
});

router.patch('/support-requests/:id', (req, res) => {
  const { status, assignedTo, notes, priority } = req.body as Partial<SupportRequestView>;
  const ticket = updateSupportRequest(req.params.id, {
    status: status as 'open' | 'in_progress' | 'resolved' | undefined,
    assignedTo,
    notes,
    priority: priority as 'low' | 'medium' | 'high' | undefined,
  });

  if (!ticket) {
    return sendError(res, 404, 'NOT_FOUND', 'Support request not found');
  }

  return res.json(ok(ticket, 'Support request updated'));
});

router.get('/users', (req, res) => {
  const q = req.query as Record<string, string | undefined>;
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
  const includeDeleted = q.includeDeleted === 'true';
  const search = q.search?.trim();

  const filtered = getStoredUsers(includeDeleted).filter((user) => matchesSearch(user, search));
  const total = filtered.length;
  const totalPages = Math.max(1, Math.ceil(total / limit));
  const data = paginate(filtered, page, limit);

  return res.json({
    success: true,
    data,
    pagination: {
      page,
      limit,
      total,
      totalPages,
      hasNext: page < totalPages,
      hasPrev: page > 1,
    },
    timestamp: new Date().toISOString(),
  });
});

router.get('/users/:id', (req, res) => {
  const user = store.users.get(req.params.id);
  if (!user || user.deletedAt) {
    return sendError(res, 404, 'NOT_FOUND', 'User not found');
  }

  return res.json(
    ok({
      id: user.id,
      email: user.email,
      name: user.name,
      phone: user.phone,
      role: user.role,
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      isEmailVerified: user.isEmailVerified,
      lastLoginAt: user.lastLoginAt,
      deletedAt: user.deletedAt,
    }),
  );
});

router.delete('/users/:id', (req, res) => {
  const user = store.users.get(req.params.id);
  if (!user) {
    return sendError(res, 404, 'NOT_FOUND', 'User not found');
  }

  if (user.deletedAt) {
    return res.json(ok({ id: user.id, deletedAt: user.deletedAt }, 'User already archived'));
  }

  const archivedAt = new Date().toISOString();
  store.users.set(user.id, { ...user, deletedAt: archivedAt, updatedAt: archivedAt });

  return res.json(ok({ id: user.id, deletedAt: archivedAt }, 'User archived'));
});

router.post('/users/:id/restore', (req, res) => {
  const user = store.users.get(req.params.id);
  if (!user) {
    return sendError(res, 404, 'NOT_FOUND', 'User not found');
  }
  if (!user.deletedAt) {
    return res.json(ok({ id: user.id }, 'User is already active'));
  }

  const restoredAt = new Date().toISOString();
  const { deletedAt: _deletedAt, ...rest } = user;
  store.users.set(user.id, { ...rest, deletedAt: undefined, updatedAt: restoredAt });

  return res.json(ok({ id: user.id, restoredAt }, 'User restored'));
});

function getServerMetrics(req: AuthenticatedRequest) {
  const memory = process.memoryUsage();
  const cpu = process.cpuUsage();
  const db = getDb(req);

  return {
    cpu: {
      userMicroseconds: cpu.user,
      systemMicroseconds: cpu.system,
    },
    memory: {
      rss: memory.rss,
      heapTotal: memory.heapTotal,
      heapUsed: memory.heapUsed,
      external: memory.external,
    },
    dbConnections: db
      ? {
          total: db.totalCount ?? 0,
          idle: db.idleCount ?? 0,
          waiting: db.waitingCount ?? 0,
        }
      : {
          total: 0,
          idle: 0,
          waiting: 0,
        },
  };
}

/**
 * GET /api/admin/slow-queries
 * Returns the 20 slowest DB queries from the last 24 hours.
 * Requires admin authentication.
 */
router.get('/slow-queries', authenticate, requireAdmin, (_req, res: Response) => {
  const { getSlowQueries } = require('../../middleware/performanceLogger') as typeof import('../../middleware/performanceLogger');
  return res.json({ queries: getSlowQueries() });
});

export default router;
