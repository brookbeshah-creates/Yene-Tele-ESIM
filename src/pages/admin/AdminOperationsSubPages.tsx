import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { apiRequest } from '../../lib/apiClient';
import { AVAILABLE_PHONE_IMAGE_KEYS } from '../../lib/phoneAssets';
import type {
  AdminRole,
  AuditLogRecord,
  BusinessAccountRecord,
  BusinessBulkOrderRecord,
  OperatorCompatibilityStatus,
  PaymentRecord,
  PhoneCategory,
  PhoneCompatibilityStatus,
  PhoneOrderRecord,
  PhoneProductRecord,
  PhoneUnlockStatus,
  StaffAdminSummary,
  SupportTicketRecord,
  UserAccountStatus,
  VerifiedUserSummary,
} from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Input, Select } from '../../components/ui/Input';
import { LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table } from '../../components/ui/Table';

export function AdminPaymentsPage() {
  const [payments, setPayments] = useState<PaymentRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    apiRequest<{ payments: PaymentRecord[] }>('/api/v1/admin/payments')
      .then((res) => setPayments(res.payments))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleReconcile = async (paymentId: string) => {
    setBusyId(paymentId);
    setMsg(null);
    setErr(null);
    try {
      await apiRequest(`/api/v1/admin/payments/${paymentId}/reconcile`, { method: 'POST' });
      setMsg('Payment reconciled via Chapa server-side verification.');
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to reconcile payment.');
    } finally {
      setBusyId(null);
    }
  };

  const handleRefund = async (paymentId: string) => {
    setBusyId(paymentId);
    setMsg(null);
    setErr(null);
    try {
      await apiRequest(`/api/v1/admin/payments/${paymentId}/refund`, {
        method: 'POST',
        body: { reason: 'Finance reconciliation refund' },
      });
      setMsg('Refund processed cleanly.');
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to process refund.');
    } finally {
      setBusyId(null);
    }
  };

  if (loading) return <LoadingState message="Loading Chapa payment records..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Chapa Payments &amp; Webhook Reconciliation</h1>
        <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
          Inspect server-verified transactions, track idempotent webhook counts, reconcile status,
          and complete pending refunds.
        </p>
      </div>
      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}
      <Table
        rows={payments}
        getRowKey={(p) => p.id}
        emptyMessage="No Chapa transactions recorded yet."
        columns={[
          {
            key: 'tx',
            header: 'Tx Reference',
            render: (p) => (
              <div>
                <p className="tabular-nums font-medium">{p.txRef}</p>
                <p className="text-[11px] text-[#64748B]">Webhooks: {p.webhookEventCount}</p>
              </div>
            ),
          },
          { key: 'amt', header: 'Amount', align: 'right', render: (p) => <span className="tabular-nums font-semibold">{p.amountEtb.toFixed(2)} ETB</span> },
          { key: 'via', header: 'Verified Via', render: (p) => p.verifiedVia ?? 'pending' },
          {
            key: 'st',
            header: 'Status',
            render: (p) => (
              <StatusBadge
                status={
                  p.status === 'verified'
                    ? 'verified'
                    : p.status === 'refunded'
                      ? 'refunded'
                      : p.status === 'failed' || p.status === 'cancelled'
                        ? 'failed'
                        : 'pending'
                }
                label={p.status.replace(/_/g, ' ')}
              />
            ),
          },
          {
            key: 'act',
            header: 'Finance Actions',
            render: (p) => (
              <div className="flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  loading={busyId === p.id}
                  onClick={() => handleReconcile(p.id)}
                >
                  Reconcile
                </Button>
                {['verified', 'refund_pending'].includes(p.status) && (
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={busyId === p.id}
                    onClick={() => handleRefund(p.id)}
                  >
                    Refund
                  </Button>
                )}
              </div>
            ),
          },
        ]}
      />
    </div>
  );
}

