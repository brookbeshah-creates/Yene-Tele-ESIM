import React, { useEffect, useState } from 'react';
import {
  Boxes,
  ClipboardList,
  CreditCard,
  QrCode,
  Radio,
  UserCheck,
} from 'lucide-react';
import { apiRequest } from '../../lib/apiClient';
import { useRouter } from '../../router/RouterContext';
import type { EsimOrderRecord, OperatorConfigRecord } from '../../types/domain';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { SummaryMetricCard } from '../../components/yegna/DomainCards';
import { OrderSummaryRow } from '../../components/yegna/TransactionRow';

interface AdminOverviewResponse {
  metrics: {
    totalUsers: number;
    totalEsimOrders: number;
    awaitingManualFulfillment: number;
    provisionedEsims: number;
    availableStockCount: number;
    reservedStockCount: number;
    pendingAgentApplications: number;
    approvedAgentsCount: number;
    verifiedPaymentsEtb: number;
    openSupportTickets: number;
    phoneOrdersCount: number;
  };
  operators: OperatorConfigRecord[];
  recentOrders: EsimOrderRecord[];
  environment: {
    envMode: string;
    databaseConfigured: boolean;
    chapaConfigured: boolean;
    faydaConfigured: boolean;
    klickConfigured: boolean;
  };
}

export function AdminOverviewPage() {
  const { navigate } = useRouter();
  const [data, setData] = useState<AdminOverviewResponse | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<AdminOverviewResponse>('/api/v1/admin/overview')
      .then(setData)
      .finally(() => setLoading(false));
  }, []);

  if (loading || !data) {
    return <LoadingState message="Loading Yene Tele operations overview..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Yene Tele Operations Overview</h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Supply inventory, manual partner processing queue, agent approvals, and Chapa reconciliation.
          </p>
        </div>
        <Button onClick={() => navigate('/admin/orders')}>Open Fulfillment Queue</Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <SummaryMetricCard
          label="Total eSIM Orders"
          value={data.metrics.totalEsimOrders}
          hint={`${data.metrics.provisionedEsims} provisioned`}
          icon={<ClipboardList className="h-4 w-4" />}
        />
        <SummaryMetricCard
          label="Manual Queue"
          value={data.metrics.awaitingManualFulfillment}
          hint="Orders needing partner QR/LPA upload"
          tone="orange"
          icon={<QrCode className="h-4 w-4" />}
        />
        <SummaryMetricCard
          label="Available eSIM Stock"
          value={data.metrics.availableStockCount}
          hint={`${data.metrics.reservedStockCount} locked in checkout`}
          icon={<Boxes className="h-4 w-4" />}
        />
        <SummaryMetricCard
          label="Pending Agent Apps"
          value={data.metrics.pendingAgentApplications}
          hint={`${data.metrics.approvedAgentsCount} approved agent(s)`}
          tone="neutral"
          icon={<UserCheck className="h-4 w-4" />}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5">
        <Card className="lg:col-span-6 space-y-4">
          <CardHeader
            title="Operator Supply Configuration"
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate('/admin/operators')}>
                Manage Modes
              </Button>
            }
          />
          {data.operators.map((op) => (
            <div
              key={op.operatorCode}
              className="p-3.5 rounded-xl border border-[#E5E7EB] dark:border-[#24344D] flex items-center justify-between gap-3"
            >
              <div>
                <p className="text-sm font-semibold inline-flex items-center gap-1.5">
                  <Radio className="h-3.5 w-3.5 text-[#0A2DB8]" />
                  {op.displayName}
                </p>
                <p className="text-xs text-[#64748B] mt-0.5 capitalize">
                  Active method: <strong>{op.activeSupplyMethod.replace('_', ' ')}</strong> · SIM
                  conversion: {op.supportsSimConversion ? 'Enabled' : 'Disabled'}
                </p>
              </div>
              <StatusBadge
                status={op.integrationStatus === 'live' ? 'verified' : 'sandbox'}
                label={op.integrationStatus}
              />
            </div>
          ))}
        </Card>

        <Card className="lg:col-span-6 space-y-3">
          <CardHeader title="Environment & Adapter Status" />
          <div className="text-xs space-y-2">
            {[
              { label: 'Runtime Environment Mode', val: data.environment.envMode },
              { label: 'PostgreSQL Persistence', val: data.environment.databaseConfigured ? 'Connected' : 'In-Memory Sandbox Store (Migration Ready)' },
              { label: 'Chapa Gateway Adapter', val: data.environment.chapaConfigured ? 'Live Configured' : 'Sandbox Fallback' },
              { label: 'Fayda Identity Adapter', val: data.environment.faydaConfigured ? 'Configured' : 'Sandbox Consent Boundary' },
              { label: 'Klick Phone Delivery Adapter', val: data.environment.klickConfigured ? 'Configured' : 'Boundary Pending Onboarding' },
              { label: 'Verified Payments Total', val: `${data.metrics.verifiedPaymentsEtb.toFixed(2)} ETB` },
            ].map((row) => (
              <div
                key={row.label}
                className="flex items-center justify-between gap-2 py-2 border-b border-[#E5E7EB] dark:border-[#24344D] last:border-b-0"
              >
                <span className="text-[#64748B] inline-flex items-center gap-1.5">
                  <CreditCard className="h-3 w-3" />
                  {row.label}
                </span>
                <span className="font-semibold text-right">{row.val}</span>
              </div>
            ))}
          </div>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Recent eSIM Orders"
          action={
            <Button variant="secondary" size="sm" onClick={() => navigate('/admin/orders')}>
              View All
            </Button>
          }
        />
        {data.recentOrders.length === 0 ? (
          <p className="text-sm text-[#64748B]">No customer eSIM orders recorded yet.</p>
        ) : (
          data.recentOrders.map((ord) => <OrderSummaryRow key={ord.id} order={ord} />)
        )}
      </Card>
    </div>
  );
}
