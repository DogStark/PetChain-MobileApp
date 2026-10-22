import { randomUUID } from 'crypto';

export type SupportRequestStatus = 'open' | 'in_progress' | 'resolved';

export interface SupportRequest {
  id: string;
  userId?: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  status: SupportRequestStatus;
  priority: 'low' | 'medium' | 'high';
  createdAt: string;
  updatedAt: string;
  assignedTo?: string;
  notes?: string;
  resolvedAt?: string;
}

const now = () => new Date().toISOString();

const supportRequests = new Map<string, SupportRequest>();

function seed(): void {
  const t = now();
  const entries: SupportRequest[] = [
    {
      id: 'sr-demo-1',
      userId: 'u-demo-1',
      name: 'Demo User',
      email: 'demo@petchain.app',
      subject: 'Unable to sync vaccination history',
      message: 'My recent vaccination uploads are not appearing on the dashboard.',
      status: 'open',
      priority: 'high',
      createdAt: t,
      updatedAt: t,
    },
    {
      id: 'sr-demo-2',
      name: 'Amina Bello',
      email: 'amina@example.com',
      subject: 'Need help exporting records',
      message: 'Could you send the CSV export in a format I can open on mobile?',
      status: 'in_progress',
      priority: 'medium',
      createdAt: t,
      updatedAt: t,
      assignedTo: 'admin-demo',
    },
  ];

  for (const entry of entries) {
    supportRequests.set(entry.id, entry);
  }
}

seed();

export function listSupportRequests(): SupportRequest[] {
  return [...supportRequests.values()].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function createSupportRequest(input: {
  userId?: string;
  name: string;
  email: string;
  subject: string;
  message: string;
  priority?: SupportRequest['priority'];
}): SupportRequest {
  const t = now();
  const ticket: SupportRequest = {
    id: randomUUID(),
    userId: input.userId,
    name: input.name,
    email: input.email,
    subject: input.subject,
    message: input.message,
    status: 'open',
    priority: input.priority ?? 'medium',
    createdAt: t,
    updatedAt: t,
  };
  supportRequests.set(ticket.id, ticket);
  return ticket;
}

export function updateSupportRequest(
  id: string,
  updates: Partial<Pick<SupportRequest, 'status' | 'assignedTo' | 'notes' | 'priority'>>,
): SupportRequest | null {
  const current = supportRequests.get(id);
  if (!current) return null;

  const next: SupportRequest = {
    ...current,
    ...updates,
    ...(updates.status === 'resolved' ? { resolvedAt: now() } : {}),
    updatedAt: now(),
  };

  supportRequests.set(id, next);
  return next;
}

export function getSupportRequest(id: string): SupportRequest | null {
  return supportRequests.get(id) ?? null;
}
