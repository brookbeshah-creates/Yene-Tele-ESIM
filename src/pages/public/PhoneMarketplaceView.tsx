import React, { useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  CheckCircle2,
  CreditCard,
  Minus,
  Phone,
  Plus,
  Search,
  ShieldCheck,
  ShoppingBag,
  Smartphone,
  Trash2,
  Truck,
  Unlock,
  X,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { usePhoneCart } from '../../contexts/PhoneCartContext';
import { apiRequest } from '../../lib/apiClient';
import { resolvePhoneImage } from '../../lib/phoneAssets';
import { useRouter } from '../../router/RouterContext';
import type {
  OperatorCode,
  PhoneCategory,
  PhoneCompatibilityStatus,
  PhoneOrderRecord,
  PhoneProductRecord,
} from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Input';
import { EmptyState, LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { AnimatedAtmosphere } from '../../components/yegna/AnimatedAtmosphere';
import { getPhoneCompatibilityMeta, PhoneCatalogCard } from '../../components/yegna/DomainCards';

const CATEGORY_TABS: Array<{ id: PhoneCategory | 'all' | 'featured'; label: string }> = [
  { id: 'all', label: 'All Devices' },
  { id: 'featured', label: 'Featured' },
  { id: 'iphone', label: 'iPhone' },
  { id: 'samsung_galaxy', label: 'Samsung Galaxy' },
  { id: 'google_pixel', label: 'Google Pixel' },
];

type SortOrder = 'featured' | 'price_asc' | 'price_desc';

interface PendingCheckoutItem {
  order: PhoneOrderRecord;
  txRef: string | null;
  checkoutUrl: string | null;
  isLiveRedirect: boolean;
}

function formatOperatorReadiness(status: PhoneProductRecord['ethioTelecomCompatibility']) {
  if (status === 'verified') return { label: 'Verified Ready', kind: 'verified' as const };
  if (status === 'not_compatible') return { label: 'Not Compatible', kind: 'failed' as const };
  return { label: 'Needs Check', kind: 'pending' as const };
}

function formatUnlockLabel(status: PhoneProductRecord['networkUnlockStatus']) {
  if (status === 'verified_unlocked') return 'Verified Factory Network Unlocked';
  if (status === 'carrier_locked') return 'Carrier Locked';
  return 'Unlock Status Needs Verification';
}

export function PhoneMarketplaceView({
  mode,
}: {
  mode: 'public' | 'customer';
}) {
  const { firebaseUser, profile } = useAuth();
  const { pathname, navigate } = useRouter();
  const {
    items: bagItems,
    drawerOpen,
    setDrawerOpen,
    addItem,
    updateItemQty,
    updateItemOrderKind,
    updateItemPairedEsim,
    removeItem,
    clearBag,
    totalUnits,
  } = usePhoneCart();

  const [phones, setPhones] = useState<PhoneProductRecord[]>([]);
  const [orders, setOrders] = useState<PhoneOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<PhoneCategory | 'all' | 'featured'>('all');
  const [compatFilter, setCompatFilter] = useState<PhoneCompatibilityStatus | 'all'>('all');
  const [unlockedOnly, setUnlockedOnly] = useState(false);
  const [sortOrder, setSortOrder] = useState<SortOrder>('featured');

  // Product Detail state derived cleanly from URL `/phones/:id` or `/app/phones/:id`
  const basePath = mode === 'customer' ? '/app/phones' : '/phones';
  const activePhoneId = useMemo(() => {
    if (pathname.startsWith('/app/phones/')) {
      return decodeURIComponent(pathname.slice('/app/phones/'.length));
    }
    if (pathname.startsWith('/phones/')) {
      return decodeURIComponent(pathname.slice('/phones/'.length));
    }
    return null;
  }, [pathname]);

  const [pdpOrderKind, setPdpOrderKind] = useState<'individual' | 'bulk_business'>('individual');
  const [pdpQty, setPdpQty] = useState(1);
  const [pdpPairEsim, setPdpPairEsim] = useState(false);
  const [pdpPairOperator, setPdpPairOperator] = useState<OperatorCode>('ethio_telecom');

  // Checkout Bag Form State
  const [contactPhone, setContactPhone] = useState(profile?.user.phoneNumber ?? '+2519');
  const [deliveryCity, setDeliveryCity] = useState('Addis Ababa');
  const [deliveryAddress, setDeliveryAddress] = useState('');
  const [deliveryNotes, setDeliveryNotes] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [checkoutBusy, setCheckoutBusy] = useState(false);
  const [checkoutError, setCheckoutError] = useState<string | null>(null);
  const [pendingCheckouts, setPendingCheckouts] = useState<PendingCheckoutItem[]>([]);
  const [completedOrders, setCompletedOrders] = useState<PhoneOrderRecord[]>([]);

  useEffect(() => {
    if (profile?.user.phoneNumber && (contactPhone === '+2519' || !contactPhone.trim())) {
      setContactPhone(profile.user.phoneNumber);
    }
  }, [profile?.user.phoneNumber]);

  const loadCatalogAndOrders = async () => {
    try {
      const reqs: [
        Promise<{ phones: PhoneProductRecord[] }>,
        Promise<{ orders: PhoneOrderRecord[] }> | null,
      ] = [
        apiRequest<{ phones: PhoneProductRecord[] }>('/api/v1/phones', { requireAuth: false }),
        firebaseUser
          ? apiRequest<{ orders: PhoneOrderRecord[] }>('/api/v1/phones/orders')
          : null,
      ];
      const [phonesRes, ordersRes] = await Promise.all([reqs[0], reqs[1]]);
      setPhones(phonesRes.phones);
      if (ordersRes) {
        setOrders(ordersRes.orders);
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadCatalogAndOrders();
  }, [firebaseUser?.uid]);

  const activePhone = useMemo(
    () => (activePhoneId ? phones.find((p) => p.id === activePhoneId) ?? null : null),
    [phones, activePhoneId],
  );

  useEffect(() => {
    if (activePhone) {
      setPdpOrderKind('individual');
      setPdpQty(1);
      setPdpPairEsim(activePhone.esimCompatibilityStatus === 'verified_compatible');
      setPdpPairOperator(
        activePhone.ethioTelecomCompatibility === 'verified'
          ? 'ethio_telecom'
          : 'safaricom_ethiopia',
      );
    }
  }, [activePhone?.id]);

  const filteredPhones = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = phones.filter((p) => {
      if (categoryFilter === 'featured' && !p.isFeatured) return false;
      if (categoryFilter !== 'all' && categoryFilter !== 'featured' && p.category !== categoryFilter) {
        return false;
      }
      if (compatFilter !== 'all' && p.esimCompatibilityStatus !== compatFilter) return false;
      if (unlockedOnly && p.networkUnlockStatus !== 'verified_unlocked') return false;
      if (q) {
        const hay = `${p.brand} ${p.model} ${p.exactModelNumber} ${p.regionalVariant} ${p.storage}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortOrder === 'price_asc') {
      return [...list].sort(
        (a, b) =>
          (a.unitPriceEtb ?? a.sandboxPreviewPriceEtb ?? Number.MAX_SAFE_INTEGER) -
          (b.unitPriceEtb ?? b.sandboxPreviewPriceEtb ?? Number.MAX_SAFE_INTEGER),
      );
    }
    if (sortOrder === 'price_desc') {
      return [...list].sort(
        (a, b) =>
          (b.unitPriceEtb ?? b.sandboxPreviewPriceEtb ?? 0) -
          (a.unitPriceEtb ?? a.sandboxPreviewPriceEtb ?? 0),
      );
    }
    return list;
  }, [phones, searchQuery, categoryFilter, compatFilter, unlockedOnly, sortOrder]);

  const hasBulkItem = bagItems.some((item) => item.orderKind === 'bulk_business');
  const bagSubtotalEtb = bagItems.reduce((sum, item) => {
    const unit = item.unitPriceEtb ?? item.sandboxPreviewPriceEtb ?? 0;
    return sum + unit * item.quantity;
  }, 0);
  const bagHasEstimate = bagItems.some((item) => item.unitPriceEtb === null);

  const openPdp = (phone: PhoneProductRecord) => {
    navigate(`${basePath}/${encodeURIComponent(phone.id)}`);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handlePlaceBagOrderAndInitPayment = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!firebaseUser) {
      navigate(`/login?redirect=${encodeURIComponent(pathname)}`);
      return;
    }
    if (bagItems.length === 0) return;

    const cleanPhone = contactPhone.trim();
    const cleanCity = deliveryCity.trim();
    const cleanAddress = deliveryAddress.trim();

    if (!cleanPhone || cleanPhone.length < 9) {
      setCheckoutError('Please provide your active Ethiopian contact phone number for delivery.');
      return;
    }
    if (!cleanCity || !cleanAddress) {
      setCheckoutError('Please provide your delivery city and street/sub-city address.');
      return;
    }
    if (hasBulkItem && !companyName.trim()) {
      setCheckoutError('Organization / company name is required for bulk device orders.');
      return;
    }

    setCheckoutBusy(true);
    setCheckoutError(null);
    setCompletedOrders([]);

    try {
      const createdQueue: PendingCheckoutItem[] = [];
      const immediateDone: PhoneOrderRecord[] = [];

      for (const item of bagItems) {
        const orderRes = await apiRequest<{ order: PhoneOrderRecord }>('/api/v1/phones/orders', {
          method: 'POST',
          body: {
            phoneProductId: item.phoneProductId,
            orderKind: item.orderKind,
            quantity: item.quantity,
            companyName: item.orderKind === 'bulk_business' ? companyName.trim() : undefined,
            contactPhone: cleanPhone,
            deliveryCity: cleanCity,
            deliveryAddress: cleanAddress,
            deliveryNotes: deliveryNotes.trim() || undefined,
            pairedEsimOperator: item.pairedEsimOperator,
          },
        });

        const created = orderRes.order;
        if (created.estimatedTotalEtb > 0) {
          const checkoutRes = await apiRequest<{
            order: PhoneOrderRecord;
            payment: { txRef: string };
            checkoutUrl: string;
          }>(`/api/v1/phones/orders/${created.id}/checkout`, {
            method: 'POST',
            body: { returnUrl: basePath },
          });
          const isLiveHttps =
            /^https:\/\//i.test(checkoutRes.checkoutUrl) &&
            !checkoutRes.checkoutUrl.includes('chapa_sandbox_tx=');
          createdQueue.push({
            order: checkoutRes.order,
            txRef: checkoutRes.payment.txRef,
            checkoutUrl: checkoutRes.checkoutUrl,
            isLiveRedirect: isLiveHttps,
          });
        } else {
          immediateDone.push(created);
        }
      }

      clearBag();
      setPendingCheckouts(createdQueue);
      if (immediateDone.length > 0) {
        setCompletedOrders(immediateDone);
      }
      await loadCatalogAndOrders();
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Unable to submit your phone order.');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleVerifyPendingPayment = async (entry: PendingCheckoutItem) => {
    if (!entry.txRef) return;
    setCheckoutBusy(true);
    setCheckoutError(null);
    try {
      const res = await apiRequest<{ order: PhoneOrderRecord; verified: boolean }>(
        `/api/v1/phones/orders/${entry.order.id}/verify-payment`,
        {
          method: 'POST',
          body: { txRef: entry.txRef },
        },
      );
      if (res.verified) {
        setPendingCheckouts((prev) => prev.filter((p) => p.order.id !== entry.order.id));
        setCompletedOrders((prev) => [...prev, res.order]);
        await loadCatalogAndOrders();
      }
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Payment verification did not complete.');
    } finally {
      setCheckoutBusy(false);
    }
  };

  const handleResumeOrderCheckout = async (order: PhoneOrderRecord) => {
    setCheckoutError(null);
    setDrawerOpen(true);
    if (order.paymentReference) {
      const isLiveHttps =
        Boolean(order.checkoutUrl) &&
        /^https:\/\//i.test(order.checkoutUrl!) &&
        !order.checkoutUrl!.includes('chapa_sandbox_tx=');
      setPendingCheckouts([
        {
          order,
          txRef: order.paymentReference,
          checkoutUrl: order.checkoutUrl,
          isLiveRedirect: isLiveHttps,
        },
      ]);
      return;
    }
    setCheckoutBusy(true);
    try {
      const checkoutRes = await apiRequest<{
        order: PhoneOrderRecord;
        payment: { txRef: string };
        checkoutUrl: string;
      }>(`/api/v1/phones/orders/${order.id}/checkout`, {
        method: 'POST',
        body: { returnUrl: basePath },
      });
      const isLiveHttps =
        /^https:\/\//i.test(checkoutRes.checkoutUrl) &&
        !checkoutRes.checkoutUrl.includes('chapa_sandbox_tx=');
      setPendingCheckouts([
        {
          order: checkoutRes.order,
          txRef: checkoutRes.payment.txRef,
          checkoutUrl: checkoutRes.checkoutUrl,
          isLiveRedirect: isLiveHttps,
        },
      ]);
    } catch (err) {
      setCheckoutError(err instanceof Error ? err.message : 'Unable to start Chapa checkout.');
    } finally {
      setCheckoutBusy(false);
    }
  };

  if (loading) {
    return <LoadingState message="Loading curated eSIM-ready devices..." />;
  }

  return (
    <div className="space-y-3 sm:space-y-4 pb-8">
      {/* Compact Store Detail Banner (Mobile-First Zemen-Style Storefront Header) */}
      <section className="relative overflow-hidden border-b border-[#E5E7EB] dark:border-[#24344D] bg-gradient-to-b from-[#EEF3FF]/75 via-white to-[#F8FAFC] dark:from-[#0E1A35] dark:via-[#111C2E] dark:to-[#0B1220]">
        <AnimatedAtmosphere variant="subtle" />

        <div className="relative z-10 max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 py-2.5 sm:py-3.5 flex items-center justify-between gap-2.5">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="h-9 w-9 sm:h-10 sm:w-10 rounded-xl bg-[#0A2DB8] text-white flex items-center justify-center shrink-0 shadow-xs">
              <Smartphone className="h-4.5 w-4.5" aria-hidden="true" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-1.5">
                <h1 className="text-sm sm:text-lg font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC] truncate">
                  Yene Tele Device Store
                </h1>
                <ShieldCheck
                  className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-[#0A2DB8] dark:text-[#60A5FA] shrink-0"
                  aria-label="Verified eSIM Device Store"
                />
              </div>
              <p className="text-[11px] sm:text-xs text-[#64748B] dark:text-[#CBD5E1] truncate">
                Verified eSIM phones · Exact model check · Klick Delivery
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <Button
              size="sm"
              variant="secondary"
              className="!px-2.5 !py-1.5 !min-h-[34px] text-xs"
              onClick={() => navigate(mode === 'customer' ? '/app' : '/buy-esim')}
            >
              ← eSIMs
            </Button>
            <Button
              size="sm"
              className="!px-2.5 !py-1.5 !min-h-[34px] text-xs"
              leftIcon={<ShoppingBag className="h-3.5 w-3.5" />}
              onClick={() => setDrawerOpen(true)}
            >
              Bag ({totalUnits})
            </Button>
          </div>
        </div>
      </section>

      {/* Main Content Container */}
      <div className="product-marketplace-container max-w-7xl mx-auto px-3 sm:px-6 lg:px-8 space-y-3.5">
        {activePhone ? (
          /* ------------------------------------------------------------------
           * PRODUCT DETAIL PAGE (PDP)
           * ------------------------------------------------------------------ */
          <div className="space-y-6">
            <button
              type="button"
              onClick={() => navigate(basePath)}
              className="inline-flex items-center gap-1.5 text-sm font-semibold text-[#0A2DB8] dark:text-[#60A5FA] hover:underline cursor-pointer"
            >
              <ArrowLeft className="h-4 w-4" />
              Back to all devices
            </button>

            <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
              {/* Left 7 Columns: Studio Photo + Specs & Verified Compatibility Matrix */}
              <div className="lg:col-span-7 space-y-6">
                <Card padding="none" className="overflow-hidden">
                  <div className="aspect-[4/3] w-full bg-gradient-to-br from-[#F8FAFC] via-[#EEF3FF]/60 to-[#E2E8F0] dark:from-[#0F1A2E] dark:via-[#162338] dark:to-[#0B1220]">
                    {resolvePhoneImage(activePhone) ? (
                      <img
                        src={resolvePhoneImage(activePhone)!}
                        alt={`${activePhone.brand} ${activePhone.model}`}
                        referrerPolicy="no-referrer"
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <div className="h-full w-full flex flex-col items-center justify-center gap-2 text-[#64748B]">
                        <Smartphone className="h-14 w-14 text-[#0A2DB8]/60" />
                        <span className="text-sm font-medium">{activePhone.model}</span>
                      </div>
                    )}
                  </div>
                </Card>

                {/* Exact Hardware & eSIM Compatibility Breakdown */}
                <Card className="space-y-5">
                  <div>
                    <h2 className="text-lg font-bold text-[#111827] dark:text-[#F8FAFC]">
                      eSIM Compatibility &amp; Model Verification
                    </h2>
                    <p className="text-xs text-[#64748B] dark:text-[#CBD5E1] mt-1">
                      Checked against exact hardware model number and regional variant rather than
                      model family assumptions.
                    </p>
                  </div>

                  {(() => {
                    const compat = getPhoneCompatibilityMeta(activePhone.esimCompatibilityStatus);
                    const Icon = compat.Icon;
                    return (
                      <div className={`rounded-xl border p-4 space-y-2 ${compat.bgTone}`}>
                        <p className={`inline-flex items-center gap-2 text-sm font-bold ${compat.tone}`}>
                          <Icon className="h-4 w-4 shrink-0" />
                          <span>{compat.label}</span>
                        </p>
                        <p className="text-xs sm:text-sm text-[#111827] dark:text-[#F8FAFC] leading-relaxed">
                          {activePhone.compatibilityNotes}
                        </p>
                        {activePhone.compatibilityEvidence && (
                          <p className="text-xs text-[#475569] dark:text-[#CBD5E1]">
                            <strong>Verification reference:</strong> {activePhone.compatibilityEvidence}
                          </p>
                        )}
                      </div>
                    );
                  })()}

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
                    <div className="p-3.5 rounded-xl border border-[#E5E7EB] dark:border-[#24344D] bg-[#F8FAFC] dark:bg-[#111C2E] flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#64748B] dark:text-[#CBD5E1]">
                        Ethio telecom eSIM
                      </span>
                      <StatusBadge
                        status={formatOperatorReadiness(activePhone.ethioTelecomCompatibility).kind}
                        label={formatOperatorReadiness(activePhone.ethioTelecomCompatibility).label}
                      />
                    </div>
                    <div className="p-3.5 rounded-xl border border-[#E5E7EB] dark:border-[#24344D] bg-[#F8FAFC] dark:bg-[#111C2E] flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-[#64748B] dark:text-[#CBD5E1]">
                        Safaricom Ethiopia eSIM
                      </span>
                      <StatusBadge
                        status={formatOperatorReadiness(activePhone.safaricomCompatibility).kind}
                        label={formatOperatorReadiness(activePhone.safaricomCompatibility).label}
                      />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 pt-2 border-t border-[#E5E7EB] dark:border-[#24344D] text-xs">
                    <div>
                      <p className="text-[#64748B] dark:text-[#94A3B8]">Model Number</p>
                      <p className="font-semibold text-[#111827] dark:text-[#F8FAFC] mt-0.5 tabular-nums">
                        {activePhone.exactModelNumber || 'Pending'}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#64748B] dark:text-[#94A3B8]">Regional Variant</p>
                      <p className="font-semibold text-[#111827] dark:text-[#F8FAFC] mt-0.5">
                        {activePhone.regionalVariant}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#64748B] dark:text-[#94A3B8]">Condition</p>
                      <p className="font-semibold text-[#111827] dark:text-[#F8FAFC] mt-0.5">
                        {activePhone.condition}
                      </p>
                    </div>
                    <div>
                      <p className="text-[#64748B] dark:text-[#94A3B8]">Warranty</p>
                      <p className="font-semibold text-[#111827] dark:text-[#F8FAFC] mt-0.5">
                        {activePhone.warrantySummary}
                      </p>
                    </div>
                  </div>
                </Card>
              </div>

              {/* Right 5 Columns: Sticky Purchase Module */}
              <div className="lg:col-span-5 lg:sticky lg:top-20">
                <Card className="space-y-5">
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-[#0A2DB8] dark:text-[#60A5FA]">
                      {activePhone.brand} · {activePhone.storage} · {activePhone.exactModelNumber}
                    </p>
                    <h2 className="text-2xl font-bold text-[#111827] dark:text-[#F8FAFC]">
                      {activePhone.model}
                    </h2>
                    <p className="inline-flex items-center gap-1.5 text-xs text-[#475569] dark:text-[#CBD5E1]">
                      <Unlock className="h-3.5 w-3.5 text-[#0A2DB8] dark:text-[#60A5FA]" />
                      {formatUnlockLabel(activePhone.networkUnlockStatus)}
                    </p>
                  </div>

                  <div className="p-4 rounded-xl bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D]">
                    {activePhone.unitPriceEtb !== null ? (
                      <div>
                        <p className="text-2xl font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums">
                          {activePhone.unitPriceEtb.toLocaleString()} ETB
                        </p>
                        <p className="text-xs text-[#15803D] dark:text-[#86EFAC] mt-0.5">
                          Official verified store price · Chapa checkout enabled
                        </p>
                      </div>
                    ) : activePhone.sandboxPreviewPriceEtb !== null ? (
                      <div>
                        <p className="text-2xl font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums">
                          {activePhone.sandboxPreviewPriceEtb.toLocaleString()} ETB
                        </p>
                        <p className="text-xs text-[#64748B] dark:text-[#94A3B8] mt-0.5">
                          Commercial price subject to supplier quote confirmation
                        </p>
                      </div>
                    ) : (
                      <p className="text-sm font-semibold">Commercial quote upon order review</p>
                    )}
                    <p className="text-xs text-[#64748B] dark:text-[#94A3B8] mt-2 tabular-nums">
                      Stock: <strong>{activePhone.stockQty}</strong> unit(s) ready · Bulk orders from{' '}
                      {activePhone.bulkMinimumQty} units
                    </p>
                  </div>

                  {activePhone.supportsBulkOrder && (
                    <div className="grid grid-cols-2 gap-2">
                      {(['individual', 'bulk_business'] as const).map((k) => (
                        <button
                          key={k}
                          type="button"
                          onClick={() => {
                            setPdpOrderKind(k);
                            if (k === 'bulk_business' && pdpQty < activePhone.bulkMinimumQty) {
                              setPdpQty(Math.min(activePhone.stockQty, activePhone.bulkMinimumQty));
                            }
                          }}
                          className={`py-2 px-3 rounded-lg border text-xs font-semibold cursor-pointer ${
                            pdpOrderKind === k
                              ? 'border-[#0A2DB8] bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#60A5FA]'
                              : 'border-[#E5E7EB] dark:border-[#24344D] text-[#64748B] dark:text-[#CBD5E1]'
                          }`}
                        >
                          {k === 'individual'
                            ? 'Personal Purchase'
                            : `Bulk Business (${activePhone.bulkMinimumQty}+)`}
                        </button>
                      ))}
                    </div>
                  )}

                  <Input
                    label="Quantity"
                    type="number"
                    min={pdpOrderKind === 'bulk_business' ? activePhone.bulkMinimumQty : 1}
                    max={Math.max(1, activePhone.stockQty)}
                    value={pdpQty}
                    onChange={(e) => setPdpQty(Math.max(1, Number(e.target.value) || 1))}
                  />

                  {activePhone.esimCompatibilityStatus !== 'not_compatible' ? (
                    <div className="p-3.5 rounded-xl border border-[#C7D6FE] dark:border-[#2B4C8C] bg-[#EEF3FF]/60 dark:bg-[#13254A]/60 space-y-2.5">
                      <label className="flex items-start gap-2.5 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={pdpPairEsim}
                          onChange={(e) => setPdpPairEsim(e.target.checked)}
                          className="mt-0.5 h-4 w-4 rounded border-[#D1D5DB] text-[#0A2DB8]"
                        />
                        <span className="text-xs leading-relaxed">
                          <strong className="text-[#111827] dark:text-[#F8FAFC] block">
                            Pair with an Ethiopian eSIM after checkout
                          </strong>
                          <span className="text-[#64748B] dark:text-[#CBD5E1]">
                            Keep your eSIM activation cleanly linked while device delivery &amp;
                            subscriber Fayda KYC remain separate.
                          </span>
                        </span>
                      </label>
                      {pdpPairEsim && (
                        <Select
                          label="Preferred eSIM Network"
                          value={pdpPairOperator}
                          onChange={(e) => setPdpPairOperator(e.target.value as OperatorCode)}
                          options={[
                            { value: 'ethio_telecom', label: 'Ethio telecom (+251 9xx)' },
                            { value: 'safaricom_ethiopia', label: 'Safaricom Ethiopia (+251 7xx)' },
                          ]}
                        />
                      )}
                    </div>
                  ) : (
                    <Alert tone="warning" title="Physical SIM Only">
                      This exact model variant does not support hardware eSIM and cannot be paired
                      with an eSIM plan.
                    </Alert>
                  )}

                  <div className="space-y-2.5">
                    <Button
                      className="w-full"
                      size="lg"
                      disabled={activePhone.stockQty <= 0}
                      leftIcon={<ShoppingBag className="h-4 w-4" />}
                      onClick={() =>
                        addItem(activePhone, {
                          quantity: pdpQty,
                          orderKind: pdpOrderKind,
                          pairedEsimOperator:
                            pdpPairEsim && activePhone.esimCompatibilityStatus !== 'not_compatible'
                              ? pdpPairOperator
                              : null,
                        })
                      }
                    >
                      {activePhone.stockQty <= 0 ? 'Out of Stock' : 'Add to Bag & Checkout'}
                    </Button>
                    <p className="inline-flex items-center justify-center w-full gap-1.5 text-xs text-[#64748B] dark:text-[#94A3B8]">
                      <Truck className="h-3.5 w-3.5 text-[#0A2DB8] dark:text-[#60A5FA]" />
                      Dispatched via Klick Delivery · Phone confirmation required
                    </p>
                  </div>
                </Card>
              </div>
            </div>
          </div>
        ) : (
          /* ------------------------------------------------------------------
           * STOREFRONT GRID + FILTERS + MY ORDERS
           * ------------------------------------------------------------------ */
          <>
            {/* Category Tabs + Search + Filters Bar */}
            <section className="space-y-2.5">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-2 border-b border-[#E5E7EB] dark:border-[#24344D]">
                <div
                  className="flex items-center gap-1.5 overflow-x-auto pb-0.5"
                  role="tablist"
                  aria-label="Phone categories"
                >
                  {CATEGORY_TABS.map((tab) => {
                    const active = categoryFilter === tab.id;
                    return (
                      <button
                        key={tab.id}
                        type="button"
                        role="tab"
                        aria-selected={active}
                        onClick={() => setCategoryFilter(tab.id)}
                        className={`px-2.5 py-1.5 rounded-lg text-[11px] sm:text-xs font-semibold whitespace-nowrap shrink-0 transition-colors cursor-pointer ${
                          active
                            ? 'bg-[#0A2DB8] text-white'
                            : 'bg-[#F8FAFC] dark:bg-[#162338] text-[#475569] dark:text-[#CBD5E1] border border-[#E5E7EB] dark:border-[#24344D] hover:border-[#0A2DB8]/50'
                        }`}
                      >
                        {tab.label}
                      </button>
                    );
                  })}
                </div>

                <label className="inline-flex items-center gap-1.5 text-[11px] sm:text-xs font-medium text-[#475569] dark:text-[#CBD5E1] cursor-pointer shrink-0">
                  <input
                    type="checkbox"
                    checked={unlockedOnly}
                    onChange={(e) => setUnlockedOnly(e.target.checked)}
                    className="h-3.5 w-3.5 rounded border-[#D1D5DB] text-[#0A2DB8]"
                  />
                  <span>Factory Unlocked Only</span>
                </label>
              </div>

              <div className="grid grid-cols-12 gap-2">
                <div className="col-span-12 md:col-span-6 relative">
                  <Search className="h-3.5 w-3.5 text-[#94A3B8] absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  <input
                    type="search"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search model, code (A3090, SM-S921B), or storage..."
                    className="w-full h-10 pl-8.5 pr-4 rounded-full border border-[#DADCE0] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-xs text-[#111827] dark:text-[#F8FAFC] focus:outline-none focus:ring-2 focus:ring-[#4285F4]/25 focus:border-[#4285F4]"
                  />
                </div>
                <div className="col-span-6 md:col-span-3">
                  <Select
                    aria-label="Filter by eSIM compatibility"
                    value={compatFilter}
                    onChange={(e) => setCompatFilter(e.target.value as PhoneCompatibilityStatus | 'all')}
                    className="!min-h-[40px] !py-1.5 text-xs !rounded-full"
                    options={[
                      { value: 'all', label: 'All Compatibility' },
                      { value: 'verified_compatible', label: 'Verified eSIM' },
                      { value: 'needs_verification', label: 'Needs Check' },
                      { value: 'not_compatible', label: 'Not Compatible' },
                    ]}
                  />
                </div>
                <div className="col-span-6 md:col-span-3">
                  <Select
                    aria-label="Sort phones"
                    value={sortOrder}
                    onChange={(e) => setSortOrder(e.target.value as SortOrder)}
                    className="!min-h-[40px] !py-1.5 text-xs !rounded-full"
                    options={[
                      { value: 'featured', label: 'Sort: Featured' },
                      { value: 'price_asc', label: 'Price: Low → High' },
                      { value: 'price_desc', label: 'Price: High → Low' },
                    ]}
                  />
                </div>
              </div>

              {filteredPhones.length === 0 ? (
                <EmptyState
                  title="No matching smartphones found"
                  description="Clear or adjust your search, brand category, or compatibility filters."
                  action={
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => {
                        setSearchQuery('');
                        setCategoryFilter('all');
                        setCompatFilter('all');
                        setUnlockedOnly(false);
                      }}
                    >
                      Reset Filters
                    </Button>
                  }
                />
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {filteredPhones.map((phone) => (
                    <PhoneCatalogCard
                      key={phone.id}
                      phone={phone}
                      onViewDetails={openPdp}
                      onOrder={(p) => addItem(p)}
                    />
                  ))}
                </div>
              )}
            </section>

            {/* Customer Phone Orders & Delivery Tracker (when signed in) */}
            {firebaseUser && orders.length > 0 && (
              <section className="space-y-3 pt-4 border-t border-[#E5E7EB] dark:border-[#24344D]">
                <h2 className="text-base font-bold text-[#111827] dark:text-[#F8FAFC]">
                  My Device Orders ({orders.length})
                </h2>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  {orders.map((ord) => (
                    <Card key={ord.id} padding="sm" className="space-y-3">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="text-xs font-semibold text-[#0A2DB8] dark:text-[#60A5FA] tabular-nums">
                            {ord.orderNumber}
                          </p>
                          <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                            {ord.quantity}x {ord.phoneModel}
                          </h3>
                        </div>
                        <StatusBadge
                          status={
                            ord.paymentStatus === 'verified'
                              ? 'verified'
                              : ord.paymentStatus === 'failed'
                                ? 'failed'
                                : 'pending'
                          }
                          label={
                            ord.paymentStatus === 'verified'
                              ? 'Paid'
                              : ord.estimatedTotalEtb > 0
                                ? 'Payment Pending'
                                : ord.fulfillmentStatus.replace(/_/g, ' ')
                          }
                        />
                      </div>

                      <div className="text-xs text-[#64748B] dark:text-[#CBD5E1] space-y-1">
                        <p className="tabular-nums">
                          <strong>Total:</strong>{' '}
                          {ord.estimatedTotalEtb > 0
                            ? `${ord.estimatedTotalEtb.toLocaleString()} ETB`
                            : 'Commercial Quote'}
                          {ord.contactPhone ? ` · Contact: ${ord.contactPhone}` : ''}
                        </p>
                        <p>
                          <strong>Delivery:</strong> {ord.deliveryCity}
                          {ord.deliveryAddress ? ` — ${ord.deliveryAddress}` : ''}
                        </p>
                        <p>
                          <strong>Status:</strong> {ord.fulfillmentStatus.replace(/_/g, ' ')} · Klick:{' '}
                          {ord.klickDeliveryPartnerStatus.replace(/_/g, ' ')}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 pt-1">
                        {ord.paymentStatus !== 'verified' && ord.estimatedTotalEtb > 0 && (
                          <Button
                            size="sm"
                            onClick={() => handleResumeOrderCheckout(ord)}
                            leftIcon={<CreditCard className="h-3.5 w-3.5" />}
                          >
                            Complete Payment
                          </Button>
                        )}
                        {ord.pairedEsimOperator && (
                          <Button
                            size="sm"
                            variant="secondary"
                            onClick={() => navigate(`/buy-esim?operator=${ord.pairedEsimOperator}`)}
                          >
                            Activate Paired eSIM →
                          </Button>
                        )}
                      </div>
                    </Card>
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </div>

      {/* Slide-Over Shopping Bag & Checkout Drawer */}
      {drawerOpen && (
        <div
          className="fixed inset-0 z-50 flex justify-end bg-[#111827]/55 backdrop-blur-xs"
          role="dialog"
          aria-modal="true"
          aria-labelledby="phone-bag-title"
        >
          <div className="fixed inset-0" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <div className="relative z-10 w-full max-w-lg bg-white dark:bg-[#162338] border-l border-[#E5E7EB] dark:border-[#24344D] h-full flex flex-col shadow-2xl">
            {/* Drawer Header */}
            <div className="px-5 py-4 border-b border-[#E5E7EB] dark:border-[#24344D] flex items-center justify-between gap-3">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-5 w-5 text-[#0A2DB8] dark:text-[#60A5FA]" />
                <h2 id="phone-bag-title" className="text-base font-bold text-[#111827] dark:text-[#F8FAFC]">
                  Your Device Bag ({totalUnits})
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                aria-label="Close bag"
                className="p-1.5 rounded-lg text-[#64748B] hover:bg-[#F8FAFC] dark:hover:bg-[#1C2D45] cursor-pointer"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Drawer Body */}
            <div className="flex-1 overflow-y-auto p-5 space-y-5">
              {checkoutError && <Alert tone="error">{checkoutError}</Alert>}

              {/* Completed Payment Receipts */}
              {completedOrders.length > 0 && (
                <div className="space-y-3">
                  <Alert tone="success" title="Order Confirmed & Payment Verified">
                    {completedOrders.length} handset order(s) confirmed for Klick delivery
                    coordination. We will call your provided contact phone before dispatch.
                  </Alert>
                  {completedOrders.map((ord) => (
                    <Card key={ord.id} padding="sm" variant="subtle" className="space-y-2 text-xs">
                      <div className="flex items-center justify-between font-semibold">
                        <span className="text-[#0A2DB8] dark:text-[#60A5FA] tabular-nums">
                          {ord.orderNumber}
                        </span>
                        <span className="text-[#15803D] dark:text-[#86EFAC] inline-flex items-center gap-1">
                          <CheckCircle2 className="h-3.5 w-3.5" />
                          Verified
                        </span>
                      </div>
                      <p className="font-medium text-[#111827] dark:text-[#F8FAFC]">
                        {ord.quantity}x {ord.phoneModel} · {ord.estimatedTotalEtb.toLocaleString()} ETB
                      </p>
                      <p className="text-[#64748B] dark:text-[#CBD5E1]">
                        Deliver to: {ord.deliveryCity}
                        {ord.deliveryAddress ? ` — ${ord.deliveryAddress}` : ''} ({ord.contactPhone})
                      </p>
                      {ord.pairedEsimOperator && (
                        <Button
                          size="sm"
                          className="w-full mt-2"
                          onClick={() => {
                            setDrawerOpen(false);
                            navigate(`/buy-esim?operator=${ord.pairedEsimOperator}`);
                          }}
                        >
                          Continue to Activate Paired eSIM →
                        </Button>
                      )}
                    </Card>
                  ))}
                </div>
              )}

              {/* Pending Chapa Payment Verification Step */}
              {pendingCheckouts.length > 0 && (
                <div className="space-y-3">
                  <Alert tone="info" title="Complete Chapa Payment">
                    Confirm your Chapa payment below to lock your handset order for Klick delivery.
                  </Alert>
                  {pendingCheckouts.map((entry) => (
                    <Card key={entry.order.id} padding="sm" className="space-y-3">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <span className="font-bold text-[#0A2DB8] dark:text-[#60A5FA] tabular-nums">
                          {entry.order.orderNumber}
                        </span>
                        <span className="font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums">
                          {entry.order.estimatedTotalEtb.toLocaleString()} ETB
                        </span>
                      </div>
                      <p className="text-xs text-[#64748B] dark:text-[#CBD5E1]">
                        {entry.order.quantity}x {entry.order.phoneModel} · Ref:{' '}
                        <span className="font-mono">{entry.txRef}</span>
                      </p>
                      <div className="flex flex-col gap-2">
                        {entry.isLiveRedirect && entry.checkoutUrl && (
                          <a
                            href={entry.checkoutUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center justify-center rounded-lg bg-[#0A2DB8] text-white text-xs font-semibold py-2.5 px-3 hover:bg-[#082499]"
                          >
                            Open Chapa Payment Page ↗
                          </a>
                        )}
                        <Button
                          size="sm"
                          loading={checkoutBusy}
                          leftIcon={<CreditCard className="h-3.5 w-3.5" />}
                          onClick={() => handleVerifyPendingPayment(entry)}
                        >
                          {entry.isLiveRedirect
                            ? 'Verify Completed Chapa Payment'
                            : 'Confirm & Pay with Chapa'}
                        </Button>
                      </div>
                    </Card>
                  ))}
                </div>
              )}

              {/* Bag Items */}
              {bagItems.length === 0 ? (
                completedOrders.length === 0 &&
                pendingCheckouts.length === 0 && (
                  <div className="py-10 text-center space-y-3">
                    <ShoppingBag className="h-10 w-10 text-[#94A3B8] mx-auto" />
                    <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
                      Your bag is empty
                    </p>
                    <p className="text-xs text-[#64748B] dark:text-[#CBD5E1]">
                      Select any verified eSIM-ready smartphone to add it to your bag and order for
                      delivery.
                    </p>
                  </div>
                )
              ) : (
                <>
                  <div className="space-y-3">
                    {bagItems.map((item) => {
                      const img = resolvePhoneImage(item);
                      const unitPrice = item.unitPriceEtb ?? item.sandboxPreviewPriceEtb ?? 0;
                      return (
                        <div
                          key={item.phoneProductId}
                          className="p-3.5 rounded-xl border border-[#E5E7EB] dark:border-[#24344D] bg-[#F8FAFC] dark:bg-[#111C2E] space-y-3"
                        >
                          <div className="flex items-start gap-3">
                            <div className="h-16 w-20 rounded-lg overflow-hidden bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] shrink-0">
                              {img ? (
                                <img
                                  src={img}
                                  alt={item.model}
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <div className="h-full w-full flex items-center justify-center">
                                  <Smartphone className="h-6 w-6 text-[#94A3B8]" />
                                </div>
                              )}
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0">
                                  <p className="text-[11px] font-semibold text-[#0A2DB8] dark:text-[#60A5FA]">
                                    {item.brand} · {item.exactModelNumber}
                                  </p>
                                  <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                                    {item.model}
                                  </h3>
                                </div>
                                <button
                                  type="button"
                                  onClick={() => removeItem(item.phoneProductId)}
                                  aria-label={`Remove ${item.model}`}
                                  className="text-[#94A3B8] hover:text-[#DC2626] p-1 cursor-pointer"
                                >
                                  <Trash2 className="h-4 w-4" />
                                </button>
                              </div>
                              <p className="text-xs font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums mt-1">
                                {(unitPrice * item.quantity).toLocaleString()} ETB
                                {item.unitPriceEtb === null && (
                                  <span className="ml-1 font-normal text-[#64748B]">(Est.)</span>
                                )}
                              </p>
                            </div>
                          </div>

                          <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-[#E5E7EB] dark:border-[#24344D]">
                            <div className="inline-flex items-center rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#162338]">
                              <button
                                type="button"
                                onClick={() => updateItemQty(item.phoneProductId, item.quantity - 1)}
                                className="p-1.5 text-[#475569] dark:text-[#CBD5E1] cursor-pointer"
                                aria-label="Decrease quantity"
                              >
                                <Minus className="h-3.5 w-3.5" />
                              </button>
                              <span className="px-3 text-xs font-bold tabular-nums">
                                {item.quantity}
                              </span>
                              <button
                                type="button"
                                onClick={() => updateItemQty(item.phoneProductId, item.quantity + 1)}
                                className="p-1.5 text-[#475569] dark:text-[#CBD5E1] cursor-pointer"
                                aria-label="Increase quantity"
                              >
                                <Plus className="h-3.5 w-3.5" />
                              </button>
                            </div>

                            <button
                              type="button"
                              onClick={() =>
                                updateItemOrderKind(
                                  item.phoneProductId,
                                  item.orderKind === 'individual' ? 'bulk_business' : 'individual',
                                )
                              }
                              className="text-[11px] font-semibold text-[#0A2DB8] dark:text-[#60A5FA] hover:underline cursor-pointer"
                            >
                              {item.orderKind === 'individual'
                                ? `Switch to Bulk (${item.bulkMinimumQty}+)`
                                : 'Switch to Single'}
                            </button>
                          </div>

                          {item.esimCompatibilityStatus !== 'not_compatible' && (
                            <div className="flex items-center justify-between gap-2 text-xs">
                              <span className="text-[#64748B] dark:text-[#CBD5E1]">Pair eSIM:</span>
                              <select
                                value={item.pairedEsimOperator ?? ''}
                                onChange={(e) =>
                                  updateItemPairedEsim(
                                    item.phoneProductId,
                                    (e.target.value || null) as OperatorCode | null,
                                  )
                                }
                                className="px-2.5 py-1 rounded-md border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#162338] text-xs"
                              >
                                <option value="">Phone only</option>
                                <option value="ethio_telecom">+ Ethio telecom eSIM</option>
                                <option value="safaricom_ethiopia">+ Safaricom eSIM</option>
                              </select>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Sign-In Gate or Delivery Contact + Payment Checkout Form */}
                  {!firebaseUser ? (
                    <Card variant="highlight" className="space-y-3 text-center">
                      <ShieldCheck className="h-7 w-7 text-[#0A2DB8] dark:text-[#60A5FA] mx-auto" />
                      <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC]">
                        Sign in to order &amp; pay for delivery
                      </h3>
                      <p className="text-xs text-[#64748B] dark:text-[#CBD5E1]">
                        Your selected devices stay saved in your bag. Sign in or create an account
                        to enter your contact phone number and complete Chapa payment.
                      </p>
                      <div className="grid grid-cols-2 gap-2 pt-1">
                        <Button
                          size="sm"
                          onClick={() => {
                            setDrawerOpen(false);
                            navigate(`/login?redirect=${encodeURIComponent(pathname)}`);
                          }}
                        >
                          Sign In
                        </Button>
                        <Button
                          size="sm"
                          variant="secondary"
                          onClick={() => {
                            setDrawerOpen(false);
                            navigate(`/register?redirect=${encodeURIComponent(pathname)}`);
                          }}
                        >
                          Create Account
                        </Button>
                      </div>
                    </Card>
                  ) : (
                    <form onSubmit={handlePlaceBagOrderAndInitPayment} className="space-y-3.5 pt-2">
                      <h3 className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] flex items-center gap-1.5">
                        <Phone className="h-4 w-4 text-[#0A2DB8] dark:text-[#60A5FA]" />
                        Contact &amp; Delivery Details
                      </h3>

                      <Input
                        label="Contact Phone Number (Required for Delivery)"
                        placeholder="+251911223344"
                        value={contactPhone}
                        onChange={(e) => setContactPhone(e.target.value)}
                        required
                      />

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <Input
                          label="Delivery City"
                          value={deliveryCity}
                          onChange={(e) => setDeliveryCity(e.target.value)}
                          required
                        />
                        <Input
                          label="Sub-City / Street Address"
                          placeholder="Bole, Woreda 03, near Millennium Hall"
                          value={deliveryAddress}
                          onChange={(e) => setDeliveryAddress(e.target.value)}
                          required
                        />
                      </div>

                      {hasBulkItem && (
                        <Input
                          label="Organization / Company Name"
                          placeholder="Addis Trading PLC"
                          value={companyName}
                          onChange={(e) => setCompanyName(e.target.value)}
                          required
                        />
                      )}

                      <Input
                        label="Delivery Instructions (Optional)"
                        placeholder="Preferred call window or building landmark"
                        value={deliveryNotes}
                        onChange={(e) => setDeliveryNotes(e.target.value)}
                      />

                      <div className="p-3.5 rounded-xl bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D] space-y-1.5 text-xs">
                        <div className="flex justify-between font-semibold text-sm text-[#111827] dark:text-[#F8FAFC]">
                          <span>Order Subtotal</span>
                          <span className="tabular-nums">
                            {bagSubtotalEtb > 0
                              ? `${bagSubtotalEtb.toLocaleString()} ETB`
                              : 'Commercial Quote'}
                          </span>
                        </div>
                        <p className="text-[#64748B] dark:text-[#94A3B8]">
                          {bagHasEstimate
                            ? 'Estimated total · Klick delivery team calls to confirm dispatch.'
                            : 'Official store price · Server-verified Chapa payment & Klick delivery.'}
                        </p>
                      </div>

                      <Button
                        type="submit"
                        size="lg"
                        className="w-full"
                        loading={checkoutBusy}
                        leftIcon={<CreditCard className="h-4 w-4" />}
                      >
                        {bagSubtotalEtb > 0
                          ? `Place Order & Pay (${bagSubtotalEtb.toLocaleString()} ETB)`
                          : 'Submit Device Order'}
                      </Button>
                    </form>
                  )}
                </>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
