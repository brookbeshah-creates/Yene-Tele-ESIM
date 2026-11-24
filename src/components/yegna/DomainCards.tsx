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
      ? 'bg-[#FEF7E0] dark:bg-[#3D2316] text-[#EA8600] dark:text-[#FB923C]'
      : tone === 'neutral'
        ? 'bg-[#F1F3F4] dark:bg-[#1C2D45] text-[#5F6368] dark:text-[#CBD5E1]'
        : 'bg-[#E8F0FE] dark:bg-[#13254A] text-[#1A73E8] dark:text-[#60A5FA]';

  return (
    <Card padding="sm" variant="default" className="flex flex-col justify-between h-full">
      <div className="flex items-start justify-between gap-3">
        <span className="text-xs font-medium text-[#5F6368] dark:text-[#CBD5E1]">{label}</span>
        {icon && (
          <span
            className={`inline-flex h-8 w-8 items-center justify-center rounded-xl shrink-0 ${iconTone}`}
          >
            {icon}
          </span>
        )}
      </div>
      <p className="mt-3 text-2xl sm:text-3xl font-bold text-[#202124] dark:text-[#F8FAFC] tabular-nums tracking-tight">
        {value}
      </p>
      {hint && <p className="mt-1.5 text-xs text-[#5F6368] dark:text-[#94A3B8]">{hint}</p>}
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
                  ? 'bg-[#E8F0FE] dark:bg-[#13254A] text-[#1A73E8] dark:text-[#60A5FA]'
                  : 'bg-[#E6F4EA] dark:bg-[#143322] text-[#188038] dark:text-[#4ADE80]'
              }`}
            >
              <Radio className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-base font-semibold text-[#202124] dark:text-[#F8FAFC] leading-snug">
                {name}
              </h3>
              <p className="text-xs text-[#5F6368] dark:text-[#94A3B8] tabular-nums">
                {prefixLabel}
              </p>
            </div>
          </div>
          {!hideModeBadge && (
            <StatusBadge status={modeLabel.toLowerCase().includes('live') ? 'verified' : 'sandbox'} label={modeLabel} />
          )}
        </div>
        <p className="mt-4 text-sm text-[#5F6368] dark:text-[#CBD5E1] leading-relaxed">{summary}</p>
        {supplyMethodLabel && (
          <p className="mt-2.5 text-xs font-medium text-[#1A73E8] dark:text-[#60A5FA]">
            Fulfillment model: {supplyMethodLabel}
          </p>
        )}
      </div>
      <div className="mt-4 pt-3 border-t border-[#DADCE0] dark:border-[#24344D] flex items-center justify-between gap-2 text-xs text-[#5F6368] dark:text-[#94A3B8]">
        <span>Live fulfillment activates after formal operator authorization.</span>
        {onSelect && (
          <ArrowRight className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#60A5FA] shrink-0" />
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
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#E8F0FE] dark:bg-[#13254A] text-[#1A73E8] dark:text-[#60A5FA] shrink-0">
              <QrCode className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-[#202124] dark:text-[#F8FAFC] truncate">
                {operatorLabel} eSIM
              </h3>
              <p className="text-xs text-[#5F6368] dark:text-[#94A3B8] tabular-nums">
                {esim.assignedMsisdn ?? 'MSISDN pending assignment'}
              </p>
            </div>
          </div>
          <StatusBadge
            status={statusKind}
            label={statusLabel}
          />
        </div>

        <div className="rounded-xl bg-[#F8FAFD] dark:bg-[#111C2E] border border-[#DADCE0] dark:border-[#24344D] p-3 text-xs space-y-1.5">
          <div className="flex justify-between gap-2">
            <span className="text-[#5F6368] dark:text-[#94A3B8]">ICCID</span>
            <span className="font-medium text-[#202124] dark:text-[#F8FAFC] tabular-nums">
              {esim.iccid ?? 'Pending'}
            </span>
          </div>
          <div className="flex justify-between gap-2">
            <span className="text-[#5F6368] dark:text-[#94A3B8]">Supply Channel</span>
            <span className="font-medium text-[#202124] dark:text-[#F8FAFC]">
              {supplyText[esim.supplyMethodUsed]}
            </span>
          </div>
          {esim.deviceModel && (
            <div className="flex justify-between gap-2">
              <span className="text-[#5F6368] dark:text-[#94A3B8]">Device</span>
              <span className="font-medium text-[#202124] dark:text-[#F8FAFC] truncate">
                {esim.deviceModel}
              </span>
            </div>
          )}
        </div>

      </div>

      <div className="mt-4 pt-3 border-t border-[#DADCE0] dark:border-[#24344D]">
        <Button size="sm" className="w-full rounded-full" onClick={() => onOpenInstall(esim)}>
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
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#E8F0FE] dark:bg-[#13254A] text-[#1A73E8] dark:text-[#60A5FA] shrink-0">
              <Smartphone className="h-4 w-4" aria-hidden="true" />
            </span>
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[#1A73E8] dark:text-[#60A5FA]">
                {device.brand} · {device.osPlatform === 'ios' ? 'iOS' : 'Android'}
              </p>
              <h3 className="text-sm font-semibold text-[#202124] dark:text-[#F8FAFC]">
                {device.modelFamily}
              </h3>
            </div>
          </div>
          <StatusBadge
            status={device.esimSupported ? 'verified' : 'failed'}
            label={device.esimSupported ? 'eSIM Supported' : 'Physical SIM Only'}
          />
        </div>

        <p className="mt-3 text-xs text-[#5F6368] dark:text-[#CBD5E1] leading-relaxed">
          {device.regionalCaveat}
        </p>
      </div>

      <div className="mt-3 pt-2.5 border-t border-[#DADCE0] dark:border-[#24344D] flex items-center justify-between text-[11px] text-[#5F6368] dark:text-[#94A3B8]">
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
  const outOfStock = phone.stockQty <= 0;

  const shortCompatLabel =
    phone.esimCompatibilityStatus === 'verified_compatible'
      ? 'Verified eSIM'
      : phone.esimCompatibilityStatus === 'not_compatible'
        ? 'Not Compatible'
        : 'Needs Verification';

  return (
    <Card
      padding="none"
      variant={onViewDetails ? 'interactive' : 'default'}
      className="group flex flex-col justify-between h-full overflow-hidden rounded-2xl border-[#DADCE0] dark:border-[#24344D]"
    >
      <div>
        <div
          onClick={() => onViewDetails?.(phone)}
          className={`relative w-full h-32 sm:h-36 overflow-hidden bg-[#F8FAFD] dark:bg-[#0F1A2E] border-b border-[#DADCE0] dark:border-[#24344D] ${
            onViewDetails ? 'cursor-pointer' : ''
          }`}
        >
          {imageSrc ? (
            <img
              src={imageSrc}
              alt={`${phone.brand} ${phone.model}`}
              referrerPolicy="no-referrer"
              loading="lazy"
              className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]"
            />
          ) : (
            <div className="h-full w-full flex flex-col items-center justify-center gap-1 text-[#5F6368] dark:text-[#94A3B8]">
              <Smartphone className="h-7 w-7 text-[#1A73E8]/60 dark:text-[#60A5FA]/70" />
              <span className="text-[11px] font-medium px-2 text-center truncate max-w-full">
                {phone.exactModelNumber || phone.brand}
              </span>
            </div>
          )}
        </div>

        <div className="p-3 space-y-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px] text-[#5F6368] dark:text-[#94A3B8]">
            <span className="font-semibold text-[#1A73E8] dark:text-[#60A5FA] truncate">
              {phone.brand} · {phone.exactModelNumber || phone.regionalVariant}
            </span>
          </div>

          <h3
            onClick={() => onViewDetails?.(phone)}
            className={`text-sm font-bold text-[#202124] dark:text-[#F8FAFC] leading-snug truncate ${
              onViewDetails ? 'cursor-pointer hover:text-[#1A73E8] dark:hover:text-[#60A5FA]' : ''
            }`}
          >
            {phone.model}
          </h3>

          <p className="text-xs text-[#5F6368] dark:text-[#CBD5E1] truncate tabular-nums">
            {phone.storage} · {phone.condition}
          </p>

          <div className="pt-0.5 flex items-center gap-1.5 text-[11px] font-semibold">
            <CompatIcon className={`h-3.5 w-3.5 shrink-0 ${compat.tone}`} aria-hidden="true" />
            <span className={`truncate ${compat.tone}`}>{shortCompatLabel}</span>
          </div>
        </div>
      </div>

      <div className="px-3 pb-3 pt-2 border-t border-[#DADCE0] dark:border-[#24344D] space-y-2">
        <div className="flex items-baseline justify-between gap-2">
          <span className="text-sm font-bold text-[#202124] dark:text-[#F8FAFC] tabular-nums truncate">
            {price !== null ? `${price.toLocaleString()} ETB` : 'Quote on Request'}
          </span>
          <span className="text-[11px] text-[#5F6368] dark:text-[#94A3B8] tabular-nums shrink-0">
            {outOfStock ? 'Out of stock' : `${phone.stockQty} left`}
          </span>
        </div>

        <div className="grid grid-cols-2 gap-1.5">
          {onViewDetails && (
            <Button
              size="sm"
              variant="secondary"
              className="w-full !px-2 !min-h-[38px] text-xs rounded-full"
              onClick={() => onViewDetails(phone)}
            >
              Details
            </Button>
          )}
          {onOrder && (
            <Button
              size="sm"
              className={`w-full !px-2 !min-h-[38px] text-xs rounded-full ${
                !onViewDetails ? 'col-span-2' : ''
              }`}
              disabled={outOfStock}
              leftIcon={<ShoppingBag className="h-3.5 w-3.5" />}
              onClick={() => onOrder(phone)}
            >
              {outOfStock ? 'Out' : 'Add'}
            </Button>
          )}
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
            <span className="text-xs font-semibold text-[#1A73E8] dark:text-[#60A5FA] tabular-nums">
              {eyebrow}
            </span>
          ) : (
            <span />
          )}
          {icon && (
            <span className="inline-flex h-9 w-9 items-center justify-center rounded-xl bg-[#E8F0FE] dark:bg-[#13254A] text-[#1A73E8] dark:text-[#60A5FA]">
              {icon}
            </span>
          )}
        </div>
        <h3 className="text-base font-semibold text-[#202124] dark:text-[#F8FAFC] leading-snug">
          {title}
        </h3>
        <p className="mt-2 text-sm text-[#5F6368] dark:text-[#CBD5E1] leading-relaxed">
          {description}
        </p>
      </div>

      {actionLabel && onAction && (
        <div className="mt-4 pt-3 border-t border-[#DADCE0] dark:border-[#24344D]">
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
      <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl bg-[#E8F0FE] dark:bg-[#13254A] text-[#1A73E8] dark:text-[#60A5FA] shrink-0">
        <ShieldCheck className="h-4 w-4" aria-hidden="true" />
      </span>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-[#202124] dark:text-[#F8FAFC] flex items-center gap-1.5">
          <CheckCircle2 className="h-3.5 w-3.5 text-[#1A73E8] dark:text-[#60A5FA] shrink-0" />
          <span>{title}</span>
        </h3>
        <p className="mt-1 text-xs text-[#5F6368] dark:text-[#CBD5E1] leading-relaxed">
          {description}
        </p>
      </div>
    </Card>
  );
}
