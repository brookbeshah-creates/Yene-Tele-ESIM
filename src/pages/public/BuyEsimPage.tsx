import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CheckCircle2,
  Copy,
  CreditCard,
  Fingerprint,
  Info,
  RefreshCw,
  ShieldCheck,
  Smartphone,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiRequest } from '../../lib/apiClient';
import { useRouter } from '../../router/RouterContext';
import type {
  CustomerEsimRecord,
  DeviceCompatibilityRecord,
  EsimActivationSecretView,
  EsimOrderRecord,
  EsimProductRecord,
  NumberTier,
  OperatorCode,
  OperatorConfigRecord,
  PublicNumberOption,
} from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { GoogleSignInButton } from '../../components/yegna/GoogleSignInButton';
import { OPERATOR_LOGO_MAP } from '../../components/yegna/OperatorLogoTiles';
import { QrCodeDisplay } from '../../components/yegna/QrCodeDisplay';

const STEP_META = [
  { num: 1, short: 'Operator', title: 'Choose Operator & Plan' },
  { num: 2, short: 'Device', title: 'Device Compatibility' },
  { num: 3, short: 'Fayda', title: 'Fayda KYC' },
  { num: 4, short: 'Number', title: 'Mobile Number' },
  { num: 5, short: 'Pay', title: 'Review & Pay' },
  { num: 6, short: 'eSIM', title: 'Install eSIM' },
];

