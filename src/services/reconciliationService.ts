/**
 * Frontend Reconciliation Service
 * Issue #102 — Automated Vet Record Reconciliation
 */

import apiClient from './apiClient';
import type { ReconciliationReport, ReconciliationSummary } from '../models/Reconciliation';

export class ReconciliationError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = 'ReconciliationError';
  }
}

/** Trigger a manual reconciliation run (admin/vet only) */
export async function runReconciliation(): Promise<ReconciliationReport> {
  try {
    const res = await apiClient.post<{ success: boolean; data: ReconciliationReport }>(
      '/reconciliation/run',
    );
    return res.data.data;
  } catch {
    throw new ReconciliationError('Failed to run reconciliation', 'RUN_FAILED');
  }
}

/** Get current status and latest report summary */
export async function getReconciliationSummary(): Promise<ReconciliationSummary> {
  try {
    const res = await apiClient.get<{ success: boolean; data: ReconciliationSummary }>(
      '/reconciliation/summary',
    );
    return res.data.data;
  } catch {
    throw new ReconciliationError('Failed to fetch reconciliation summary', 'FETCH_FAILED');
  }
}

/** List all past reconciliation reports */
export async function listReconciliationReports(): Promise<ReconciliationReport[]> {
  try {
    const res = await apiClient.get<{ success: boolean; data: ReconciliationReport[] }>(
      '/reconciliation/reports',
    );
    return res.data.data;
  } catch {
    throw new ReconciliationError('Failed to fetch reports', 'FETCH_FAILED');
  }
}

/** Get a single report by ID */
export async function getReconciliationReport(reportId: string): Promise<ReconciliationReport> {
  try {
    const res = await apiClient.get<{ success: boolean; data: ReconciliationReport }>(
      `/reconciliation/reports/${reportId}`,
    );
    return res.data.data;
  } catch {
    throw new ReconciliationError('Failed to fetch report', 'FETCH_FAILED');
  }
}

/** Start the background scheduler */
export async function startScheduler(intervalMs?: number): Promise<void> {
  try {
    await apiClient.post('/reconciliation/scheduler/start', { intervalMs });
  } catch {
    throw new ReconciliationError('Failed to start scheduler', 'SCHEDULER_FAILED');
  }
}

/** Stop the background scheduler */
export async function stopScheduler(): Promise<void> {
  try {
    await apiClient.post('/reconciliation/scheduler/stop');
  } catch {
    throw new ReconciliationError('Failed to stop scheduler', 'SCHEDULER_FAILED');
  }
}
