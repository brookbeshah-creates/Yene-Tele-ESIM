import React from 'react';
import type { EsimOrderRecord, StatusKind } from '../../types/domain';
import { Card } from '../ui/Card';
import { StatusBadge } from '../ui/StatusBadge';

export function mapOrderStatusToBadge(status: EsimOrderRecord['status']): StatusKind {
  switch (status) {
    case 'installed':
    case 'activated':
      return 'active';
    case 'ready_for_installation':
    case 'provisioned':
    case 'delivered':
      return 'verified';
    case 'awaiting_manual_fulfillment':
      return 'manual';
    case 'provisioning_in_progress':
    case 'submitted_to_operator':
    case 'operator_pending':
    case 'payment_verified':
    case 'identity_verified':
      return 'processing';
    case 'failed':
    case 'expired':
      return 'failed';
    case 'refund_pending':
      return 'pending';
    case 'refunded':
      return 'refunded';
    case 'cancelled':
      return 'cancelled';
    default:
      return 'pending';
  }
}

export function OrderSummaryRow({
  order,
  onSelect,
}: {
  order: EsimOrderRecord;
  onSelect?: (order: EsimOrderRecord) => void;
}) {
  const operatorLabel =
    order.operatorCode === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia';

  return (
    <div
      className={`flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-3.5 border-b border-[#E5E7EB] dark:border-[#24344D] last:border-b-0 ${
        onSelect ? 'cursor-pointer hover:bg-[#F8FAFC] dark:hover:bg-[#111C2E] px-2 -mx-2 rounded-lg' : ''
      }`}
      onClick={onSelect ? () => onSelect(order) : undefined}
    >
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-[#111827] dark:text-[#F8FAFC]">
            {operatorLabel} eSIM
          </span>
          <span className="text-xs text-[#64748B] dark:text-[#94A3B8] tabular-nums">
            {order.orderNumber}
          </span>
        </div>
        <p className="text-xs text-[#64748B] dark:text-[#CBD5E1] mt-0.5 tabular-nums">
          Supply: {order.supplyMethodUsed.replace('_', ' ')}
          {order.reservedMsisdn ? ` · ${order.reservedMsisdn}` : ''} ·{' '}
          {new Date(order.createdAt).toLocaleDateString()}
        </p>
      </div>

      <div className="flex items-center justify-between sm:justify-end gap-3 shrink-0">
        <div className="text-left sm:text-right">
          <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] tabular-nums whitespace-nowrap">
            {order.amountEtb > 0 ? `${order.amountEtb.toFixed(2)} ETB` : 'Pending Quote'}
          </p>
          <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] whitespace-nowrap">
            {order.paymentStatus === 'verified' ? 'Chapa Verified' : 'Chapa Checkout'}
          </p>
        </div>
        <StatusBadge
          status={mapOrderStatusToBadge(order.status)}
          label={order.status.replace(/_/g, ' ')}
        />
      </div>
    </div>
  );
}

export function OrderSummaryCard({ order }: { order: EsimOrderRecord }) {
  const operatorLabel =
    order.operatorCode === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia';

  return (
    <Card padding="sm" variant="default">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] truncate">
            {operatorLabel} Digital eSIM
          </p>
          <p className="text-xs text-[#64748B] dark:text-[#CBD5E1] mt-0.5 tabular-nums">
            {order.orderNumber}
            {order.reservedMsisdn ? ` · ${order.reservedMsisdn}` : ''}
          </p>
        </div>
        <StatusBadge
          status={mapOrderStatusToBadge(order.status)}
          label={order.status.replace(/_/g, ' ')}
        />
      </div>

      <div className="mt-3 pt-3 border-t border-[#E5E7EB] dark:border-[#24344D] flex items-center justify-between gap-2 text-xs">
        <span className="text-[#64748B] dark:text-[#94A3B8] tabular-nums">
          KYC: {order.kycStatus.replace(/_/g, ' ')}
        </span>
        <span className="font-semibold text-[#111827] dark:text-[#F8FAFC] tabular-nums whitespace-nowrap">
          {order.amountEtb > 0 ? `${order.amountEtb.toFixed(2)} ETB` : 'Commercial Quote'}
        </span>
      </div>
    </Card>
  );
}
