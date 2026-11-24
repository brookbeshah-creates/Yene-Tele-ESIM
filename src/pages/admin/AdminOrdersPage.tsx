import React, { useEffect, useMemo, useState } from 'react';
import { apiRequest } from '../../lib/apiClient';
import type {
  AuditLogRecord,
  EsimOrderRecord,
  OperatorCode,
  OrderStatus,
  PaymentRecord,
} from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';
import { LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table } from '../../components/ui/Table';
import { mapOrderStatusToBadge } from '../../components/yegna/TransactionRow';

interface AdminOrderDetailPayload {
  order: EsimOrderRecord;
  payment: PaymentRecord | null;
  auditEvents: AuditLogRecord[];
}

export function AdminOrdersPage() {
  const [orders, setOrders] = useState<EsimOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [operatorFilter, setOperatorFilter] = useState<'all' | OperatorCode>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');

  const [inspectDetail, setInspectDetail] = useState<AdminOrderDetailPayload | null>(null);
  const [manualOrder, setManualOrder] = useState<EsimOrderRecord | null>(null);
  const [assignedMsisdn, setAssignedMsisdn] = useState('');
  const [iccid, setIccid] = useState('');
  const [smdpAddress, setSmdpAddress] = useState('sandbox-smdp.partner.yene.invalid');
  const [activationCode, setActivationCode] = useState('');
  const [partnerReference, setPartnerReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const loadOrders = () => {
    setLoading(true);
    apiRequest<{ orders: EsimOrderRecord[] }>('/api/v1/admin/orders')
      .then((res) => setOrders(res.orders))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (operatorFilter !== 'all' && o.operatorCode !== operatorFilter) return false;
      if (statusFilter !== 'all' && o.status !== statusFilter) return false;
      if (q) {
        const hit =
          o.orderNumber.toLowerCase().includes(q) ||
          o.userId.toLowerCase().includes(q) ||
          (o.reservedMsisdn ?? '').toLowerCase().includes(q);
        if (!hit) return false;
      }
      return true;
    });
  }, [orders, searchQuery, operatorFilter, statusFilter]);

  const handleInspectOrder = async (ord: EsimOrderRecord) => {
    setErr(null);
    try {
      const detail = await apiRequest<AdminOrderDetailPayload>(`/api/v1/admin/orders/${ord.id}`);
      setInspectDetail(detail);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to load order audit detail.');
    }
  };

  const handleOpenManual = (ord: EsimOrderRecord) => {
    setManualOrder(ord);
    setAssignedMsisdn(ord.reservedMsisdn ?? '');
    setIccid(`8925109000${Math.floor(100000 + Math.random() * 899999)}`);
    setActivationCode(`PARTNER-${ord.orderNumber.slice(-6)}`);
    setPartnerReference(`PARTNER-OUTLET-${ord.orderNumber.slice(-4)}`);
    setErr(null);
  };

  const handleCompleteManual = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!manualOrder) return;
    setBusy(true);
    setErr(null);
    try {
      await apiRequest(`/api/v1/admin/orders/${manualOrder.id}/manual-fulfillment`, {
        method: 'POST',
        body: {
          assignedMsisdn,
          iccid,
          smdpAddress,
          activationCode,
          partnerReference,
          isSandboxSimulation: true,
        },
      });
      setMsg(`Manual fulfillment completed and encrypted into vault for ${manualOrder.orderNumber}.`);
      setManualOrder(null);
      loadOrders();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Manual fulfillment failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePollOrder = async (orderId: string) => {
    setBusy(true);
    setErr(null);
    try {
      await apiRequest(`/api/v1/admin/orders/${orderId}/poll-provisioning`, {
        method: 'POST',
        body: {},
      });
      setMsg('Polled operator provisioning status.');
      loadOrders();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to poll order.');
    } finally {
      setBusy(false);
    }
  };

  const handleOrderAction = async (orderId: string, action: 'retry_provisioning' | 'refund') => {
    setBusy(true);
    setErr(null);
    try {
      await apiRequest(`/api/v1/admin/orders/${orderId}/action`, {
        method: 'POST',
        body: { action, reason: `Admin action ${action} triggered via operations console` },
      });
      setMsg(`Action ${action} executed.`);
      loadOrders();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Order action failed.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState message="Loading all customer eSIM orders..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">eSIM Orders &amp; Manual Fulfillment Queue</h1>
        <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
          Search, filter, inspect full update history and audit events, fulfill manual partner
          orders, retry provisioning, or process refunds.
        </p>
      </div>

      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}

      <Card padding="sm" className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Input
          label="Search Order / MSISDN / Customer"
          inputKind="search"
          placeholder="YN-..., +251..., uid-..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
        <div>
          <label className="block text-sm font-medium mb-1.5">Operator Filter</label>
          <select
            value={operatorFilter}
            onChange={(e) => setOperatorFilter(e.target.value as 'all' | OperatorCode)}
            className="w-full min-h-[44px] px-3 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-sm"
          >
            <option value="all">All Operators</option>
            <option value="ethio_telecom">Ethio telecom</option>
            <option value="safaricom_ethiopia">Safaricom Ethiopia</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium mb-1.5">Order Status</label>
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as 'all' | OrderStatus)}
            className="w-full min-h-[44px] px-3 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-sm"
          >
            <option value="all">All Statuses</option>
            <option value="awaiting_identity_verification">Awaiting KYC</option>
            <option value="awaiting_payment">Awaiting Payment</option>
            <option value="operator_pending">Operator Pending</option>
            <option value="awaiting_manual_fulfillment">Manual Partner Queue</option>
            <option value="ready_for_installation">Ready for Installation</option>
            <option value="installed">Installed</option>
            <option value="activated">Activated</option>
            <option value="failed">Failed</option>
            <option value="refund_pending">Refund Pending</option>
            <option value="refunded">Refunded</option>
          </select>
        </div>
      </Card>

      <Table
        rows={filteredOrders}
        getRowKey={(o) => o.id}
        emptyMessage="No matching eSIM orders found."
        columns={[
          {
            key: 'ord',
            header: 'Order',
            render: (o) => (
              <div>
                <p className="font-semibold tabular-nums">{o.orderNumber}</p>
                <p className="text-xs text-[#64748B] tabular-nums">{o.reservedMsisdn ?? 'No number yet'}</p>
              </div>
            ),
          },
          {
            key: 'op',
            header: 'Operator & Supply',
            render: (o) => (
              <div>
                <p className="text-xs font-medium">
                  {o.operatorCode === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia'}
                </p>
                <p className="text-[11px] text-[#64748B]">{o.supplyMethodUsed.replace('_', ' ')}</p>
              </div>
            ),
          },
          {
            key: 'kyc',
            header: 'KYC & Payment',
            render: (o) => (
              <div className="text-xs">
                <p>KYC: {o.kycStatus}</p>
                <p>Pay: {o.paymentStatus}</p>
              </div>
            ),
          },
          {
            key: 'st',
            header: 'Status',
            render: (o) => (
              <StatusBadge status={mapOrderStatusToBadge(o.status)} label={o.status.replace(/_/g, ' ')} />
            ),
          },
          {
            key: 'act',
            header: 'Operations',
            render: (o) => (
              <div className="flex flex-wrap gap-1.5">
                <Button size="sm" variant="tertiary" onClick={() => handleInspectOrder(o)}>
                  Inspect
                </Button>
                {o.status === 'awaiting_manual_fulfillment' && (
                  <Button size="sm" onClick={() => handleOpenManual(o)}>
                    Fulfill Manually
                  </Button>
                )}
                {o.status === 'operator_pending' && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => handlePollOrder(o.id)}>
                    Poll
                  </Button>
                )}
                {o.paymentStatus === 'verified' && !['ready_for_installation', 'installed', 'activated', 'refunded'].includes(o.status) && (
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => handleOrderAction(o.id, 'retry_provisioning')}>
                    Retry
                  </Button>
                )}
                {['verified', 'refund_pending'].includes(o.paymentStatus) && o.status !== 'refunded' && (
                  <Button size="sm" variant="destructive" disabled={busy} onClick={() => handleOrderAction(o.id, 'refund')}>
                    Refund
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />

      <Dialog
        open={Boolean(inspectDetail)}
        onClose={() => setInspectDetail(null)}
        title={`Order Inspector · ${inspectDetail?.order.orderNumber ?? ''}`}
        description="Full status history & audit log (activation secrets remain encrypted & hidden from staff views)"
      >
        {inspectDetail && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D]">
              <div>
                <p className="text-[#64748B]">Customer UID</p>
                <p className="font-semibold break-all">{inspectDetail.order.userId}</p>
              </div>
              <div>
                <p className="text-[#64748B]">Operator Ref</p>
                <p className="font-semibold">{inspectDetail.order.operatorTransactionRef ?? '—'}</p>
              </div>
              <div>
                <p className="text-[#64748B]">Payment Ref</p>
                <p className="font-semibold">{inspectDetail.payment?.txRef ?? '—'}</p>
              </div>
              <div>
                <p className="text-[#64748B]">Provisioning</p>
                <p className="font-semibold">{inspectDetail.order.provisioningStatus}</p>
              </div>
            </div>

            <div>
              <p className="font-semibold uppercase text-[#64748B] mb-2">Order Timeline</p>
              <div className="max-h-40 overflow-y-auto space-y-1.5">
                {inspectDetail.order.updateHistory.map((h, i) => (
                  <div key={i} className="p-2 rounded border border-[#E5E7EB] dark:border-[#24344D]">
                    <div className="flex justify-between font-semibold">
                      <span>{h.status}</span>
                      <span className="text-[#64748B]">{new Date(h.at).toLocaleString()}</span>
                    </div>
                    <p className="text-[#64748B]">{h.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div>
              <p className="font-semibold uppercase text-[#64748B] mb-2">
                Audit Events ({inspectDetail.auditEvents.length})
              </p>
              <div className="max-h-36 overflow-y-auto space-y-1.5">
                {inspectDetail.auditEvents.map((ev) => (
                  <div key={ev.id} className="p-2 rounded border border-[#E5E7EB] dark:border-[#24344D]">
                    <span className="font-semibold">{ev.action}</span> — {ev.reason}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </Dialog>

      <Dialog
        open={Boolean(manualOrder)}
        onClose={() => setManualOrder(null)}
        title={`Manual Partner Processing · ${manualOrder?.orderNumber ?? ''}`}
        description="Attach verified operator eSIM credentials (encrypted into customer vault on save)"
      >
        <form onSubmit={handleCompleteManual} className="space-y-4">
          <Input
            label="Assigned Mobile Number (MSISDN)"
            value={assignedMsisdn}
            onChange={(e) => setAssignedMsisdn(e.target.value)}
            required
          />
          <Input
            label="eSIM ICCID"
            value={iccid}
            onChange={(e) => setIccid(e.target.value)}
            required
          />
          <Input
            label="SM-DP+ Address"
            value={smdpAddress}
            onChange={(e) => setSmdpAddress(e.target.value)}
            required
          />
          <Input
            label="Activation Code"
            value={activationCode}
            onChange={(e) => setActivationCode(e.target.value)}
            required
          />
          <Input
            label="Authorized Partner / Outlet Reference"
            value={partnerReference}
            onChange={(e) => setPartnerReference(e.target.value)}
            required
          />

          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setManualOrder(null)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Save &amp; Deliver eSIM
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
