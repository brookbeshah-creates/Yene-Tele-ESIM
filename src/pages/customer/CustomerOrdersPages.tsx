import React, { useEffect, useState } from 'react';
import { RefreshCw, XCircle } from 'lucide-react';
import { apiRequest } from '../../lib/apiClient';
import { useRouter } from '../../router/RouterContext';
import type {
  CustomerEsimRecord,
  EsimOrderRecord,
  KycVerificationRecord,
  PaymentRecord,
} from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { mapOrderStatusToBadge, OrderSummaryRow } from '../../components/yegna/TransactionRow';
import { PhoneMarketplaceView } from '../public/PhoneMarketplaceView';

interface OrderDetailPayload {
  order: EsimOrderRecord;
  payment: PaymentRecord | null;
  kyc: KycVerificationRecord | null;
  esim: CustomerEsimRecord | null;
}

export function CustomerOrdersPage() {
  const { navigate } = useRouter();
  const [orders, setOrders] = useState<EsimOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState<OrderDetailPayload | null>(null);
  const [detailBusy, setDetailBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const loadOrders = () => {
    setLoading(true);
    apiRequest<{ orders: EsimOrderRecord[] }>('/api/v1/orders')
      .then((res) => setOrders(res.orders))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadOrders();
  }, []);

  const openDetail = async (order: EsimOrderRecord) => {
    setErrMsg(null);
    setDetail({ order, payment: null, kyc: null, esim: null });
    setDetailBusy(true);
    try {
      const res = await apiRequest<OrderDetailPayload>(`/api/v1/orders/${order.id}`);
      setDetail(res);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to load order details.');
    } finally {
      setDetailBusy(false);
    }
  };

  const handlePollStatus = async () => {
    if (!detail) return;
    setDetailBusy(true);
    setErrMsg(null);
    try {
      await apiRequest(`/api/v1/orders/${detail.order.id}/poll-provisioning`, {
        method: 'POST',
        body: {},
      });
      await openDetail(detail.order);
      loadOrders();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to refresh provisioning status.');
    } finally {
      setDetailBusy(false);
    }
  };

  const handleCancelOrder = async () => {
    if (!detail) return;
    setDetailBusy(true);
    setErrMsg(null);
    try {
      await apiRequest(`/api/v1/orders/${detail.order.id}/cancel`, {
        method: 'POST',
        body: { reason: 'Customer requested cancellation from dashboard' },
      });
      await openDetail(detail.order);
      loadOrders();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to cancel order.');
    } finally {
      setDetailBusy(false);
    }
  };

  if (loading) return <LoadingState message="Loading your eSIM orders..." />;

  const cancellable =
    detail &&
    ![
      'provisioned',
      'delivered',
      'ready_for_installation',
      'installed',
      'activated',
      'cancelled',
      'refunded',
      'refund_pending',
    ].includes(detail.order.status);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">eSIM Orders &amp; Provisioning Status</h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Click any order to inspect Fayda KYC state, Chapa payment verification, and
            provisioning timeline.
          </p>
        </div>
        <Button onClick={() => navigate('/buy-esim')}>Buy New eSIM</Button>
      </div>

      {orders.length === 0 ? (
        <EmptyState
          title="No eSIM orders yet"
          description="Your submitted eSIM orders and partner-fulfillment progress will appear here."
          action={<Button onClick={() => navigate('/buy-esim')}>Start eSIM Order</Button>}
        />
      ) : (
        <Card>
          <CardHeader title="Order History" subtitle={`${orders.length} order(s) recorded`} />
          {orders.map((order) => (
            <OrderSummaryRow key={order.id} order={order} onSelect={openDetail} />
          ))}
        </Card>
      )}

      <Dialog
        open={Boolean(detail)}
        onClose={() => setDetail(null)}
        title={`Order ${detail?.order.orderNumber ?? ''}`}
        description={
          detail
            ? `${detail.order.operatorCode === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia'} · ${detail.order.reservedMsisdn ?? 'Number pending'}`
            : undefined
        }
      >
        {errMsg && <Alert tone="error" className="mb-3">{errMsg}</Alert>}
        {detail && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-xs p-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D]">
              <div>
                <p className="text-[#64748B]">Order Status</p>
                <div className="mt-1">
                  <StatusBadge
                    status={mapOrderStatusToBadge(detail.order.status)}
                    label={detail.order.status.replace(/_/g, ' ')}
                  />
                </div>
              </div>
              <div>
                <p className="text-[#64748B]">Chapa Payment</p>
                <p className="mt-1 font-semibold">
                  {detail.order.paymentStatus} ({detail.order.amountEtb.toFixed(2)} ETB)
                </p>
              </div>
              <div>
                <p className="text-[#64748B]">Fayda Identity</p>
                <p className="mt-1 font-semibold">
                  {detail.order.kycStatus.replace(/_/g, ' ')}
                  {detail.kyc ? ` (${detail.kyc.faydaFanMasked})` : ''}
                </p>
              </div>
              <div>
                <p className="text-[#64748B]">Provisioning</p>
                <p className="mt-1 font-semibold">{detail.order.provisioningStatus.replace(/_/g, ' ')}</p>
              </div>
            </div>

            {detail.order.failureReason && (
              <Alert tone="warning" title="Status Note">
                {detail.order.failureReason}
              </Alert>
            )}

            <div className="space-y-2">
              <p className="text-xs font-semibold uppercase tracking-wider text-[#64748B]">
                Order Update History
              </p>
              <div className="max-h-48 overflow-y-auto space-y-2 pr-1">
                {(detail.order.updateHistory ?? []).map((ev, idx) => (
                  <div
                    key={`${ev.at}-${idx}`}
                    className="p-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#24344D] text-xs"
                  >
                    <div className="flex justify-between gap-2">
                      <span className="font-semibold text-[#111827] dark:text-[#F8FAFC]">
                        {ev.status.replace(/_/g, ' ')}
                      </span>
                      <span className="text-[11px] text-[#64748B] tabular-nums">
                        {new Date(ev.at).toLocaleString()}
                      </span>
                    </div>
                    <p className="text-[#64748B] dark:text-[#CBD5E1] mt-0.5">{ev.note}</p>
                  </div>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap justify-between gap-2 pt-2 border-t border-[#E5E7EB] dark:border-[#24344D]">
              <div className="flex flex-wrap gap-2">
                {detail.order.status === 'operator_pending' && (
                  <Button
                    size="sm"
                    loading={detailBusy}
                    leftIcon={<RefreshCw className="h-3.5 w-3.5" />}
                    onClick={handlePollStatus}
                  >
                    Refresh Provisioning
                  </Button>
                )}
                {cancellable && (
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={detailBusy}
                    leftIcon={<XCircle className="h-3.5 w-3.5" />}
                    onClick={handleCancelOrder}
                  >
                    Cancel Order
                  </Button>
                )}
              </div>
              <div className="flex gap-2">
                {detail.esim && (
                  <Button
                    size="sm"
                    onClick={() => {
                      setDetail(null);
                      navigate('/app/esims');
                    }}
                  >
                    Open My eSIMs
                  </Button>
                )}
                <Button size="sm" variant="secondary" onClick={() => setDetail(null)}>
                  Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}

export function CustomerPhonesPage() {
  return <PhoneMarketplaceView mode="customer" />;
}


