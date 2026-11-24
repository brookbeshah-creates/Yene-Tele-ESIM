import React from 'react';
import {
  AlertTriangle,
  ArrowRight,
  CheckCircle2,
  QrCode,
  Radio,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Unlock,
  XCircle,
} from 'lucide-react';
import { resolvePhoneImage } from '../../lib/phoneAssets';
import type {
  CustomerEsimRecord,
  DeviceCompatibilityRecord,
  PhoneCompatibilityStatus,
  PhoneProductRecord,
  StatusKind,
  SupplyMethod,
} from '../../types/domain';
import { Button } from '../ui/Button';
import { Card } from '../ui/Card';
import { StatusBadge } from '../ui/StatusBadge';

/* 1. Summary / Statistic Card */
export function SummaryMetricCard({
  label,
  value,
  hint,
  icon,
  tone = 'blue',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: React.ReactNode;
  tone?: 'blue' | 'orange' | 'neutral';
}) {
  const iconTone =
    tone === 'orange'
      ? 'bg-[#FFF7ED] dark:bg-[#3D2316] text-[#F97316] dark:text-[#FB923C]'
      : tone === 'neutral'
        ? 'bg-[#F8FAFC] dark:bg-[#1C2D45] text-[#64748B] dark:text-[#CBD5E1]'
        : 'bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#60A5FA]';

  return (
    <Card padding="sm" variant="default" className="flex flex-col justify-between h-full">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-[#64748B] dark:text-[#CBD5E1]">{label}</span>
        {icon && (
          <span
            className={`inline-flex h-8 w-8 items-center justify-center rounded-lg shrink-0 ${iconTone}`}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl sm:text-3xl font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-[#64748B] dark:text-[#94A3B8]">{hint}</p>}
    </Card>
  );
}

/* 2. Telecom Operator eSIM Card */
export function OperatorCard({
  name,
  prefixLabel,
  summary,
  accent,
  supplyMethodLabel,
  modeLabel = 'Available',
  hideModeBadge = false,
  onSelect,
}: {
  name: 'Ethio telecom' | 'Safaricom Ethiopia';
  prefixLabel: string;
  summary: string;
  accent: 'blue' | 'orange';
  supplyMethodLabel?: string;
  modeLabel?: string;
  hideModeBadge?: boolean;
  onSelect?: () => void;
}) {
  const isBlue = accent === 'blue';

  return (
    <Card
      variant={onSelect ? 'interactive' : 'default'}
      onClick={onSelect}
      className="flex flex-col justify-between h-full"
    >
      <div>
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span
              className={`inline-flex h-9 w-9 items-center justify-center rounded-xl shrink-0 ${
                isBlue
                  ? 'bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#60A5FA]'
                  : 'bg-[#FFF7ED] dark:bg-[#3D2316] text-[#F97316] dark:text-[#FB923C]'
              }`}
            >
              <Radio className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-[#111827] dark:text-[#F8FAFC] leading-snug">
                {name}
              </h3>
              <p className="text-xs text-[#64748B] dark:text-[#94A3B8] tabular-nums">
                {prefixLabel}
              </p>
            </div>
          </div>
          {!hideModeBadge && (
            <StatusBadge status={modeLabel.toLowerCase().includes('live') ? 'verified' : 'sandbox'} label={modeLabel} />
          )}
        </div>
        <p className="mt-4 text-sm text-[#64748B] dark:text-[#CBD5E1] leading-relaxed">{summary}</p>
        {supplyMethodLabel && (
          <p className="mt-2.5 text-xs font-medium text-[#0A2DB8] dark:text-[#60A5FA]">
            Fulfillment model: {supplyMethodLabel}
          </p>
        )}
      </div>
      <div className="mt-4 pt-3 border-t border-[#E5E7EB] dark:border-[#24344D] flex items-center justify-between gap-2 text-xs text-[#64748B] dark:text-[#94A3B8]">
        <span>Live fulfillment activates after formal operator authorization.</span>
        {onSelect && (
          <ArrowRight className="h-3.5 w-3.5 text-[#0A2DB8] dark:text-[#60A5FA] shrink-0" />
        )}
      </div>
    </Card>
  );
}

/* 3. Customer eSIM Profile Card */
export function EsimProfileCard({
  esim,
  onOpenInstall,
}: {
  esim: CustomerEsimRecord;
  onOpenInstall: (esim: CustomerEsimRecord) => void;
}) {
  const operatorLabel =
    esim.operatorCode === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia';
  const statusKind: StatusKind =
    esim.status === 'installed' || esim.status === 'activated' ? 'active' : 'verified';
  const statusLabel =
    esim.status === 'activated'
      ? 'Activated'
      : esim.status === 'installed'
        ? 'Installed'
        : 'Ready to Install';

  const supplyText: Record<SupplyMethod, string> = {
    stock_based: 'Pre-allocated Stock Profile',
    direct_api: 'Direct Operator API',
    manual_processing: 'Authorized Partner Fulfillment',
  };

  return (
    <Card variant="default" className="flex flex-col justify-between h-full">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#60A5FA] shrink-0">
              <QrCode className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] truncate">
                {operatorLabel} eSIM
              </h3>
              <p className="text-xs text-[#64748B] dark:text-[#94A3B8] tabular-nums">
                {esim.assignedMsisdn ?? 'MSISDN pending assignment'}
              </p>
            </div>
          </div>
          <StatusBadge
            status={statusKind}
            label={statusLabel}
          />
        </div>

        <div className="rounded-lg bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D] p-3 text-xs space-y-1.5">
          <div className="flex justify-between gap-2">
            <span className="text-[#64748B] dark:text-[#94A3B8]">ICCID</span>
            <span className="font-medium text-[#111827] dark:text-[#F8FAFC] tabular-nums">
              {esim.iccid ?? 'Pending'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#64748B] dark:text-[#94A3B8]">Supply Channel</span>
            <span className="font-medium text-[#111827] dark:text-[#F8FAFC]">
              {supplyText[esim.supplyMethodUsed]}
            </span>
          </div>
          {esim.deviceModel && (
            <div className="flex justify-between gap-2">
              <span className="text-[#64748B] dark:text-[#94A3B8]">Device</span>
              <span className="font-medium text-[#111827] dark:text-[#F8FAFC] truncate">
                {esim.deviceModel}
              </span>
            </div>
          )}
        </div>

      </div>

      <div className="mt-4 pt-3 border-t border-[#E5E7EB] dark:border-[#24344D]">
        <Button size="sm" className="w-full" onClick={() => onOpenInstall(esim)}>
          View QR &amp; Installation Guide
        </Button>
      </div>
    </Card>
  );
}

/* 4. Device Compatibility Card */
export function DeviceCompatibilityCard({ device }: { device: DeviceCompatibilityRecord }) {
  return (
    <Card padding="sm" variant="default" className="flex flex-col justify-between h-full">
      <div>
        <div className="flex items-start justify-between gap-2">
          <div className="flex items-center gap-2.5 min-w-0">
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#60A5FA] shrink-0">
              <Smartphone className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#0A2DB8] dark:text-[#60A5FA]">
                {device.brand} · {device.osPlatform === 'ios' ? 'iOS' : 'Android'}
              </p>
              <h3 className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
                {device.modelFamily}
              </h3>
            </div>
          </div>
          <StatusBadge
            status={device.esimSupported ? 'verified' : 'failed'}
            label={device.esimSupported ? 'eSIM Supported' : 'Physical SIM Only'}
          />
        </div>

        <p className="mt-3 text-xs text-[#64748B] dark:text-[#CBD5E1] leading-relaxed">
          {device.regionalCaveat}
        </p>
      </div>

      <div className="mt-3 pt-2.5 border-t border-[#E5E7EB] dark:border-[#24344D] flex items-center justify-between text-[11px] text-[#64748B] dark:text-[#94A3B8]">
        <span>Min OS: {device.minOsVersion}</span>
        <span>{device.dualEsimSupported ? 'Dual eSIM Ready' : 'Single Active eSIM'}</span>
      </div>
    </Card>
  );
}

export function getPhoneCompatibilityMeta(status: PhoneCompatibilityStatus) {
  if (status === 'verified_compatible') {
    return {
      label: 'Verified eSIM Compatible',
      tone: 'text-[#15803D] dark:text-[#86EFAC]',
      bgTone: 'bg-[#F0FDF4] dark:bg-[#052E16]/45 border-[#BBF7D0] dark:border-[#166534]',
      Icon: CheckCircle2,
    };
  }
  if (status === 'not_compatible') {
    return {
      label: 'Not eSIM Compatible',
      tone: 'text-[#B91C1C] dark:text-[#FCA5A5]',
      bgTone: 'bg-[#FEF2F2] dark:bg-[#450A0A]/45 border-[#FECACA] dark:border-[#991B1B]',
      Icon: XCircle,
    };
  }
  return {
    label: 'Compatibility Needs Verification',
    tone: 'text-[#B45309] dark:text-[#FCD34D]',
    bgTone: 'bg-[#FFFBEB] dark:bg-[#451A03]/45 border-[#FDE68A] dark:border-[#92400E]',
    Icon: AlertTriangle,
  };
}

/* 5. Curated eSIM Phone Storefront Card */
export function PhoneCatalogCard({
  phone,
  onOrder,
  onViewDetails,
}: {
  phone: PhoneProductRecord;
  onOrder?: (phone: PhoneProductRecord) => void;
  onViewDetails?: (phone: PhoneProductRecord) => void;
}) {
  const imageSrc = resolvePhoneImage(phone);
  const compat = getPhoneCompatibilityMeta(phone.esimCompatibilityStatus);
  const CompatIcon = compat.Icon;
  const price = phone.unitPriceEtb ?? phone.sandboxPreviewPriceEtb;
  const isOfficial = phone.unitPriceEtb !== null;
  const outOfStock = phone.stockQty <= 0;

  const unlockText =
    phone.networkUnlockStatus === 'verified_unlocked'
      ? `Factory Unlocked · ${phone.condition}`
      : phone.networkUnlockStatus === 'carrier_locked'
        ? `Carrier Locked · ${phone.condition}`
        : `Unlock Unverified · ${phone.condition}`;

  return (
    <Card
      padding="none"
      variant={onViewDetails ? 'interactive' : 'default'}
      className="group flex flex-row sm:flex-col h-full overflow-hidden"
    >
      <div
        onClick={() => onViewDetails?.(phone)}
        className={`relative w-28 sm:w-full min-h-[124px] sm:min-h-0 sm:h-36 shrink-0 overflow-hidden bg-gradient-to-br from-[#F8FAFC] via-[#EEF3FF]/60 to-[#E2E8F0] dark:from-[#0F1A2E] dark:via-[#162338] dark:to-[#0B1220] border-r sm:border-r-0 sm:border-b border-[#E5E7EB] dark:border-[#24344D] ${
          onViewDetails ? 'cursor-pointer' : ''
        }`}
      >
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={`${phone.brand} ${phone.model}`}
            referrerPolicy="no-referrer"
            className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
          />
        ) : (
          <div className="h-full w-full flex flex-col items-center justify-center gap-1 text-[#64748B] dark:text-[#94A3B8]">
            <Smartphone className="h-7 w-7 text-[#0A2DB8]/60 dark:text-[#60A5FA]/70" />
            <span className="text-[10px] font-medium px-1 text-center truncate max-w-full">
              {phone.exactModelNumber || phone.brand}
            </span>
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0 flex flex-col justify-between">
        <div className="p-2.5 sm:p-3 space-y-1">
          <div className="flex items-center justify-between gap-1.5 text-[10px] text-[#64748B] dark:text-[#94A3B8]">
            <span className="font-semibold text-[#0A2DB8] dark:text-[#60A5FA] truncate">
              {phone.brand} · {phone.exactModelNumber || phone.regionalVariant}
            </span>
            <span className="tabular-nums shrink-0 font-medium">{phone.storage}</span>
          </div>

          <h3
            onClick={() => onViewDetails?.(phone)}
            className={`text-xs sm:text-sm font-bold text-[#111827] dark:text-[#F8FAFC] leading-tight line-clamp-1 ${
              onViewDetails ? 'cursor-pointer hover:text-[#0A2DB8] dark:hover:text-[#60A5FA]' : ''
            }`}
          >
            {phone.model}
          </h3>

          <p className={`flex items-center gap-1 text-[11px] font-semibold ${compat.tone}`}>
            <CompatIcon className="h-3 w-3 shrink-0" aria-hidden="true" />
            <span className="truncate">{compat.label}</span>
          </p>

          <p className="flex items-center gap-1 text-[10px] text-[#64748B] dark:text-[#CBD5E1]">
            <Unlock
              className={`h-2.5 w-2.5 shrink-0 ${
                phone.networkUnlockStatus === 'verified_unlocked'
                  ? 'text-[#0A2DB8] dark:text-[#60A5FA]'
                  : 'text-[#94A3B8]'
              }`}
              aria-hidden="true"
            />
            <span className="truncate">{unlockText}</span>
          </p>
        </div>

        <div className="px-2.5 sm:px-3 pb-2.5 sm:pb-3 pt-1.5 sm:pt-2 border-t border-[#E5E7EB] dark:border-[#24344D] space-y-1.5">
          <div className="flex items-baseline justify-between gap-1.5">
            <div className="min-w-0">
              {price !== null ? (
                <div className="flex items-baseline gap-1 truncate">
                  <span className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums">
                    {price.toLocaleString()} ETB
                  </span>
                  {!isOfficial && (
                    <span className="text-[10px] text-[#64748B] dark:text-[#94A3B8]">Est.</span>
                  )}
                </div>
              ) : (
                <span className="text-[11px] font-semibold text-[#111827] dark:text-[#F8FAFC]">
                  Quote on Request
                </span>
              )}
            </div>
            <span className="text-[10px] text-[#64748B] dark:text-[#94A3B8] tabular-nums shrink-0">
              {outOfStock ? 'Out' : `${phone.stockQty} left`}
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {onViewDetails && (
              <Button
                size="sm"
                variant="secondary"
                className="flex-1 !px-2 !py-1 !min-h-[30px] text-[11px]"
                onClick={() => onViewDetails(phone)}
              >
                Details
              </Button>
            )}
            {onOrder && (
              <Button
                size="sm"
                className="flex-1 !px-2 !py-1 !min-h-[30px] text-[11px]"
                disabled={outOfStock}
                leftIcon={<ShoppingBag className="h-3 w-3" />}
                onClick={() => onOrder(phone)}
              >
                {outOfStock ? 'Out' : 'Add'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

/* 6. Informational & Editorial Feature Card */
export function InfoFeatureCard({
  eyebrow,
  title,
  description,
  icon,
  actionLabel,
  onAction,
  tone = 'default',
}: {
  eyebrow?: string;
  title: string;
  description: string;
  icon?: React.ReactNode;
  actionLabel?: string;
  onAction?: () => void;
  tone?: 'default' | 'highlight';
}) {
  return (
    <Card
      variant={tone === 'highlight' ? 'highlight' : 'default'}
      className="flex flex-col justify-between h-full"
    >
      <div>
        <div className="flex items-center justify-between gap-2 mb-3">
          {eyebrow ? (
            <span className="text-xs font-semibold text-[#0A2DB8] dark:text-[#60A5FA] tabular-nums">
              {eyebrow}
            </span>
          ) : (
            <span />
          )}
          {icon && (
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#60A5FA]">
              {icon}
            </span>
          )}
        </div>
        <h3 className="text-base font-semibold text-[#111827] dark:text-[#F8FAFC] leading-snug">
          {title}
        </h3>
        <p className="mt-2 text-sm text-[#64748B] dark:text-[#CBD5E1] leading-relaxed">
          {description}
        </p>
      </div>

      {actionLabel && onAction && (
        <div className="mt-4 pt-3 border-t border-[#E5E7EB] dark:border-[#24344D]">
          <Button
            variant="tertiary"
            size="sm"
            className="!px-0"
            rightIcon={<ArrowRight className="h-3.5 w-3.5" />}
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        </div>
      )}
    </Card>
  );
}

/* 7. Trust & Compliance Check Item */
export function TrustHighlightCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <Card padding="sm" variant="subtle" className="flex items-start gap-3">
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-lg bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#60A5FA] shrink-0">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC] flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-[#0A2DB8] dark:text-[#60A5FA] shrink-0" />
          <span>{title}</span>
        </h3>
        <p className="mt-1 text-xs text-[#64748B] dark:text-[#CBD5E1] leading-relaxed">
          {description}
        </p>
      </div>
    </Card>
  );
}
