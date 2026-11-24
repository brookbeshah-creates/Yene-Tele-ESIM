import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/apiClient';
import type {
  EsimProductRecord,
  OperatorCode,
  OperatorConfigRecord,
  SupplyMethod,
} from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';

export function AdminOperatorsPage() {
  const [operators, setOperators] = useState<OperatorConfigRecord[]>([]);
  const [products, setProducts] = useState<EsimProductRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [reason, setReason] = useState('Updating operator configuration and service controls');
  const [priceInputs, setPriceInputs] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    apiRequest<{ operators: OperatorConfigRecord[]; products: EsimProductRecord[] }>(
      '/api/v1/admin/operators',
    )
      .then((res) => {
        setOperators(res.operators);
        setProducts(res.products);
        const initPrices: Record<string, string> = {};
        for (const p of res.products) {
          initPrices[p.id] = String(p.priceEtb ?? p.sandboxPreviewAmountEtb ?? '');
        }
        setPriceInputs(initPrices);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const updateOperator = async (
    code: OperatorCode,
    patch: {
      isEnabled?: boolean;
      activeSupplyMethod?: SupplyMethod;
      integrationStatus?: OperatorConfigRecord['integrationStatus'];
      supportsSimConversion?: boolean;
      supportsPrePaymentReservation?: boolean;
    },
  ) => {
    setErr(null);
    setMsg(null);
    try {
      await apiRequest(`/api/v1/admin/operators/${code}`, {
        method: 'PATCH',
        body: { ...patch, reason },
      });
      setMsg(`Updated ${code} configuration cleanly (audit logged).`);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to update operator configuration.');
    }
  };

  const handleSaveSandboxPrice = async (prod: EsimProductRecord) => {
    setErr(null);
    setMsg(null);
    const val = Number(priceInputs[prod.id]);
    if (!Number.isFinite(val) || val < 0) {
      setErr('Provide a valid non-negative ETB preview amount.');
      return;
    }
    try {
      await apiRequest(`/api/v1/admin/products/${prod.id}`, {
        method: 'PATCH',
        body: { sandboxPreviewAmountEtb: val, reason },
      });
      setMsg(`Updated sandbox test charge for ${prod.name}.`);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to update product pricing.');
    }
  };

  if (loading) return <LoadingState message="Loading operator configurations..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Operator Supply Modes &amp; Integration Health</h1>
        <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
          Configure operator availability, fulfillment adapter, SIM conversion gates, and pricing
          configuration with mandatory audit logging.
        </p>
      </div>

      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}

      <Input
        label="Mandatory Audit Reason for Configuration Changes"
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        required
      />

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {operators.map((op) => (
          <Card key={op.operatorCode} className="space-y-4">
            <CardHeader
              title={op.displayName}
              subtitle={op.customerVisibleNote}
              action={
                <StatusBadge
                  status={!op.isEnabled ? 'failed' : op.integrationStatus === 'live' ? 'verified' : 'sandbox'}
                  label={!op.isEnabled ? 'Disabled' : op.integrationStatus}
                />
              }
            />

            <div className="grid grid-cols-4 gap-2 p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D] text-center text-xs">
              <div>
                <p className="text-[#64748B]">Orders</p>
                <p className="font-bold tabular-nums">{op.healthSummary.totalOrders}</p>
              </div>
              <div>
                <p className="text-[#64748B]">Issued</p>
                <p className="font-bold text-[#047857] dark:text-[#6EE7B7] tabular-nums">
                  {op.healthSummary.provisionedOrders}
                </p>
              </div>
              <div>
                <p className="text-[#64748B]">Pending</p>
                <p className="font-bold text-[#0A2DB8] dark:text-[#60A5FA] tabular-nums">
                  {op.healthSummary.pendingOrders}
                </p>
              </div>
              <div>
                <p className="text-[#64748B]">Failed</p>
                <p className="font-bold text-[#B91C1C] dark:text-[#FCA5A5] tabular-nums">
                  {op.healthSummary.failedOrders}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-xs font-semibold text-[#64748B]">Active Supply Method</p>
              <div className="grid grid-cols-3 gap-2">
                {(['stock_based', 'direct_api', 'manual_processing'] as SupplyMethod[]).map((m) => (
                  <button
                    key={m}
                    type="button"
                    onClick={() => updateOperator(op.operatorCode, { activeSupplyMethod: m })}
                    className={`py-2 px-2 rounded-lg border text-xs font-semibold cursor-pointer ${
                      op.activeSupplyMethod === m
                        ? 'bg-[#0A2DB8] text-white border-[#0A2DB8]'
                        : 'border-[#E5E7EB] dark:border-[#24344D]'
                    }`}
                  >
                    {m.replace('_', ' ')}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[#E5E7EB] dark:border-[#24344D]">
              <div className="text-xs">
                <p className="font-medium">Operator Storefront Status</p>
                <p className="text-[#64748B]">Disabled operators cannot be purchased</p>
              </div>
              <Button
                size="sm"
                variant={op.isEnabled ? 'secondary' : 'primary'}
                onClick={() => updateOperator(op.operatorCode, { isEnabled: !op.isEnabled })}
              >
                {op.isEnabled ? 'Disable Operator' : 'Enable Operator'}
              </Button>
            </div>

            <div className="flex items-center justify-between pt-3 border-t border-[#E5E7EB] dark:border-[#24344D]">
              <div className="text-xs">
                <p className="font-medium">Physical SIM → eSIM Conversion</p>
                <p className="text-[#64748B]">Requires explicit operator authorization</p>
              </div>
              <Button
                size="sm"
                variant="secondary"
                onClick={() =>
                  updateOperator(op.operatorCode, {
                    supportsSimConversion: !op.supportsSimConversion,
                  })
                }
              >
                {op.supportsSimConversion ? 'Disable Conversion' : 'Enable Conversion'}
              </Button>
            </div>
          </Card>
        ))}
      </div>

      <Card className="space-y-4">
        <CardHeader
          title="Configurable Sandbox Pricing &amp; Product Catalog"
          subtitle="Commercial prices remain pending formal operator agreement until finalized."
        />
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {products.map((p) => (
            <div
              key={p.id}
              className="p-3.5 rounded-xl border border-[#E5E7EB] dark:border-[#24344D] space-y-2.5"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{p.name}</p>
                <StatusBadge
                  status={p.isActive ? 'sandbox' : 'coming_soon'}
                  label={p.isActive ? 'Enabled' : 'Disabled'}
                />
              </div>
              <div className="flex items-end gap-2">
                <Input
                  label="Sandbox Preview Charge (ETB)"
                  type="number"
                  value={priceInputs[p.id] ?? ''}
                  onChange={(e) => setPriceInputs((prev) => ({ ...prev, [p.id]: e.target.value }))}
                />
                <Button size="sm" variant="secondary" onClick={() => handleSaveSandboxPrice(p)}>
                  Save
                </Button>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
