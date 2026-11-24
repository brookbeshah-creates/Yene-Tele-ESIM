import React, { useState } from 'react';
import { QrCode, ShieldCheck, Smartphone } from 'lucide-react';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';
import { EmptyState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table } from '../../components/ui/Table';
import {
  DeviceCompatibilityCard,
  EsimProfileCard,
  InfoFeatureCard,
  OperatorCard,
  PhoneCatalogCard,
  SummaryMetricCard,
} from '../../components/yegna/DomainCards';
import { ThemeSwitcher } from '../../components/yegna/ThemeSwitcher';
import { OrderSummaryRow } from '../../components/yegna/TransactionRow';
import type { StatusKind } from '../../types/domain';

const ALL_STATUSES: StatusKind[] = [
  'verified',
  'active',
  'pending',
  'processing',
  'manual',
  'sandbox',
  'coming_soon',
  'failed',
  'refunded',
  'cancelled',
];

export function DesignSystemPage() {
  const [dialogOpen, setDialogOpen] = useState(false);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-12">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 pb-6 border-b border-[#E5E7EB] dark:border-[#24344D]">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-[#0A2DB8] dark:text-[#60A5FA]">
            Yene Tele Component System
          </p>
          <h1 className="mt-1 text-3xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
            Yene Tele (<span lang="am">የእኔ ቴሌኮም</span>) Design Tokens &amp; Cards
          </h1>
          <p className="mt-1.5 text-sm text-[#64748B] dark:text-[#CBD5E1] max-w-2xl">
            Preserved Royal Blue (#0A2DB8) + Crisp White + Deep Navy Dark Mode component system
            refocused around eSIM acquisition, compatibility, and partner fulfillment.
          </p>
        </div>
        <ThemeSwitcher variant="segmented" />
      </div>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Summary, Operator &amp; eSIM Profile Cards</h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <SummaryMetricCard label="Active eSIMs" value={2} hint="Ready for installation" icon={<QrCode className="h-4 w-4" />} />
          <SummaryMetricCard label="Fulfillment Engine" value="3 Models" hint="Stock · Direct API · Manual" tone="orange" icon={<ShieldCheck className="h-4 w-4" />} />
          <SummaryMetricCard label="Device Matrix" value="9+ Families" hint="iOS & Android verified" tone="neutral" icon={<Smartphone className="h-4 w-4" />} />
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <OperatorCard name="Ethio telecom" prefixLabel="+251 9xx" accent="blue" summary="Stock-based and API preview eSIM onboarding." />
          <OperatorCard name="Safaricom Ethiopia" prefixLabel="+251 7xx" accent="orange" summary="Partner-routed eSIM flow awaiting remote API." />
          <EsimProfileCard
            esim={{
              id: 'esim_ds_1',
              orderId: 'ord_ds_1',
              userId: 'usr_ds_1',
              operatorCode: 'ethio_telecom',
              assignedMsisdn: '+251900000101',
              iccid: '8925101000000000101',
              deviceModel: 'Apple iPhone 15',
              status: 'ready_for_installation',
              supplyMethodUsed: 'stock_based',
              isSandboxSimulation: true,
              activationId: 'act_ds_1',
              createdAt: new Date().toISOString(),
              installedAt: null,
              activatedAt: null,
            }}
            onOpenInstall={() => setDialogOpen(true)}
          />
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-lg font-semibold">Compatibility, Secondary Phones &amp; Order Rows</h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
          <DeviceCompatibilityCard
            device={{
              id: 'ds_dev',
              brand: 'Apple',
              modelFamily: 'iPhone 15 Series',
              osPlatform: 'ios',
              minOsVersion: 'iOS 17',
              esimSupported: true,
              dualEsimSupported: true,
              regionalCaveat: 'Mainland China units lack hardware eSIM.',
            }}
          />
          <PhoneCatalogCard
            phone={{
              id: 'ds_ph',
              brand: 'Apple',
              category: 'iphone',
              model: 'iPhone 15 (128GB)',
              exactModelNumber: 'A3090',
              regionalVariant: 'Global / Middle East Dual eSIM',
              storage: '128 GB',
              condition: 'Brand New · Sealed',
              warrantySummary: '1-Year Apple Hardware Warranty',
              esimCapable: true,
              esimCompatibilityStatus: 'verified_compatible',
              networkUnlockStatus: 'verified_unlocked',
              ethioTelecomCompatibility: 'verified',
              safaricomCompatibility: 'verified',
              compatibilityNotes: 'Verified Dual eSIM + Physical Nano-SIM hardware.',
              compatibilityEvidence: 'Apple A3090 technical specification',
              imageKey: 'iphone-15',
              imageUrl: null,
              isFeatured: true,
              unitPriceEtb: null,
              sandboxPreviewPriceEtb: 89500,
              pricingStatus: 'pending_commercial_quote',
              stockQty: 6,
              bulkMinimumQty: 5,
              supportsBulkOrder: true,
              deliveryPartner: 'klick',
              isActive: true,
              updatedAt: new Date().toISOString(),
            }}
          />
          <InfoFeatureCard
            eyebrow="Compliance"
            title="Separated KYC Consent"
            description="Firebase portal authentication stays decoupled from subscriber Fayda consent."
            actionLabel="Open Modal"
            onAction={() => setDialogOpen(true)}
          />
        </div>

        <Card>
          <CardHeader title="Order Summary Row & Status Badges" />
          <div className="flex flex-wrap gap-2 mb-4">
            {ALL_STATUSES.map((s) => (
              <StatusBadge key={s} status={s} />
            ))}
          </div>
          <OrderSummaryRow
            order={{
              id: 'ord_1',
              orderNumber: 'YN-261123-DEMO',
              idempotencyKey: null,
              userId: 'u1',
              operatorCode: 'ethio_telecom',
              productId: 'p1',
              productType: 'new_esim_line',
              supplyMethodUsed: 'stock_based',
              deviceModel: 'iPhone 15',
              deviceOs: 'ios',
              deviceVerified: true,
              selectedNumberTier: 'standard',
              reservedMsisdn: '+251900000101',
              existingMsisdn: null,
              assignedStockItemId: 'stk1',
              reservedUntil: null,
              numberReservationConfirmed: true,
              kycStatus: 'verified_sandbox',
              paymentStatus: 'verified',
              provisioningStatus: 'provisioned',
              deliveryStatus: 'delivered',
              operatorTransactionRef: 'STK-DEMO-1',
              amountEtb: 150,
              isSandboxPricing: true,
              attributedAgentId: null,
              agentReferralCode: null,
              status: 'ready_for_installation',
              failureReason: null,
              updateHistory: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }}
          />
        </Card>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <Input label="Search Models" inputKind="search" placeholder="iPhone 15" />
          <EmptyState title="Clean Empty State" description="Consistent spacing across Light and Dark themes." />
        </div>

        <Table
          rows={[{ id: '1', op: 'Ethio telecom', supply: 'stock_based', status: 'verified' as StatusKind }]}
          getRowKey={(r) => r.id}
          columns={[
            { key: 'op', header: 'Operator', render: (r) => r.op },
            { key: 'supply', header: 'Supply Mode', render: (r) => r.supply },
            { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]}
        />
      </section>

      <Alert tone="info">Yene Tele visual tokens preserved cleanly across Light &amp; Dark themes.</Alert>

      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        title="Dialog Preview"
        footer={<Button onClick={() => setDialogOpen(false)}>Close</Button>}
      >
        <p className="text-sm text-[#64748B]">Consistent modal rendering verified.</p>
      </Dialog>
    </div>
  );
}