export function AdminCustomersPage() {
  const { adminRole } = useAuth();
  const [customers, setCustomers] = useState<VerifiedUserSummary[]>([]);
  const [businesses, setBusinesses] = useState<BusinessAccountRecord[]>([]);
  const [bulkOrders, setBulkOrders] = useState<BusinessBulkOrderRecord[]>([]);
  const [staffList, setStaffList] = useState<StaffAdminSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [staffEmail, setStaffEmail] = useState('');
  const [staffRole, setStaffRole] = useState<AdminRole>('operations_staff');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const reqs: Array<Promise<unknown>> = [
      apiRequest<{ customers: VerifiedUserSummary[] }>('/api/v1/admin/customers').then((r) =>
        setCustomers(r.customers),
      ),
      apiRequest<{ accounts: BusinessAccountRecord[]; bulkOrders: BusinessBulkOrderRecord[] }>(
        '/api/v1/admin/businesses',
      ).then((r) => {
        setBusinesses(r.accounts);
        setBulkOrders(r.bulkOrders);
      }),
    ];
    if (adminRole === 'super_admin') {
      reqs.push(
        apiRequest<{ staff: StaffAdminSummary[] }>('/api/v1/admin/staff')
          .then((r) => setStaffList(r.staff))
          .catch(() => {}),
      );
    }
    Promise.all(reqs).finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [adminRole]);

  const toggleAccountStatus = async (c: VerifiedUserSummary, nextStatus: UserAccountStatus) => {
    setMsg(null);
    setErr(null);
    try {
      await apiRequest(`/api/v1/admin/customers/${c.uid}/status`, {
        method: 'PATCH',
        body: {
          status: nextStatus,
          reason:
            nextStatus === 'active'
              ? 'Customer account reactivated by staff review'
              : 'Suspended pending operations security review',
        },
      });
      setMsg(`Updated account status for ${c.email ?? c.uid} to ${nextStatus}.`);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to update customer account status.');
    }
  };

  const reviewBusiness = async (businessId: string, status: 'verified' | 'suspended') => {
    setMsg(null);
    setErr(null);
    try {
      await apiRequest(`/api/v1/admin/businesses/${businessId}/review`, {
        method: 'POST',
        body: {
          verificationStatus: status,
          commercialNotes:
            status === 'verified'
              ? 'Corporate registration reviewed; custom commercial pricing remains subject to signed operator agreement.'
              : 'Suspended pending corporate compliance verification.',
        },
      });
      setMsg(`Business account marked ${status}.`);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to review business account.');
    }
  };

  const handleGrantStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    setMsg(null);
    setErr(null);
    try {
      await apiRequest('/api/v1/admin/staff', {
        method: 'POST',
        body: { email: staffEmail, role: staffRole },
      });
      setStaffEmail('');
      setMsg('Staff administrator role assigned.');
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to assign staff role.');
    }
  };

  const toggleStaffActive = async (member: StaffAdminSummary) => {
    setMsg(null);
    setErr(null);
    try {
      await apiRequest(`/api/v1/admin/staff/${encodeURIComponent(member.uid)}`, {
        method: 'PATCH',
        body: { active: !member.active },
      });
      setMsg(`Staff access for ${member.email} set to ${!member.active ? 'active' : 'inactive'}.`);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to modify staff record.');
    }
  };

  if (loading) return <LoadingState message="Loading customers, business accounts & staff RBAC..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Customers, Business Accounts &amp; Staff RBAC</h1>
        <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
          Manage customer account statuses, review registered corporate workspaces, and govern internal staff permissions.
        </p>
      </div>
      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}

      <Card>
        <CardHeader title={`Registered Customers (${customers.length})`} />
        <Table
          rows={customers}
          getRowKey={(c) => c.uid}
          emptyMessage="No registered customer sessions yet."
          columns={[
            {
              key: 'name',
              header: 'Customer',
              render: (c) => (
                <div>
                  <p className="font-medium">{c.displayName ?? c.email ?? c.uid}</p>
                  <p className="text-xs text-[#64748B]">{c.email ?? '—'}</p>
                </div>
              ),
            },
            {
              key: 'st',
              header: 'Account Status',
              render: (c) => (
                <StatusBadge
                  status={c.accountStatus === 'active' ? 'verified' : 'failed'}
                  label={c.accountStatus ?? 'active'}
                />
              ),
            },
            { key: 'last', header: 'Last Login', render: (c) => new Date(c.lastLoginAt).toLocaleString() },
            {
              key: 'act',
              header: 'Access Control',
              render: (c) =>
                (c.accountStatus ?? 'active') === 'active' ? (
                  <Button size="sm" variant="destructive" onClick={() => toggleAccountStatus(c, 'suspended')}>
                    Suspend
                  </Button>
                ) : (
                  <Button size="sm" variant="secondary" onClick={() => toggleAccountStatus(c, 'active')}>
                    Reactivate
                  </Button>
                ),
            },
          ]}
        />
      </Card>

      <Card>
        <CardHeader
          title={`Business Customer Accounts (${businesses.length})`}
          subtitle={`${bulkOrders.length} corporate bulk eSIM preparation request(s) logged`}
        />
        <Table
          rows={businesses}
          getRowKey={(b) => b.id}
          emptyMessage="No Business Customer Accounts registered yet."
          columns={[
            {
              key: 'co',
              header: 'Company & TIN',
              render: (b) => (
                <div>
                  <p className="font-semibold">{b.companyName}</p>
                  <p className="text-xs text-[#64748B]">TIN: {b.tinNumber} · {b.city}</p>
                </div>
              ),
            },
            { key: 'terms', header: 'Commercial Terms', render: (b) => b.pricingTermsStatus.replace(/_/g, ' ') },
            {
              key: 'st',
              header: 'Verification',
              render: (b) => (
                <StatusBadge
                  status={b.verificationStatus === 'verified' ? 'verified' : b.verificationStatus === 'suspended' ? 'failed' : 'pending'}
                  label={b.verificationStatus.replace(/_/g, ' ')}
                />
              ),
            },
            {
              key: 'act',
              header: 'Review',
              render: (b) => (
                <div className="flex gap-1.5">
                  {b.verificationStatus !== 'verified' && (
                    <Button size="sm" variant="secondary" onClick={() => reviewBusiness(b.id, 'verified')}>
                      Verify
                    </Button>
                  )}
                  {b.verificationStatus !== 'suspended' && (
                    <Button size="sm" variant="destructive" onClick={() => reviewBusiness(b.id, 'suspended')}>
                      Suspend
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      {adminRole === 'super_admin' && (
        <Card>
          <CardHeader
            title={`Staff Administrator Governance (${staffList.length})`}
            subtitle="Super Admin only — grant least-privilege staff roles or deactivate access"
          />
          <form onSubmit={handleGrantStaff} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
            <Input
              label="Staff Email"
              type="email"
              placeholder="ops@yenetele.et"
              value={staffEmail}
              onChange={(e) => setStaffEmail(e.target.value)}
              required
            />
            <Select
              label="RBAC Role"
              value={staffRole}
              onChange={(e) => setStaffRole(e.target.value as AdminRole)}
              options={[
                { value: 'operations_staff', label: 'Operations Staff' },
                { value: 'finance_staff', label: 'Finance Staff' },
                { value: 'support_staff', label: 'Support Staff' },
                { value: 'agent_supervisor', label: 'Agent Supervisor' },
                { value: 'read_only_auditor', label: 'Read-Only Auditor' },
                { value: 'super_admin', label: 'Super Admin' },
              ]}
            />
            <div className="sm:col-span-2 flex items-end">
              <Button type="submit">Assign Staff Role</Button>
            </div>
          </form>

          <Table
            rows={staffList}
            getRowKey={(s) => s.uid}
            emptyMessage="No additional staff roles granted."
            columns={[
              { key: 'email', header: 'Staff Email', render: (s) => s.email },
              { key: 'role', header: 'Role', render: (s) => <span className="font-medium">{s.role}</span> },
              {
                key: 'active',
                header: 'Status',
                render: (s) => (
                  <StatusBadge status={s.active ? 'active' : 'failed'} label={s.active ? 'Active' : 'Disabled'} />
                ),
              },
              {
                key: 'act',
                header: 'Action',
                render: (s) => (
                  <Button size="sm" variant="secondary" onClick={() => toggleStaffActive(s)}>
                    {s.active ? 'Disable' : 'Enable'}
                  </Button>
                ),
              },
            ]}
          />
        </Card>
      )}
    </div>
  );
}

export function AdminPhonesPage() {
  const { adminRole } = useAuth();
  const [products, setProducts] = useState<PhoneProductRecord[]>([]);
  const [orders, setOrders] = useState<PhoneOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<PhoneProductRecord | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);

  const [formBrand, setFormBrand] = useState('Apple');
  const [formCategory, setFormCategory] = useState<PhoneCategory>('iphone');
  const [formModel, setFormModel] = useState('');
  const [formExactModelNumber, setFormExactModelNumber] = useState('');
  const [formRegionalVariant, setFormRegionalVariant] = useState('Global / Middle East Variant');
  const [formStorage, setFormStorage] = useState('128 GB');
  const [formCondition, setFormCondition] = useState('Brand New · Sealed');
  const [formWarranty, setFormWarranty] = useState('1-Year Seller Warranty');
  const [formCompat, setFormCompat] = useState<PhoneCompatibilityStatus>('verified_compatible');
  const [formUnlock, setFormUnlock] = useState<PhoneUnlockStatus>('verified_unlocked');
  const [formEthioCompat, setFormEthioCompat] = useState<OperatorCompatibilityStatus>('verified');
  const [formSafariCompat, setFormSafariCompat] = useState<OperatorCompatibilityStatus>('verified');
  const [formNotes, setFormNotes] = useState('');
  const [formEvidence, setFormEvidence] = useState('');
  const [formImageKey, setFormImageKey] = useState('iphone-15');
  const [formFeatured, setFormFeatured] = useState(false);
  const [formPriceEtb, setFormPriceEtb] = useState('');
  const [formSandboxPriceEtb, setFormSandboxPriceEtb] = useState('');
  const [formStockQty, setFormStockQty] = useState(5);
  const [formActive, setFormActive] = useState(true);
  const [formReason, setFormReason] = useState('');

  const load = () => {
    setLoading(true);
    apiRequest<{ products: PhoneProductRecord[]; orders: PhoneOrderRecord[] }>('/api/v1/admin/phones')
      .then((res) => {
        setProducts(res.products);
        setOrders(res.orders);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const openCreate = () => {
    setEditing(null);
    setCreating(true);
    setFormBrand('Apple');
    setFormCategory('iphone');
    setFormModel('');
    setFormExactModelNumber('');
    setFormRegionalVariant('Global / Middle East Variant');
    setFormStorage('128 GB');
    setFormCondition('Brand New · Sealed');
    setFormWarranty('1-Year Seller Warranty');
    setFormCompat('needs_verification');
    setFormUnlock('verified_unlocked');
    setFormEthioCompat('unverified');
    setFormSafariCompat('unverified');
    setFormNotes('');
    setFormEvidence('');
    setFormImageKey('');
    setFormFeatured(false);
    setFormPriceEtb('');
    setFormSandboxPriceEtb('');
    setFormStockQty(5);
    setFormActive(true);
    setFormReason('Initial catalog device onboarding');
    setErr(null);
  };

  const openEdit = (p: PhoneProductRecord) => {
    setCreating(false);
    setEditing(p);
    setFormBrand(p.brand);
    setFormCategory(p.category);
    setFormModel(p.model);
    setFormExactModelNumber(p.exactModelNumber);
    setFormRegionalVariant(p.regionalVariant);
    setFormStorage(p.storage);
    setFormCondition(p.condition);
    setFormWarranty(p.warrantySummary);
    setFormCompat(p.esimCompatibilityStatus);
    setFormUnlock(p.networkUnlockStatus);
    setFormEthioCompat(p.ethioTelecomCompatibility);
    setFormSafariCompat(p.safaricomCompatibility);
    setFormNotes(p.compatibilityNotes);
    setFormEvidence(p.compatibilityEvidence ?? '');
    setFormImageKey(p.imageKey ?? '');
    setFormFeatured(p.isFeatured);
    setFormPriceEtb(p.unitPriceEtb !== null ? String(p.unitPriceEtb) : '');
    setFormSandboxPriceEtb(p.sandboxPreviewPriceEtb !== null ? String(p.sandboxPreviewPriceEtb) : '');
    setFormStockQty(p.stockQty);
    setFormActive(p.isActive);
    setFormReason('');
    setErr(null);
  };

  const handleSavePhone = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const payload: Record<string, unknown> = {
        brand: formBrand,
        category: formCategory,
        model: formModel,
        exactModelNumber: formExactModelNumber,
        regionalVariant: formRegionalVariant,
        storage: formStorage,
        condition: formCondition,
        warrantySummary: formWarranty,
        esimCompatibilityStatus: formCompat,
        networkUnlockStatus: formUnlock,
        ethioTelecomCompatibility: formEthioCompat,
        safaricomCompatibility: formSafariCompat,
        compatibilityNotes: formNotes,
        compatibilityEvidence: formEvidence.trim() || null,
        imageKey: formImageKey.trim() || null,
        isFeatured: formFeatured,
        sandboxPreviewPriceEtb: formSandboxPriceEtb.trim() ? Number(formSandboxPriceEtb) : null,
        stockQty: Number(formStockQty),
        isActive: formActive,
        reason: formReason,
      };
      if (adminRole === 'super_admin') {
        payload.unitPriceEtb = formPriceEtb.trim() ? Number(formPriceEtb) : null;
      }

      if (creating) {
        await apiRequest('/api/v1/admin/phones', { method: 'POST', body: payload });
        setMsg(`Created phone listing "${formBrand} ${formModel}".`);
      } else if (editing) {
        await apiRequest(`/api/v1/admin/phones/${editing.id}`, { method: 'PATCH', body: payload });
        setMsg(`Updated "${formBrand} ${formModel}" and recorded audit entry.`);
      }
      setCreating(false);
      setEditing(null);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to save phone product.');
    } finally {
      setSaving(false);
    }
  };

  const advanceOrder = async (
    ord: PhoneOrderRecord,
    nextStatus: PhoneOrderRecord['fulfillmentStatus'],
    klickStatus: PhoneOrderRecord['klickDeliveryPartnerStatus'],
  ) => {
    setErr(null);
    await apiRequest(`/api/v1/admin/phones/orders/${ord.id}`, {
      method: 'PATCH',
      body: {
        fulfillmentStatus: nextStatus,
        klickDeliveryPartnerStatus: klickStatus,
      },
    });
    setMsg(`Order ${ord.orderNumber} updated to ${nextStatus.replace(/_/g, ' ')}.`);
    load();
  };

  if (loading) return <LoadingState message="Loading curated phone catalog & Klick orders..." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Phone Marketplace &amp; Klick Delivery</h1>
          <p className="text-sm text-[#64748B]">
            Govern model-level eSIM compatibility evidence, stock, pricing, and delivery orders.
          </p>
        </div>
        <Button onClick={openCreate}>+ Add Device Model</Button>
      </div>
      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}

      <Card>
        <CardHeader title={`Phone Inventory (${products.length} models)`} />
        <Table
          rows={products}
          getRowKey={(p) => p.id}
          columns={[
            {
              key: 'm',
              header: 'Device & Model Code',
              render: (p) => (
                <div>
                  <p className="font-semibold">
                    {p.brand} {p.model}
                  </p>
                  <p className="text-xs text-[#64748B]">
                    {p.exactModelNumber || 'No model code'} · {p.storage}
                  </p>
                </div>
              ),
            },
            {
              key: 'compat',
              header: 'eSIM Compatibility',
              render: (p) => (
                <StatusBadge
                  status={
                    p.esimCompatibilityStatus === 'verified_compatible'
                      ? 'verified'
                      : p.esimCompatibilityStatus === 'not_compatible'
                        ? 'failed'
                        : 'pending'
                  }
                  label={p.esimCompatibilityStatus.replace(/_/g, ' ')}
                />
              ),
            },
            {
              key: 'price',
              header: 'Price (ETB)',
              align: 'right',
              render: (p) =>
                p.unitPriceEtb !== null ? (
                  <span className="font-semibold tabular-nums">{p.unitPriceEtb.toLocaleString()}</span>
                ) : p.sandboxPreviewPriceEtb ? (
                  <span className="text-xs text-[#64748B] tabular-nums">
                    ~{p.sandboxPreviewPriceEtb.toLocaleString()} (Est.)
                  </span>
                ) : (
                  'Quote'
                ),
            },
            { key: 'qty', header: 'Stock', align: 'right', render: (p) => p.stockQty },
            {
              key: 'act',
              header: 'Edit',
              render: (p) => (
                <Button size="sm" variant="secondary" onClick={() => openEdit(p)}>
                  Edit
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Card>
        <CardHeader title={`Handset Orders (${orders.length})`} />
        <Table
          rows={orders}
          getRowKey={(o) => o.id}
          emptyMessage="No phone orders yet."
          columns={[
            {
              key: 'num',
              header: 'Order & Contact',
              render: (o) => (
                <div>
                  <p className="font-semibold tabular-nums">{o.orderNumber}</p>
                  <p className="text-xs text-[#64748B]">
                    {o.contactPhone ?? 'No phone'} · {o.deliveryCity}
                    {o.deliveryAddress ? ` (${o.deliveryAddress})` : ''}
                  </p>
                </div>
              ),
            },
            {
              key: 'model',
              header: 'Phone & Payment',
              render: (o) => (
                <div>
                  <p className="font-medium">
                    {o.quantity}x {o.phoneModel}
                  </p>
                  <p className="text-xs text-[#64748B] tabular-nums">
                    {o.estimatedTotalEtb.toLocaleString()} ETB · Pay: {o.paymentStatus}
                  </p>
                </div>
              ),
            },
            { key: 'klick', header: 'Delivery Status', render: (o) => o.fulfillmentStatus.replace(/_/g, ' ') },
            {
              key: 'act',
              header: 'Action',
              render: (o) => (
                <div className="flex gap-1.5">
                  {o.fulfillmentStatus === 'awaiting_confirmation' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => advanceOrder(o, 'dispatched_via_klick', 'sandbox_dispatched')}
                    >
                      Mark Dispatched
                    </Button>
                  )}
                  {o.fulfillmentStatus === 'dispatched_via_klick' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      onClick={() => advanceOrder(o, 'delivered', 'delivered')}
                    >
                      Mark Delivered
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Dialog
        open={creating || Boolean(editing)}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        title={creating ? 'Add Device Model' : `Edit ${editing?.model ?? ''}`}
        description="Verified eSIM compatibility requires an exact hardware model number and source evidence."
      >
        <form onSubmit={handleSavePhone} className="space-y-3.5 max-h-[75vh] overflow-y-auto pr-1">
          {err && <Alert tone="error">{err}</Alert>}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Brand" value={formBrand} onChange={(e) => setFormBrand(e.target.value)} required />
            <Select
              label="Category"
              value={formCategory}
              onChange={(e) => setFormCategory(e.target.value as PhoneCategory)}
              options={[
                { value: 'iphone', label: 'iPhone' },
                { value: 'samsung_galaxy', label: 'Samsung Galaxy' },
                { value: 'google_pixel', label: 'Google Pixel' },
                { value: 'other', label: 'Other' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input label="Model Name" value={formModel} onChange={(e) => setFormModel(e.target.value)} required />
            <Input
              label="Exact Model Number (e.g. A3090)"
              value={formExactModelNumber}
              onChange={(e) => setFormExactModelNumber(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <Input label="Storage" value={formStorage} onChange={(e) => setFormStorage(e.target.value)} required />
            <Input label="Condition" value={formCondition} onChange={(e) => setFormCondition(e.target.value)} required />
            <Input
              label="Stock Qty"
              type="number"
              min={0}
              value={formStockQty}
              onChange={(e) => setFormStockQty(Math.max(0, Number(e.target.value) || 0))}
              required
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Input
              label="Regional Variant"
              value={formRegionalVariant}
              onChange={(e) => setFormRegionalVariant(e.target.value)}
            />
            <Input
              label="Warranty Summary"
              value={formWarranty}
              onChange={(e) => setFormWarranty(e.target.value)}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="eSIM Compatibility Status"
              value={formCompat}
              onChange={(e) => setFormCompat(e.target.value as PhoneCompatibilityStatus)}
              options={[
                { value: 'verified_compatible', label: 'Verified eSIM Compatible' },
                { value: 'needs_verification', label: 'Compatibility Needs Verification' },
                { value: 'not_compatible', label: 'Not eSIM Compatible' },
              ]}
            />
            <Select
              label="Network Unlock Status"
              value={formUnlock}
              onChange={(e) => setFormUnlock(e.target.value as PhoneUnlockStatus)}
              options={[
                { value: 'verified_unlocked', label: 'Verified Network Unlocked' },
                { value: 'needs_verification', label: 'Unlock Needs Verification' },
                { value: 'carrier_locked', label: 'Carrier Locked' },
              ]}
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Ethio telecom Readiness"
              value={formEthioCompat}
              onChange={(e) => setFormEthioCompat(e.target.value as OperatorCompatibilityStatus)}
              options={[
                { value: 'verified', label: 'Verified Ready' },
                { value: 'unverified', label: 'Unverified' },
                { value: 'not_compatible', label: 'Not Compatible' },
              ]}
            />
            <Select
              label="Safaricom Ethiopia Readiness"
              value={formSafariCompat}
              onChange={(e) => setFormSafariCompat(e.target.value as OperatorCompatibilityStatus)}
              options={[
                { value: 'verified', label: 'Verified Ready' },
                { value: 'unverified', label: 'Unverified' },
                { value: 'not_compatible', label: 'Not Compatible' },
              ]}
            />
          </div>

          <Input
            label="Compatibility Notes (shown to shoppers)"
            value={formNotes}
            onChange={(e) => setFormNotes(e.target.value)}
          />
          <Input
            label="Verification Evidence (Required if Verified eSIM Compatible)"
            placeholder="e.g. Apple A3090 specs + physical unit *#06# EID check"
            value={formEvidence}
            onChange={(e) => setFormEvidence(e.target.value)}
          />

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Studio Product Image"
              value={formImageKey}
              onChange={(e) => setFormImageKey(e.target.value)}
              options={AVAILABLE_PHONE_IMAGE_KEYS}
            />
            <Input
              label="Sandbox Preview Price (ETB)"
              type="number"
              min={0}
              value={formSandboxPriceEtb}
              onChange={(e) => setFormSandboxPriceEtb(e.target.value)}
            />
          </div>

          {adminRole === 'super_admin' && (
            <Input
              label="Official Commercial Price (ETB — Super Admin)"
              type="number"
              min={1}
              placeholder="Leave blank until supplier price finalized"
              value={formPriceEtb}
              onChange={(e) => setFormPriceEtb(e.target.value)}
            />
          )}

          <div className="flex flex-wrap gap-4 text-xs pt-1">
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formFeatured}
                onChange={(e) => setFormFeatured(e.target.checked)}
              />
              <span>Featured Flagship</span>
            </label>
            <label className="inline-flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={formActive}
                onChange={(e) => setFormActive(e.target.checked)}
              />
              <span>Active in Store</span>
            </label>
          </div>

          <Input
            label="Operational Audit Reason"
            placeholder="Reason for catalog or compatibility change"
            value={formReason}
            onChange={(e) => setFormReason(e.target.value)}
            required
          />

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                setCreating(false);
                setEditing(null);
              }}
            >
              Cancel
            </Button>
            <Button type="submit" loading={saving}>
              Save Device
            </Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}

export function AdminSupportPage() {
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    apiRequest<{ tickets: SupportTicketRecord[] }>('/api/v1/admin/support')
      .then((res) => setTickets(res.tickets))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const resolveTicket = async (id: string) => {
    await apiRequest(`/api/v1/admin/support/${id}`, {
      method: 'PATCH',
      body: { status: 'resolved', adminResponse: 'Reviewed by Yene Tele support operations.' },
    });
    load();
  };

  if (loading) return <LoadingState message="Loading support inquiries..." />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Customer Support Queue</h1>
      <Table
        rows={tickets}
        getRowKey={(t) => t.id}
        emptyMessage="No support tickets open."
        columns={[
          { key: 'sub', header: 'Subject', render: (t) => <div><p className="font-semibold">{t.subject}</p><p className="text-xs text-[#64748B]">{t.email}</p></div> },
          { key: 'cat', header: 'Category', render: (t) => t.category.replace('_', ' ') },
          { key: 'st', header: 'Status', render: (t) => <StatusBadge status={t.status === 'resolved' ? 'active' : 'pending'} label={t.status} /> },
          {
            key: 'act',
            header: 'Action',
            render: (t) =>
              t.status !== 'resolved' && (
                <Button size="sm" variant="secondary" onClick={() => resolveTicket(t.id)}>
                  Resolve
                </Button>
              ),
          },
        ]}
      />
    </div>
  );
}

export function AdminAuditLogsPage() {
  const [logs, setLogs] = useState<AuditLogRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{ logs: AuditLogRecord[] }>('/api/v1/admin/audit-logs')
      .then((res) => setLogs(res.logs))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading immutable audit logs..." />;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold tracking-tight">Operational Audit Logs</h1>
      <Table
        rows={logs}
        getRowKey={(l) => l.id}
        emptyMessage="No audit events logged yet."
        columns={[
          { key: 'time', header: 'Timestamp', render: (l) => <span className="text-xs tabular-nums">{new Date(l.createdAt).toLocaleString()}</span> },
          { key: 'act', header: 'Action', render: (l) => <span className="text-xs font-semibold">{l.action}</span> },
          { key: 'actor', header: 'Actor', render: (l) => l.actorEmail ?? l.actorId },
          { key: 'reason', header: 'Reason / Details', render: (l) => <span className="text-xs text-[#64748B]">{l.reason}</span> },
        ]}
      />
    </div>
  );
}

export function AdminSettingsPage() {
  const [readyInfo, setReadyInfo] = useState<{
    status: string;
    envMode: string;
    persistenceMode: string;
    database: string;
    schemaOk: boolean;
    encryptionKeyPersistent: boolean;
    productionConfigIssues: string[];
  } | null>(null);

  useEffect(() => {
    apiRequest<{
      status: string;
      envMode: string;
      persistenceMode: string;
      database: string;
      schemaOk: boolean;
      encryptionKeyPersistent: boolean;
      productionConfigIssues: string[];
    }>('/api/ready', { requireAuth: false })
      .then(setReadyInfo)
      .catch(() => {});
  }, []);

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Environment, Persistence &amp; Go-Live Readiness</h1>
        <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
          Live server readiness verification without exposing private credential values.
        </p>
      </div>

      {readyInfo && (
        <Card className="space-y-4">
          <CardHeader
            title="Live Readiness Probe"
            action={
              <StatusBadge
                status={readyInfo.status === 'ready' ? 'verified' : 'pending'}
                label={readyInfo.status}
              />
            }
          />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="p-3 rounded-lg bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D]">
              <p className="text-xs text-[#64748B]">Runtime Mode</p>
              <p className="font-semibold uppercase">{readyInfo.envMode}</p>
            </div>
            <div className="p-3 rounded-lg bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D]">
              <p className="text-xs text-[#64748B]">Persistence Backend</p>
              <p className="font-semibold">
                {readyInfo.persistenceMode === 'postgresql'
                  ? `PostgreSQL (${readyInfo.database}, schema ${readyInfo.schemaOk ? 'verified' : 'incomplete'})`
                  : 'In-Memory Sandbox Store'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D]">
              <p className="text-xs text-[#64748B]">eSIM Vault Key Durability</p>
              <p className="font-semibold">
                {readyInfo.encryptionKeyPersistent
                  ? 'Persistent configured AES-256 vault key'
                  : 'Ephemeral sandbox key (must configure persistent key before production)'}
              </p>
            </div>
            <div className="p-3 rounded-lg bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D]">
              <p className="text-xs text-[#64748B]">External Connectors</p>
              <p className="font-semibold">Boundary / Sandbox mode unless live merchant credentials configured</p>
            </div>
          </div>
        </Card>
      )}

      <Card className="space-y-3 text-sm text-[#64748B] dark:text-[#CBD5E1]">
        <p>
          <strong>PostgreSQL Persistence &amp; Migrations:</strong> Schema migrations reside in{' '}
          <code>server/db/migrations/</code> (<code>001_yene_tele_core.sql</code> and{' '}
          <code>002_yene_tele_production_hardening.sql</code>). Production startups enforce strict
          fail-closed validation and abort if PostgreSQL or persistent encryption keys are missing.
        </p>
        <p>
          <strong>External Integrations:</strong> Ethio telecom API, Safaricom Ethiopia API, Fayda
          Identity, Chapa Payment Gateway, and Klick Delivery remain isolated behind explicit
          server-side adapters and never simulate success when production credentials are required.
        </p>
      </Card>
    </div>
  );
}
