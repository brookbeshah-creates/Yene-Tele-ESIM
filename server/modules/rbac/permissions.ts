import type { AdminRole } from '../../../src/types/domain.ts';

export const ADMIN_ROLE_CATALOG: Record<
  AdminRole,
  { label: string; description: string; canMutateOperators: boolean; canApproveAgents: boolean }
> = {
  super_admin: {
    label: 'Super Administrator',
    description:
      'Full Yene Tele platform configuration, operator supply modes, staff governance, and audit logs.',
    canMutateOperators: true,
    canApproveAgents: true,
  },
  operations_staff: {
    label: 'Operations & Provisioning Staff',
    description:
      'Manages stock imports, manual partner processing outcomes, eSIM activation queues, and order retries.',
    canMutateOperators: false,
    canApproveAgents: false,
  },
  finance_staff: {
    label: 'Finance & Reconciliation',
    description:
      'Monitors Chapa verification, refund statuses, operator settlement reconciliation, and agent payouts.',
    canMutateOperators: false,
    canApproveAgents: false,
  },
  support_staff: {
    label: 'Customer Support',
    description:
      'Investigates customer order tickets, device compatibility questions, and KYC status logs.',
    canMutateOperators: false,
    canApproveAgents: false,
  },
  agent_supervisor: {
    label: 'Agent Distribution Supervisor',
    description:
      'Reviews Yene Tele agent applications, verifies operator authorization records, and manages suspensions.',
    canMutateOperators: false,
    canApproveAgents: true,
  },
  read_only_auditor: {
    label: 'Read-Only Auditor',
    description: 'Read-only access to order histories, stock reconciliation, and immutable audit trails.',
    canMutateOperators: false,
    canApproveAgents: false,
  },
};

export function normalizeEthiopianPhone(raw: string): string | null {
  const cleaned = raw.replace(/[\s()-]/g, '');
  if (/^\+251[79]\d{8}$/.test(cleaned)) return cleaned;
  if (/^251[79]\d{8}$/.test(cleaned)) return `+${cleaned}`;
  if (/^0[79]\d{8}$/.test(cleaned)) return `+251${cleaned.slice(1)}`;
  if (/^[79]\d{8}$/.test(cleaned)) return `+251${cleaned}`;
  return null;
}

export function inferOperatorFromEthiopianPhone(phoneE164: string): 'ethio_telecom' | 'safaricom_ethiopia' | null {
  if (/^\+2519\d{8}$/.test(phoneE164)) return 'ethio_telecom';
  if (/^\+2517\d{8}$/.test(phoneE164)) return 'safaricom_ethiopia';
  return null;
}