export function BuyEsimPage() {
  const { firebaseUser, loading: authLoading, signInWithGoogle, authError, clearAuthError } = useAuth();
  const { navigate, search } = useRouter();

  const requestedOperator = useMemo(() => {
    const param = new URLSearchParams(search).get('operator');
    return param === 'ethio_telecom' || param === 'safaricom_ethiopia' ? param : null;
  }, [search]);

  const [operators, setOperators] = useState<OperatorConfigRecord[]>([]);
  const [products, setProducts] = useState<EsimProductRecord[]>([]);
  const [devices, setDevices] = useState<DeviceCompatibilityRecord[]>([]);
  const [numbers, setNumbers] = useState<PublicNumberOption[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [numbersLoading, setNumbersLoading] = useState(false);

  const [step, setStep] = useState<number>(1);
  const [selectedOperator, setSelectedOperator] = useState<OperatorCode>(
    requestedOperator ?? 'ethio_telecom',
  );
  const [selectedProductId, setSelectedProductId] = useState<string>('prod-ethio-new-line');
  const [existingMsisdn, setExistingMsisdn] = useState('');

  const [deviceQuery, setDeviceQuery] = useState('');
  const [selectedDeviceModel, setSelectedDeviceModel] = useState('Apple iPhone 15 (Global Unlocked)');
  const [selectedOs, setSelectedOs] = useState<'ios' | 'android'>('ios');
  const [deviceConfirmed, setDeviceConfirmed] = useState(false);

  const [order, setOrder] = useState<EsimOrderRecord | null>(null);
  const [draftIdempKey] = useState<string>(
    () => `DRAFT-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
  );
  const [fullName, setFullName] = useState('');
  const [faydaFan, setFaydaFan] = useState('');
  const [contactPhone, setContactPhone] = useState('+251911223344');
  const [kycConsent, setKycConsent] = useState(false);

  const [numberSearch, setNumberSearch] = useState('');
  const [tierFilter, setTierFilter] = useState<NumberTier | 'all'>('all');
  const [selectedStockId, setSelectedStockId] = useState<string | null>(null);
  const [selectedDirectMsisdn, setSelectedDirectMsisdn] = useState<string | null>(null);
  const [preferredTier, setPreferredTier] = useState<NumberTier>('standard');

  const [txRef, setTxRef] = useState<string | null>(null);
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [paymentIsSandbox, setPaymentIsSandbox] = useState(true);
  const [provisionedEsim, setProvisionedEsim] = useState<CustomerEsimRecord | null>(null);
  const [activation, setActivation] = useState<EsimActivationSecretView | null>(null);

  const [authBusy, setAuthBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [copiedField, setCopiedField] = useState<string | null>(null);

  useEffect(() => {
    if (requestedOperator) {
      setSelectedOperator(requestedOperator);
    }
  }, [requestedOperator]);

  const loadCatalog = useCallback(() => {
    setCatalogLoading(true);
    setCatalogError(null);
    Promise.all([
      apiRequest<{ operators: OperatorConfigRecord[] }>('/api/v1/operators', { requireAuth: false }),
      apiRequest<{ products: EsimProductRecord[] }>('/api/v1/products', { requireAuth: false }),
      apiRequest<{ devices: DeviceCompatibilityRecord[] }>('/api/v1/devices/compatibility', {
        requireAuth: false,
      }),
    ])
      .then(([ops, prods, devs]) => {
        setOperators(ops.operators);
        setProducts(prods.products);
        setDevices(devs.devices);
        if (requestedOperator) {
          setSelectedOperator(requestedOperator);
        } else {
          const firstEnabled = ops.operators.find(
            (o) => o.isEnabled && o.integrationStatus !== 'coming_soon',
          );
          if (firstEnabled) setSelectedOperator(firstEnabled.operatorCode);
        }
      })
      .catch((err) => {
        setCatalogError(
          err instanceof Error
            ? err.message
            : 'Unable to load operators and services. Please retry.',
        );
      })
      .finally(() => {
        setCatalogLoading(false);
      });
  }, [requestedOperator]);

  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);

  useEffect(() => {
    const params = new URLSearchParams({ operator: selectedOperator });
    if (numberSearch.trim()) params.set('q', numberSearch.trim());
    if (tierFilter !== 'all') params.set('tier', tierFilter);

    setNumbersLoading(true);
    apiRequest<{ numbers: PublicNumberOption[] }>(
      `/api/v1/numbers/available?${params.toString()}`,
      { requireAuth: false },
    )
      .then((res) => {
        setNumbers(res.numbers);
        setSelectedStockId(res.numbers[0]?.id ?? null);
        setSelectedDirectMsisdn(res.numbers[0]?.msisdn ?? null);
      })
      .catch(() => {
        setNumbers([]);
        setSelectedStockId(null);
        setSelectedDirectMsisdn(null);
      })
      .finally(() => {
        setNumbersLoading(false);
      });
  }, [selectedOperator, numberSearch, tierFilter]);

  const operatorProducts = useMemo(
    () => products.filter((p) => p.operatorCode === selectedOperator),
    [products, selectedOperator],
  );

  useEffect(() => {
    const firstActive = operatorProducts.find((p) => p.isActive);
    if (firstActive) setSelectedProductId(firstActive.id);
  }, [selectedOperator, operatorProducts]);

  const activeOperatorCfg = operators.find((o) => o.operatorCode === selectedOperator);
  const activeProduct = products.find((p) => p.id === selectedProductId);
  const filteredDevices = useMemo(() => {
    const q = deviceQuery.trim().toLowerCase();
    if (!q) return devices.filter((d) => d.esimSupported).slice(0, 6);
    return devices.filter(
      (d) =>
        d.brand.toLowerCase().includes(q) ||
        d.modelFamily.toLowerCase().includes(q),
    );
  }, [devices, deviceQuery]);

  const copyText = (label: string, val: string) => {
    navigator.clipboard?.writeText(val).catch(() => {});
    setCopiedField(label);
    setTimeout(() => setCopiedField(null), 1800);
  };

  const handleGoogleSignInBeforeForm = async () => {
    clearAuthError();
    setAuthBusy(true);
    try {
      await signInWithGoogle();
    } catch {
      // handled in AuthContext
    } finally {
      setAuthBusy(false);
    }
  };

  const handleStartDraftAndProceed = async () => {
    setErrorMsg(null);
    if (!firebaseUser) {
      return;
    }
    setBusy(true);
    try {
      const res = await apiRequest<{ order: EsimOrderRecord }>('/api/v1/orders', {
        method: 'POST',
        body: {
          operatorCode: selectedOperator,
          productId: selectedProductId,
          deviceModel: selectedDeviceModel,
          deviceOs: selectedOs,
          deviceVerified: deviceConfirmed,
          agentReferralCode: null,
          idempotencyKey: draftIdempKey,
          existingMsisdn:
            activeProduct?.productType === 'sim_to_esim_conversion' ? existingMsisdn : null,
        },
      });
      setOrder(res.order);
      setStep(3);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to start eSIM order.');
    } finally {
      setBusy(false);
    }
  };

  const handleSubmitKyc = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!order) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ order: EsimOrderRecord }>(`/api/v1/orders/${order.id}/kyc`, {
        method: 'POST',
        body: {
          fullName,
          faydaFanReference: faydaFan,
          contactPhone,
          consentGiven: kycConsent,
        },
      });
      setOrder(res.order);
      setStep(4);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'KYC submission failed. Please review your details and retry.');
    } finally {
      setBusy(false);
    }
  };

  const handleReserveNumber = async () => {
    if (!order) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const mode = activeOperatorCfg?.numberAvailabilityMode;
      const res = await apiRequest<{ order: EsimOrderRecord }>(
        `/api/v1/orders/${order.id}/reserve-number`,
        {
          method: 'POST',
          body: {
            stockItemId: mode === 'stock_pool' ? selectedStockId : null,
            requestedPhone: mode === 'direct_api' ? selectedDirectMsisdn : undefined,
            preferredTier,
          },
        },
      );
      setOrder(res.order);
      setStep(5);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to reserve selected number.');
    } finally {
      setBusy(false);
    }
  };

  const handleInitChapa = async () => {
    if (!order) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await apiRequest<{
        order: EsimOrderRecord;
        payment: { txRef: string; isSandbox?: boolean; checkoutUrl?: string | null };
        checkoutUrl?: string;
      }>(`/api/v1/orders/${order.id}/checkout`, {
        method: 'POST',
        body: { returnUrl: '/buy-esim' },
      });
      setOrder(res.order);
      setTxRef(res.payment.txRef);
      setCheckoutUrl(res.checkoutUrl ?? res.payment.checkoutUrl ?? null);
      setPaymentIsSandbox(res.payment.isSandbox ?? true);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to initialize Chapa checkout.');
    } finally {
      setBusy(false);
    }
  };

  const handleVerifyChapaAndFulfill = async () => {
    if (!order || !txRef) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await apiRequest<{
        order: EsimOrderRecord;
        esim: CustomerEsimRecord | null;
      }>(`/api/v1/orders/${order.id}/verify-payment`, {
        method: 'POST',
        body: { txRef },
      });
      setOrder(res.order);
      setProvisionedEsim(res.esim);
      if (res.esim) {
        const secretRes = await apiRequest<{ activation: EsimActivationSecretView }>(
          `/api/v1/esims/${res.esim.id}/activation`,
        );
        setActivation(secretRes.activation);
      }
      setStep(6);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment verification failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePollProvisioning = async () => {
    if (!order) return;
    setErrorMsg(null);
    setBusy(true);
    try {
      const res = await apiRequest<{
        order: EsimOrderRecord;
        esim: CustomerEsimRecord | null;
      }>(`/api/v1/orders/${order.id}/poll-provisioning`, { method: 'POST', body: {} });
      setOrder(res.order);
      setProvisionedEsim(res.esim);
      if (res.esim) {
        const secretRes = await apiRequest<{ activation: EsimActivationSecretView }>(
          `/api/v1/esims/${res.esim.id}/activation`,
        );
        setActivation(secretRes.activation);
      }
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Unable to refresh provisioning status.');
    } finally {
      setBusy(false);
    }
  };

  if (authLoading) {
    return (
      <div className="max-w-lg mx-auto px-4 py-12">
        <LoadingState message="Checking your Google session..." />
      </div>
    );
  }

  // Gate: User MUST sign in with Google BEFORE starting the Buy eSIM form
  if (!firebaseUser) {
    const emailRedirect = `/login?redirect=${encodeURIComponent(`/buy-esim${search}`)}`;
    return (
      <div className="max-w-md mx-auto px-3 sm:px-6 py-8 sm:py-14">
        <Card padding="none" className="overflow-hidden rounded-3xl border-[#DADCE0] dark:border-[#24344D]">
          <div className="h-1.5 w-full bg-gradient-to-r from-[#4285F4] via-[#EA4335] via-[#FBBC05] to-[#34A853]" />
          <div className="p-6 sm:p-8 space-y-5">
            <div className="flex flex-col items-center text-center space-y-2.5">
              <div className="h-12 px-3 rounded-2xl bg-white border border-[#DADCE0] flex items-center justify-center shadow-xs">
                <img
                  src="/assets/aistudio/image_28c3daa0.png"
                  alt="Yene Tele"
                  className="h-8 w-auto object-contain"
                />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
                Sign in with Google to buy eSIM
              </h1>
              <p className="text-xs sm:text-sm text-[#5F6368] dark:text-[#CBD5E1] leading-relaxed">
                Sign in first so your order, Fayda verification, and eSIM QR code stay linked safely
                to your account.
              </p>
            </div>

            {requestedOperator && (
              <div className="rounded-2xl bg-[#F8FAFD] dark:bg-[#111C2E] border border-[#DADCE0] dark:border-[#24344D] p-3 flex items-center justify-center gap-3">
                <span className="inline-flex h-8 w-16 items-center justify-center rounded-lg bg-white border border-[#DADCE0] px-1.5 py-1 shrink-0">
                  <img
                    src={OPERATOR_LOGO_MAP[requestedOperator].src}
                    alt={OPERATOR_LOGO_MAP[requestedOperator].alt}
                    className="h-full w-full object-contain"
                  />
                </span>
                <span className="text-xs font-semibold text-[#111827] dark:text-[#F8FAFC]">
                  Selected:{' '}
                  {requestedOperator === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia'}
                </span>
              </div>
            )}

            {authError && <Alert tone="error">{authError}</Alert>}

            <div className="space-y-3 pt-1">
              <GoogleSignInButton
                loading={authBusy}
                label="Continue with Google"
                onClick={handleGoogleSignInBeforeForm}
              />

              <button
                type="button"
                onClick={() => navigate(emailRedirect)}
                className="w-full min-h-[42px] text-xs font-semibold text-[#1A73E8] dark:text-[#60A5FA] hover:underline cursor-pointer"
              >
                Or sign in with email &amp; password
              </button>
            </div>
          </div>
        </Card>
      </div>
    );
  }

  const currentStepMeta = STEP_META[step - 1] ?? STEP_META[0];
  const selectedNumberPreview =
    activeOperatorCfg?.numberAvailabilityMode === 'stock_pool'
      ? numbers.find((n) => n.id === selectedStockId)?.msisdn
      : selectedDirectMsisdn;

  return (
    <div className="max-w-3xl mx-auto px-3 sm:px-6 py-3 sm:py-6 space-y-4">
      {/* Compact Google-Styled Web App Header & Segmented Progress */}
      <div className="rounded-2xl border border-[#DADCE0] dark:border-[#24344D] bg-white dark:bg-[#162338] overflow-hidden shadow-[var(--yegna-shadow-card)]">
        <div className="h-1 w-full bg-gradient-to-r from-[#4285F4] via-[#EA4335] via-[#FBBC05] to-[#34A853]" />
        <div className="p-3.5 sm:p-4 space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0">
              <p className="text-[11px] font-semibold uppercase tracking-wider text-[#1A73E8] dark:text-[#60A5FA]">
                eSIM Activation App
              </p>
              <h1 className="text-base sm:text-lg font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                {currentStepMeta.title}
              </h1>
            </div>
            <span className="inline-flex items-center px-2.5 py-1 rounded-full bg-[#E8F0FE] dark:bg-[#13254A] text-xs font-bold text-[#1A73E8] dark:text-[#60A5FA] tabular-nums shrink-0">
              Step {step} / 6
            </span>
          </div>

          <div className="grid grid-cols-6 gap-1.5" aria-label="Activation progress">
            {STEP_META.map((item) => {
              const active = step === item.num;
              const done = step > item.num;
              return (
                <div key={item.num} className="space-y-1">
                  <div
                    className={`h-1.5 rounded-full transition-colors ${
                      active
                        ? 'bg-[#1A73E8] dark:bg-[#3B82F6]'
                        : done
                          ? 'bg-[#34A853] dark:bg-[#22C55E]'
                          : 'bg-[#E5E7EB] dark:bg-[#24344D]'
                    }`}
                  />
                  <span
                    className={`block text-[10px] sm:text-[11px] font-semibold text-center truncate ${
                      active
                        ? 'text-[#1A73E8] dark:text-[#60A5FA]'
                        : done
                          ? 'text-[#188038] dark:text-[#4ADE80]'
                          : 'text-[#5F6368] dark:text-[#94A3B8]'
                    }`}
                  >
                    {item.short}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {errorMsg && <Alert tone="error">{errorMsg}</Alert>}

      {/* STEP 1: OPERATOR & PRODUCT */}
      {step === 1 && (
        <Card padding="sm" className="sm:p-6 rounded-2xl border-[#DADCE0] dark:border-[#24344D] space-y-5">
          <CardHeader title="Step 1 · Select Operator & eSIM Service" />

          {catalogLoading ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {[0, 1].map((idx) => (
                <div
                  key={idx}
                  className="h-16 rounded-2xl border border-[#DADCE0] dark:border-[#24344D] bg-[#F8FAFD] dark:bg-[#111C2E] animate-pulse"
                />
              ))}
            </div>
          ) : catalogError || operators.length === 0 ? (
            <Alert tone="error" title="Could not load operators">
              <div className="space-y-2">
                <p>{catalogError ?? 'No mobile operators were returned.'}</p>
                <Button size="sm" variant="secondary" onClick={loadCatalog}>
                  Retry Loading Operators
                </Button>
              </div>
            </Alert>
          ) : (
            <>
              <div className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5F6368] dark:text-[#94A3B8]">
                  Choose your Operator
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {operators.map((op) => {
                    const unavailable = !op.isEnabled || op.integrationStatus === 'coming_soon';
                    const selected = selectedOperator === op.operatorCode && !unavailable;
                    return (
                      <button
                        key={op.operatorCode}
                        type="button"
                        disabled={unavailable}
                        onClick={() => !unavailable && setSelectedOperator(op.operatorCode)}
                        className={`w-full min-h-[68px] text-left p-3.5 rounded-2xl border-2 transition-colors ${
                          unavailable
                            ? 'opacity-55 cursor-not-allowed border-[#DADCE0] dark:border-[#24344D] bg-[#F8FAFD] dark:bg-[#111C2E]'
                            : selected
                              ? 'border-[#1A73E8] bg-[#E8F0FE]/65 dark:bg-[#13254A] cursor-pointer'
                              : 'border-[#DADCE0] dark:border-[#24344D] bg-white dark:bg-[#162338] hover:border-[#4285F4] cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2.5">
                          <div className="inline-flex items-center gap-2.5 min-w-0">
                            <span className="inline-flex h-10 w-20 items-center justify-center rounded-xl bg-white border border-[#DADCE0] px-2 py-1 shrink-0">
                              <img
                                src={OPERATOR_LOGO_MAP[op.operatorCode].src}
                                alt={op.displayName}
                                className="h-full w-full object-contain"
                              />
                            </span>
                            <span className="text-sm sm:text-base font-bold text-[#111827] dark:text-[#F8FAFC] truncate">
                              {op.displayName}
                            </span>
                          </div>
                          {unavailable ? (
                            <StatusBadge status="coming_soon" label="Unavailable" />
                          ) : (
                            <span
                              className={`inline-flex h-6 w-6 items-center justify-center rounded-full border shrink-0 ${
                                selected
                                  ? 'bg-[#1A73E8] border-[#1A73E8] text-white'
                                  : 'border-[#CBD5E1] dark:border-[#334866] bg-white dark:bg-[#111C2E]'
                              }`}
                              aria-hidden="true"
                            >
                              {selected && <Check className="h-3.5 w-3.5" />}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              <div className="space-y-2.5">
                <p className="text-xs font-semibold uppercase tracking-wider text-[#5F6368] dark:text-[#94A3B8]">
                  Available Services
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                  {operatorProducts.map((prod) => {
                    const disabled = !prod.isActive || !activeOperatorCfg?.isEnabled;
                    const active = selectedProductId === prod.id && !disabled;
                    return (
                      <button
                        key={prod.id}
                        type="button"
                        disabled={disabled}
                        onClick={() => !disabled && setSelectedProductId(prod.id)}
                        className={`w-full min-h-[58px] text-left p-3.5 rounded-2xl border-2 transition-colors ${
                          disabled
                            ? 'opacity-55 cursor-not-allowed bg-[#F8FAFD] dark:bg-[#111C2E] border-[#DADCE0] dark:border-[#24344D]'
                            : active
                              ? 'border-[#1A73E8] bg-[#E8F0FE]/60 dark:bg-[#13254A] cursor-pointer'
                              : 'border-[#DADCE0] dark:border-[#24344D] bg-white dark:bg-[#162338] hover:border-[#4285F4] cursor-pointer'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
                            {prod.name}
                          </span>
                          {disabled ? (
                            <StatusBadge status="coming_soon" label="Unavailable" />
                          ) : (
                            <span
                              className={`inline-flex h-5 w-5 items-center justify-center rounded-full border shrink-0 ${
                                active
                                  ? 'bg-[#1A73E8] border-[#1A73E8] text-white'
                                  : 'border-[#CBD5E1] dark:border-[#334866] bg-white dark:bg-[#111C2E]'
                              }`}
                              aria-hidden="true"
                            >
                              {active && <Check className="h-3 w-3" />}
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>

              {activeProduct?.productType === 'sim_to_esim_conversion' && activeProduct.isActive && (
                <div className="w-full sm:max-w-sm">
                  <Input
                    label="Existing Ethiopian Mobile Number to Convert"
                    type="tel"
                    placeholder="+251911223344"
                    value={existingMsisdn}
                    onChange={(e) => setExistingMsisdn(e.target.value)}
                    helperText="Include +251 (e.g. +251911223344). Keep your physical SIM active until QR scan completes."
                    required
                  />
                </div>
              )}

              <div className="rounded-2xl bg-[#F8FAFD] dark:bg-[#111C2E] border border-[#DADCE0] dark:border-[#24344D] p-3 flex items-start gap-2.5 text-xs text-[#475569] dark:text-[#CBD5E1]">
                <Info className="h-4 w-4 text-[#1A73E8] dark:text-[#60A5FA] shrink-0 mt-0.5" />
                <span>
                  {activeProduct?.productType === 'sim_to_esim_conversion'
                    ? 'Next you will verify your phone supports eSIM, confirm Fayda subscriber KYC, and receive your conversion QR.'
                    : 'Quick setup: check phone compatibility, verify Fayda identity, pick your number, and get your QR code.'}
                </span>
              </div>

              <div className="pt-1">
                <Button
                  size="lg"
                  className="w-full sm:w-auto sm:ml-auto sm:flex rounded-full"
                  disabled={
                    !activeOperatorCfg?.isEnabled ||
                    !activeProduct?.isActive ||
                    (activeProduct?.productType === 'sim_to_esim_conversion' &&
                      existingMsisdn.trim().length < 9)
                  }
                  rightIcon={<ArrowRight className="h-4 w-4" />}
                  onClick={() => setStep(2)}
                >
                  Continue to Device Check
                </Button>
              </div>
            </>
          )}
        </Card>
      )}

      {/* STEP 2: DEVICE COMPATIBILITY */}
      {step === 2 && (
        <Card padding="sm" className="sm:p-6 rounded-2xl border-[#DADCE0] dark:border-[#24344D] space-y-5">
          <CardHeader
            title="Step 2 · Confirm Device eSIM Compatibility"
            subtitle="Make sure your smartphone supports eSIM before starting your order"
          />

          <div className="rounded-2xl bg-[#E8F0FE]/70 dark:bg-[#13254A] border border-[#C7D6FE] dark:border-[#2B4C8C] p-3.5 space-y-1.5 text-xs">
            <p className="font-semibold text-[#1A73E8] dark:text-[#60A5FA] flex items-center gap-1.5">
              <Smartphone className="h-3.5 w-3.5 shrink-0" />
              How to verify on your phone in 5 seconds:
            </p>
            <p className="text-[#1E293B] dark:text-[#E2E8F0]">
              1. Open your Phone app and dial <strong className="tabular-nums">*#06#</strong> — look
              for a 32-digit <strong>EID</strong> number.
            </p>
            <p className="text-[#1E293B] dark:text-[#E2E8F0]">
              2. Ensure your phone is <strong>carrier-unlocked</strong> (not locked to a foreign
              network).
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3.5">
            <Input
              label="Search Supported Models"
              inputKind="search"
              placeholder="iPhone 15, Galaxy S24, Pixel..."
              value={deviceQuery}
              onChange={(e) => setDeviceQuery(e.target.value)}
              helperText="Tap a matching device below to auto-fill your model."
            />
            <div>
              <label className="block text-sm font-medium text-[#111827] dark:text-[#F8FAFC] mb-1.5">
                Device Operating System
              </label>
              <div className="grid grid-cols-2 gap-2">
                {(['ios', 'android'] as const).map((os) => (
                  <button
                    key={os}
                    type="button"
                    onClick={() => setSelectedOs(os)}
                    className={`min-h-[44px] py-2.5 px-3 rounded-xl border-2 text-xs sm:text-sm font-semibold cursor-pointer transition-colors ${
                      selectedOs === os
                        ? 'border-[#1A73E8] bg-[#E8F0FE] dark:bg-[#13254A] text-[#1A73E8] dark:text-[#60A5FA]'
                        : 'border-[#DADCE0] dark:border-[#24344D] text-[#5F6368] dark:text-[#CBD5E1]'
                    }`}
                  >
                    {os === 'ios' ? 'Apple iOS' : 'Android'}
                  </button>
                ))}
              </div>
              <p className="mt-1.5 text-xs text-[#5F6368] dark:text-[#94A3B8]">
                Used to tailor your Step 6 install guide.
              </p>
            </div>
          </div>

          {filteredDevices.length === 0 ? (
            <Alert tone="info">
              No preset models matched your search. You can type your exact handset model below and
              confirm *#06# EID support.
            </Alert>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              {filteredDevices.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  disabled={!d.esimSupported}
                  onClick={() => {
                    setSelectedDeviceModel(`${d.brand} ${d.modelFamily}`);
                    setSelectedOs(d.osPlatform);
                  }}
                  className={`w-full text-left p-3 rounded-2xl border transition-colors ${
                    !d.esimSupported
                      ? 'opacity-65 cursor-not-allowed border-[#FECACA] bg-[#FEF2F2]/40 dark:bg-[#7F1D1D]/15'
                      : selectedDeviceModel.includes(d.modelFamily)
                        ? 'border-[#1A73E8] bg-[#E8F0FE]/60 dark:bg-[#13254A] cursor-pointer'
                        : 'border-[#DADCE0] dark:border-[#24344D] cursor-pointer'
                  }`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-semibold text-[#1A73E8] dark:text-[#60A5FA]">
                      {d.brand}
                    </span>
                    <StatusBadge
                      status={d.esimSupported ? 'verified' : 'failed'}
                      label={d.esimSupported ? 'Supported' : 'No eSIM'}
                    />
                  </div>
                  <p className="mt-1 text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
                    {d.modelFamily}
                  </p>
                  <p className="mt-0.5 text-[11px] text-[#5F6368] dark:text-[#CBD5E1] leading-snug">
                    {d.regionalCaveat}
                  </p>
                </button>
              ))}
            </div>
          )}

          <Input
            label="Your Selected Handset Model"
            value={selectedDeviceModel}
            onChange={(e) => setSelectedDeviceModel(e.target.value)}
            helperText="Confirm the exact model you will scan the eSIM QR code onto."
            required
          />

          <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#F8FAFD] dark:bg-[#111C2E] border border-[#DADCE0] dark:border-[#24344D] cursor-pointer">
            <input
              type="checkbox"
              checked={deviceConfirmed}
              onChange={(e) => setDeviceConfirmed(e.target.checked)}
              className="mt-0.5 h-5 w-5 rounded accent-[#1A73E8] shrink-0"
            />
            <span className="text-xs sm:text-sm text-[#111827] dark:text-[#F8FAFC] leading-relaxed">
              I confirm my phone is carrier-unlocked and displays an EID when dialing{' '}
              <strong className="tabular-nums">*#06#</strong>.
            </span>
          </label>

          <div className="grid grid-cols-[auto_1fr] sm:flex sm:items-center sm:justify-between gap-2.5 pt-1">
            <Button
              variant="secondary"
              size="lg"
              className="rounded-full"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => setStep(1)}
            >
              Back
            </Button>
            <Button
              size="lg"
              className="w-full sm:w-auto rounded-full"
              disabled={!deviceConfirmed}
              loading={busy}
              rightIcon={<ArrowRight className="h-4 w-4" />}
              onClick={handleStartDraftAndProceed}
            >
              Next: Fayda KYC
            </Button>
          </div>
        </Card>
      )}

      {/* STEP 3: FAYDA KYC CONSENT BOUNDARY */}
      {step === 3 && order && (
        <Card padding="sm" className="sm:p-6 rounded-2xl border-[#DADCE0] dark:border-[#24344D] space-y-5">
          <CardHeader
            title="Step 3 · Subscriber Fayda Identity"
            subtitle={`Order ${order.orderNumber} · Required for Ethiopian SIM registration`}
          />

          <div className="rounded-2xl bg-[#E8F0FE]/70 dark:bg-[#13254A] border border-[#C7D6FE] dark:border-[#2B4C8C] p-3.5 flex items-start gap-2.5 text-xs text-[#1E293B] dark:text-[#E2E8F0]">
            <Fingerprint className="h-4 w-4 text-[#1A73E8] dark:text-[#60A5FA] shrink-0 mt-0.5" />
            <span>
              Enter your personal details exactly as shown on your Ethiopian Fayda ID card or
              Fayda app. Never share official verification OTPs with anyone.
            </span>
          </div>

          <form onSubmit={handleSubmitKyc} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Full Legal Name (per Fayda ID)"
                placeholder="e.g. Abebe Bikila"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                helperText="Include your given, father's, and grandfather's name as printed on Fayda."
                required
              />
              <Input
                label="Fayda FAN / National ID Reference"
                placeholder="e.g. FAN-1234-5678"
                value={faydaFan}
                onChange={(e) => setFaydaFan(e.target.value)}
                helperText="Your 12-digit FIN or FAN reference from your Fayda ID."
                required
              />
            </div>

            <Input
              label="Subscriber Contact Mobile"
              type="tel"
              placeholder="+251911223344"
              value={contactPhone}
              onChange={(e) => setContactPhone(e.target.value)}
              helperText="Include +251 country code. Used for activation updates and support."
              required
            />

            <label className="flex items-start gap-3 p-3.5 rounded-2xl bg-[#E8F0FE]/60 dark:bg-[#13254A] border border-[#C7D6FE] dark:border-[#2B4C8C] cursor-pointer">
              <input
                type="checkbox"
                checked={kycConsent}
                onChange={(e) => setKycConsent(e.target.checked)}
                className="mt-0.5 h-5 w-5 rounded accent-[#1A73E8] shrink-0"
                required
              />
              <span className="text-xs sm:text-sm text-[#111827] dark:text-[#F8FAFC] leading-relaxed">
                I am the subscriber registering this eSIM line personally and authorize Yene Tele to
                submit my verification details to the operator.
              </span>
            </label>

            <div className="grid grid-cols-[auto_1fr] sm:flex sm:items-center sm:justify-between gap-2.5 pt-1">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                className="rounded-full"
                leftIcon={<ArrowLeft className="h-4 w-4" />}
                onClick={() => setStep(2)}
              >
                Back
              </Button>
              <Button
                type="submit"
                size="lg"
                className="w-full sm:w-auto rounded-full"
                loading={busy}
                leftIcon={<Fingerprint className="h-4 w-4" />}
              >
                Verify &amp; Pick Number
              </Button>
            </div>
          </form>
        </Card>
      )}

      {/* STEP 4: NUMBER AVAILABILITY & SELECTION */}
      {step === 4 && order && (
        <Card padding="sm" className="sm:p-6 rounded-2xl border-[#DADCE0] dark:border-[#24344D] space-y-5">
          <CardHeader
            title="Step 4 · Choose Your Mobile Number"
            subtitle={
              activeOperatorCfg?.supportsPrePaymentReservation
                ? 'Numbers are held for 15 minutes during checkout so nobody else can claim yours.'
                : 'Select your preferred option; availability is confirmed with the operator at payment.'
            }
          />

          {order.productType === 'sim_to_esim_conversion' ? (
            <Alert tone="info" title={`Converting existing line: ${order.existingMsisdn ?? ''}`}>
              Your existing mobile number will move to eSIM once payment and operator verification
              complete.
            </Alert>
          ) : activeOperatorCfg?.numberAvailabilityMode !== 'operator_assigned' ? (
            <div className="space-y-4">
              <div className="space-y-3">
                <Input
                  label="Search Available Digits"
                  inputKind="search"
                  placeholder="Search suffix e.g. 101, 777..."
                  value={numberSearch}
                  onChange={(e) => setNumberSearch(e.target.value)}
                  helperText="Search any lucky digits or ending pattern."
                />
                <div>
                  <p className="text-xs font-semibold text-[#5F6368] dark:text-[#94A3B8] mb-1.5">
                    Filter by Number Tier
                  </p>
                  <div className="flex items-center gap-1.5 overflow-x-auto pb-1">
                    {(['all', 'standard', 'bronze', 'silver', 'gold', 'platinum'] as const).map(
                      (tier) => (
                        <button
                          key={tier}
                          type="button"
                          onClick={() => setTierFilter(tier)}
                          className={`min-h-[38px] px-3.5 py-1.5 rounded-full border text-xs font-semibold capitalize whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                            tierFilter === tier
                              ? 'border-[#1A73E8] bg-[#E8F0FE] dark:bg-[#13254A] text-[#1A73E8] dark:text-[#60A5FA]'
                              : 'border-[#DADCE0] dark:border-[#24344D] text-[#5F6368] dark:text-[#CBD5E1]'
                          }`}
                        >
                          {tier}
                        </button>
                      ),
                    )}
                  </div>
                </div>
              </div>

              {numbersLoading ? (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {[0, 1, 2].map((idx) => (
                    <div
                      key={idx}
                      className="h-16 rounded-2xl border border-[#DADCE0] dark:border-[#24344D] bg-[#F8FAFD] dark:bg-[#111C2E] animate-pulse"
                    />
                  ))}
                </div>
              ) : numbers.length === 0 ? (
                <Alert tone="warning">
                  No matching numbers were found for this filter. Try clearing your search or
                  switching tier filters.
                </Alert>
              ) : (
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
                  {numbers.map((item) => {
                    const active =
                      activeOperatorCfg?.numberAvailabilityMode === 'stock_pool'
                        ? selectedStockId === item.id
                        : selectedDirectMsisdn === item.msisdn;
                    return (
                      <button
                        key={item.id}
                        type="button"
                        onClick={() => {
                          setSelectedStockId(item.id);
                          setSelectedDirectMsisdn(item.msisdn);
                          setPreferredTier(item.numberTier);
                        }}
                        className={`w-full min-h-[60px] text-left p-3.5 rounded-2xl border-2 transition-colors cursor-pointer ${
                          active
                            ? 'border-[#1A73E8] bg-[#E8F0FE] dark:bg-[#13254A]'
                            : 'border-[#DADCE0] dark:border-[#24344D] hover:border-[#4285F4]'
                        }`}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <span className="text-sm font-bold text-[#111827] dark:text-[#F8FAFC] tabular-nums">
                            {item.msisdn}
                          </span>
                          <span className="px-2 py-0.5 rounded-md bg-[#F1F5F9] dark:bg-[#1E293B] text-[11px] font-medium capitalize text-[#475569] dark:text-[#CBD5E1]">
                            {item.numberTier}
                          </span>
                        </div>
                        <p className="mt-1 text-[11px] text-[#5F6368] dark:text-[#94A3B8]">
                          {item.supportsPrePaymentReservation
                            ? '15-min checkout hold included'
                            : 'Verified at payment'}
                        </p>
                      </button>
                    );
                  })}
                </div>
              )}

              {selectedNumberPreview && (
                <div className="rounded-2xl bg-[#E8F0FE]/70 dark:bg-[#13254A] border border-[#C7D6FE] dark:border-[#2B4C8C] px-3.5 py-2.5 flex items-center justify-between gap-2 text-xs">
                  <span className="text-[#475569] dark:text-[#CBD5E1]">Selected Number</span>
                  <strong className="text-sm font-bold text-[#1A73E8] dark:text-[#60A5FA] tabular-nums">
                    {selectedNumberPreview}
                  </strong>
                </div>
              )}
            </div>
          ) : (
            <div className="space-y-3">
              <Alert tone="info" title="Number Assigned Upon Issuance">
                This operator assigns your mobile number during issuance. Choose your preferred
                number tier below.
              </Alert>
              <div className="grid grid-cols-2 sm:grid-cols-5 gap-2">
                {(['standard', 'bronze', 'silver', 'gold', 'platinum'] as NumberTier[]).map((tier) => (
                  <button
                    key={tier}
                    type="button"
                    onClick={() => setPreferredTier(tier)}
                    className={`min-h-[44px] py-2.5 px-3 rounded-full border-2 text-xs font-semibold capitalize cursor-pointer ${
                      preferredTier === tier
                        ? 'border-[#1A73E8] bg-[#E8F0FE] dark:bg-[#13254A] text-[#1A73E8] dark:text-[#60A5FA]'
                        : 'border-[#DADCE0] dark:border-[#24344D] text-[#5F6368] dark:text-[#CBD5E1]'
                    }`}
                  >
                    {tier}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-[auto_1fr] sm:flex sm:items-center sm:justify-between gap-2.5 pt-1">
            <Button
              variant="secondary"
              size="lg"
              className="rounded-full"
              leftIcon={<ArrowLeft className="h-4 w-4" />}
              onClick={() => setStep(3)}
            >
              Back
            </Button>
            <Button
              size="lg"
              className="w-full sm:w-auto rounded-full"
              loading={busy}
              disabled={
                order.productType !== 'sim_to_esim_conversion' &&
                activeOperatorCfg?.numberAvailabilityMode !== 'operator_assigned' &&
                numbers.length === 0
              }
              rightIcon={<ArrowRight className="h-4 w-4" />}
              onClick={handleReserveNumber}
            >
              Confirm &amp; Review
            </Button>
          </div>
        </Card>
      )}

      {/* STEP 5: ORDER REVIEW & CHAPA CHECKOUT */}
      {step === 5 && order && (
        <Card padding="sm" className="sm:p-6 rounded-2xl border-[#DADCE0] dark:border-[#24344D] space-y-5">
          <CardHeader
            title="Step 5 · Review Order &amp; Chapa Payment"
            subtitle={`Order ${order.orderNumber} · Verified server-side before provisioning`}
          />

          <div className="rounded-2xl border border-[#DADCE0] dark:border-[#24344D] bg-[#F8FAFD] dark:bg-[#111C2E] px-4 py-2 divide-y divide-[#DADCE0] dark:divide-[#24344D] text-sm">
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[#5F6368] dark:text-[#94A3B8]">Operator</span>
              <span className="font-semibold text-right">
                {order.operatorCode === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[#5F6368] dark:text-[#94A3B8]">Service</span>
              <span className="font-medium text-right">
                {order.productType === 'sim_to_esim_conversion'
                  ? 'SIM to eSIM Conversion'
                  : 'New Digital eSIM Line'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[#5F6368] dark:text-[#94A3B8]">Device</span>
              <span className="font-medium text-right truncate max-w-[200px] sm:max-w-xs">
                {order.deviceModel ?? 'Confirmed eSIM Device'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[#5F6368] dark:text-[#94A3B8]">Mobile Number</span>
              <span className="font-semibold tabular-nums text-right">
                {order.reservedMsisdn ?? `Assigned (${order.selectedNumberTier})`}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[#5F6368] dark:text-[#94A3B8]">Hold Status</span>
              <span className="text-xs font-medium text-[#111827] dark:text-[#F8FAFC] text-right">
                {order.numberReservationConfirmed
                  ? 'Held for 15 minutes'
                  : 'Verified at payment'}
              </span>
            </div>
            <div className="flex items-center justify-between gap-3 py-2.5">
              <span className="text-[#5F6368] dark:text-[#94A3B8]">Fayda Identity</span>
              <StatusBadge status="verified" label="Verified" />
            </div>
            <div className="flex items-center justify-between gap-3 py-3">
              <span className="font-semibold">Total Due</span>
              <span className="text-base font-bold text-[#1A73E8] dark:text-[#60A5FA] tabular-nums">
                {order.amountEtb.toFixed(2)} ETB
              </span>
            </div>
          </div>

          {!txRef ? (
            <div className="grid grid-cols-[auto_1fr] sm:flex sm:items-center sm:justify-between gap-2.5 pt-1">
              <Button
                variant="secondary"
                size="lg"
                className="rounded-full"
                leftIcon={<ArrowLeft className="h-4 w-4" />}
                onClick={() => setStep(4)}
              >
                Back
              </Button>
              <Button
                size="lg"
                className="w-full sm:w-auto rounded-full"
                loading={busy}
                leftIcon={<CreditCard className="h-4 w-4" />}
                onClick={handleInitChapa}
              >
                Pay with Chapa
              </Button>
            </div>
          ) : (
            <div className="space-y-3.5">
              <Alert tone="info" title={`Payment Reference: ${txRef}`}>
                {!paymentIsSandbox && checkoutUrl && checkoutUrl.startsWith('https://')
                  ? 'Complete checkout on Chapa, then tap Verify Payment below to unlock your eSIM QR code.'
                  : 'Your Chapa payment reference is ready. Tap below to verify payment and activate your eSIM.'}
              </Alert>
              <div className="flex flex-col sm:flex-row gap-2.5">
                {!paymentIsSandbox && checkoutUrl && checkoutUrl.startsWith('https://') && (
                  <a
                    href={checkoutUrl}
                    target="_top"
                    rel="noopener noreferrer"
                    className="w-full sm:w-auto min-h-[48px] inline-flex items-center justify-center gap-2 rounded-full px-6 text-base font-semibold bg-[#1A73E8] text-white hover:bg-[#1557B0] transition-colors"
                  >
                    <CreditCard className="h-4 w-4" />
                    <span>Open Chapa Checkout</span>
                  </a>
                )}
                <Button
                  size="lg"
                  className="w-full sm:w-auto rounded-full"
                  variant={paymentIsSandbox ? 'primary' : 'secondary'}
                  loading={busy}
                  leftIcon={<ShieldCheck className="h-4 w-4" />}
                  onClick={handleVerifyChapaAndFulfill}
                >
                  Verify Payment &amp; Activate
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      {/* STEP 6: DELIVERY, ASYNC PENDING POLL, OR MANUAL FULFILLMENT QUEUE */}
      {step === 6 && order && (
        <Card padding="sm" className="sm:p-6 rounded-2xl border-[#DADCE0] dark:border-[#24344D] space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <CardHeader
              title="Step 6 · eSIM Provisioning &amp; Delivery"
              subtitle={`Order ${order.orderNumber}${order.reservedMsisdn ? ` · ${order.reservedMsisdn}` : ''}`}
            />
            <StatusBadge
              status={
                order.status === 'awaiting_manual_fulfillment'
                  ? 'manual'
                  : order.status === 'operator_pending'
                    ? 'processing'
                    : order.status === 'failed' || order.status === 'refund_pending'
                      ? 'failed'
                      : 'verified'
              }
              label={order.status.replace(/_/g, ' ')}
            />
          </div>

          {order.status === 'awaiting_manual_fulfillment' ? (
            <div className="space-y-4">
              <Alert tone="warning" title="Payment Verified · Processing Partner Issuance">
                Your Chapa payment and Fayda KYC are verified. Your eSIM QR code will appear in My
                eSIMs automatically once issuance completes.
              </Alert>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Button size="lg" className="w-full rounded-full" onClick={() => navigate('/app/orders')}>
                  Track Order Status
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full rounded-full"
                  onClick={() => navigate('/app')}
                >
                  Customer Dashboard
                </Button>
              </div>
            </div>
          ) : order.status === 'operator_pending' ? (
            <div className="space-y-4">
              <Alert tone="info" title="Payment Verified · Activation Pending">
                Your payment succeeded and your request ({order.operatorTransactionRef ?? 'pending'})
                is being activated by the telecom operator.
              </Alert>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Button
                  size="lg"
                  className="w-full rounded-full"
                  loading={busy}
                  leftIcon={<RefreshCw className="h-4 w-4" />}
                  onClick={handlePollProvisioning}
                >
                  Refresh Status
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full rounded-full"
                  onClick={() => navigate('/app/orders')}
                >
                  View Order History
                </Button>
              </div>
            </div>
          ) : order.status === 'failed' || order.status === 'refund_pending' ? (
            <div className="space-y-4">
              <Alert tone="error" title="Provisioning Could Not Complete">
                {order.failureReason ?? 'Operator provisioning failed.'}{' '}
                {order.paymentStatus === 'refund_pending' &&
                  'Your verified payment is marked Refund Pending for finance review.'}
              </Alert>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Button size="lg" className="w-full rounded-full" onClick={() => navigate('/app/orders')}>
                  View Order &amp; Refund
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full rounded-full"
                  onClick={() => navigate('/app/support')}
                >
                  Contact Support
                </Button>
              </div>
            </div>
          ) : (
            <div className="space-y-5">
              {activation && (
                <div className="grid grid-cols-1 md:grid-cols-12 gap-4 items-center">
                  <div className="md:col-span-5 rounded-2xl border border-[#C7D6FE] dark:border-[#2B4C8C] bg-[#E8F0FE] dark:bg-[#13254A] p-4 flex justify-center">
                    <QrCodeDisplay
                      payload={activation.qrPayload}
                      isSandboxSimulation={activation.isSandboxSimulation}
                    />
                  </div>

                  <div className="md:col-span-7 space-y-2.5">
                    {[
                      { label: 'SM-DP+ Address', value: activation.smdpAddress },
                      { label: 'Activation Code', value: activation.activationCode },
                      { label: 'LPA Installation URI', value: activation.lpaUri },
                    ].map((row) => (
                      <div
                        key={row.label}
                        className="p-3 rounded-xl border border-[#DADCE0] dark:border-[#24344D] bg-[#F8FAFD] dark:bg-[#111C2E] flex items-center justify-between gap-2.5"
                      >
                        <div className="min-w-0">
                          <p className="text-[11px] font-medium text-[#5F6368] dark:text-[#94A3B8]">
                            {row.label}
                          </p>
                          <p className="text-xs font-semibold text-[#111827] dark:text-[#F8FAFC] break-all tabular-nums">
                            {row.value}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyText(row.label, row.value)}
                          className="min-h-[40px] inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border border-[#DADCE0] dark:border-[#24344D] bg-white dark:bg-[#162338] text-xs font-semibold cursor-pointer shrink-0"
                        >
                          <Copy className="h-3.5 w-3.5" />
                          <span>{copiedField === row.label ? 'Copied' : 'Copy'}</span>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="rounded-2xl bg-[#F8FAFD] dark:bg-[#111C2E] border border-[#DADCE0] dark:border-[#24344D] p-3.5 space-y-1.5 text-xs text-[#475569] dark:text-[#CBD5E1]">
                <p className="font-semibold text-[#111827] dark:text-[#F8FAFC]">
                  Quick Install Steps ({selectedOs === 'ios' ? 'Apple iOS' : 'Android'}):
                </p>
                {selectedOs === 'ios' ? (
                  <p>
                    Open <strong>Settings → Cellular → Add eSIM → Use QR Code</strong>, then scan
                    the QR above or tap <strong>Enter Details Manually</strong> and paste the SM-DP+
                    address and activation code.
                  </p>
                ) : (
                  <p>
                    Open <strong>Settings → Network &amp; Internet / Connections → SIM Manager → Add
                    eSIM</strong>, then scan the QR above or paste the LPA Installation URI.
                  </p>
                )}
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                <Button
                  size="lg"
                  className="w-full rounded-full"
                  leftIcon={<CheckCircle2 className="h-4 w-4" />}
                  onClick={() => navigate('/app/esims')}
                >
                  Open My eSIMs
                </Button>
                <Button
                  size="lg"
                  variant="secondary"
                  className="w-full rounded-full"
                  onClick={() => navigate('/app/orders')}
                >
                  View Order Receipt
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}
