import React, { useEffect, useState } from 'react';
import { Building2, Layers, ShieldCheck, UserPlus } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiRequest } from '../../lib/apiClient';
import type {
  BusinessAccountRecord,
  BusinessBulkOrderRecord,
  BusinessMemberRecord,
  BusinessMemberRole,
  NumberTier,
  OperatorCode,
} from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input, Select } from '../../components/ui/Input';
import { EmptyState, LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table } from '../../components/ui/Table';

export function BusinessPortalPage() {
  const { profile } = useAuth();
  const [account, setAccount] = useState<BusinessAccountRecord | null>(null);
  const [memberRole, setMemberRole] = useState<BusinessMemberRole | null>(null);
  const [members, setMembers] = useState<BusinessMemberRecord[]>([]);
  const [bulkOrders, setBulkOrders] = useState<BusinessBulkOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const [companyName, setCompanyName] = useState('');
  const [tinNumber, setTinNumber] = useState('');
  const [contactEmail, setContactEmail] = useState(profile?.user.email ?? '');
  const [contactPhone, setContactPhone] = useState('+251911000000');
  const [city, setCity] = useState('Addis Ababa');

  const [memberName, setMemberName] = useState('');
  const [memberEmail, setMemberEmail] = useState('');
  const [newMemberRole, setNewMemberRole] = useState<BusinessMemberRole>('buyer');

  const [operatorCode, setOperatorCode] = useState<OperatorCode>('ethio_telecom');
  const [serviceType, setServiceType] = useState<'new_esim_line' | 'sim_to_esim_conversion'>('new_esim_line');
  const [quantity, setQuantity] = useState('10');
  const [preferredTier, setPreferredTier] = useState<NumberTier>('standard');
  const [departmentNote, setDepartmentNote] = useState('');

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    apiRequest<{
      account: BusinessAccountRecord | null;
      memberRole: BusinessMemberRole | null;
      members: BusinessMemberRecord[];
      bulkOrders: BusinessBulkOrderRecord[];
    }>('/api/v1/business')
      .then((res) => {
        setAccount(res.account);
        setMemberRole(res.memberRole);
        setMembers(res.members);
        setBulkOrders(res.bulkOrders);
        if (res.account) {
          setCompanyName(res.account.companyName);
          setTinNumber(res.account.tinNumber);
          setContactEmail(res.account.contactEmail);
          setContactPhone(res.account.contactPhone);
          setCity(res.account.city);
        }
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await apiRequest('/api/v1/business/profile', {
        method: 'POST',
        body: { companyName, tinNumber, contactEmail, contactPhone, city },
      });
      setMsg('Business Account profile saved and queued for commercial verification.');
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to save business profile.');
    } finally {
      setBusy(false);
    }
  };

  const handleAddMember = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await apiRequest('/api/v1/business/members', {
        method: 'POST',
        body: { fullName: memberName, email: memberEmail, role: newMemberRole },
      });
      setMemberName('');
      setMemberEmail('');
      setMsg('Business team member added.');
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to add team member.');
    } finally {
      setBusy(false);
    }
  };

  const handleBulkRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await apiRequest('/api/v1/business/bulk-orders', {
        method: 'POST',
        body: {
          operatorCode,
          serviceType,
          quantity: Number(quantity),
          preferredTier,
          departmentNote,
        },
      });
      setDepartmentNote('');
      setMsg('Bulk eSIM preparation request recorded for commercial quote and stock allocation.');
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to submit bulk eSIM request.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState message="Loading Business Account workspace..." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Business Customer eSIM Portal</h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Register a corporate workspace, manage procurement roles, and prepare multi-line eSIM requests.
          </p>
        </div>
        {account && (
          <StatusBadge
            status={
              account.verificationStatus === 'verified'
                ? 'verified'
                : account.verificationStatus === 'suspended'
                  ? 'failed'
                  : 'pending'
            }
            label={`Business: ${account.verificationStatus.replace(/_/g, ' ')}`}
          />
        )}
      </div>

      <Alert tone="info" title="Commercial Terms & Individual Subscriber KYC Notice">
        <span className="text-xs">
          Bulk eSIM requests do not invent unapproved wholesale discounts or credit terms. Each issued
          Ethiopian telecom line remains subject to operator approval and individual subscriber Fayda
          identity verification prior to activation.
        </span>
      </Alert>

      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card>
          <CardHeader
            title={account ? 'Company Profile & Commercial Status' : 'Register Business Account'}
            subtitle={
              account
                ? `Workspace ID: ${account.id} · Your role: ${memberRole ?? 'owner'}`
                : 'Required before preparing team or bulk eSIM requests'
            }
          />
          <form onSubmit={handleSaveProfile} className="space-y-4">
            <Input
              label="Registered Company / Organization Name"
              value={companyName}
              onChange={(e) => setCompanyName(e.target.value)}
              placeholder="Abay Logistics PLC"
              required
            />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Ethiopian TIN / License Number"
                value={tinNumber}
                onChange={(e) => setTinNumber(e.target.value)}
                placeholder="0045123456"
                required
              />
              <Input
                label="City / Region"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                required
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                label="Corporate Contact Email"
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                required
              />
              <Input
                label="Contact Phone (+251...)"
                value={contactPhone}
                onChange={(e) => setContactPhone(e.target.value)}
                required
              />
            </div>
            <Button type="submit" loading={busy} leftIcon={<Building2 className="h-4 w-4" />}>
              {account ? 'Update Business Profile' : 'Register Business Workspace'}
            </Button>
          </form>
        </Card>

        <Card>
          <CardHeader
            title="Prepare Bulk eSIM Request"
            subtitle="2 to 500 lines · Prepared for Ethio telecom or Safaricom Ethiopia stock & partner allocation"
          />
          {!account ? (
            <EmptyState
              title="Business profile required first"
              description="Complete your company profile on the left to unlock multi-line eSIM request preparation."
            />
          ) : (
            <form onSubmit={handleBulkRequest} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Select
                  label="Telecom Operator"
                  value={operatorCode}
                  onChange={(e) => setOperatorCode(e.target.value as OperatorCode)}
                  options={[
                    { value: 'ethio_telecom', label: 'Ethio telecom' },
                    { value: 'safaricom_ethiopia', label: 'Safaricom Ethiopia' },
                  ]}
                />
                <Select
                  label="Service Type"
                  value={serviceType}
                  onChange={(e) =>
                    setServiceType(e.target.value as 'new_esim_line' | 'sim_to_esim_conversion')
                  }
                  options={[
                    { value: 'new_esim_line', label: 'New eSIM Lines' },
                    { value: 'sim_to_esim_conversion', label: 'Physical SIM to eSIM Migration' },
                  ]}
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <Input
                  label="Line Quantity (2 - 500)"
                  type="number"
                  min={2}
                  max={500}
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  required
                />
                <Select
                  label="Preferred Number Tier"
                  value={preferredTier}
                  onChange={(e) => setPreferredTier(e.target.value as NumberTier)}
                  options={[
                    { value: 'standard', label: 'Standard' },
                    { value: 'bronze', label: 'Bronze' },
                    { value: 'silver', label: 'Silver' },
                    { value: 'gold', label: 'Gold' },
                  ]}
                />
              </div>
              <Input
                label="Department / Rollout Note (Optional)"
                placeholder="e.g. Sales & Field Operations iPhone 15 fleet"
                value={departmentNote}
                onChange={(e) => setDepartmentNote(e.target.value)}
              />
              <Button
                type="submit"
                loading={busy}
                disabled={memberRole === 'viewer'}
                leftIcon={<Layers className="h-4 w-4" />}
              >
                Submit Bulk eSIM Preparation
              </Button>
            </form>
          )}
        </Card>
      </div>

      {account && (
        <>
          <Card>
            <CardHeader
              title={`Team Procurement Members (${members.length})`}
              subtitle="Owners manage members; buyers submit bulk eSIM preparations; viewers inspect order status"
            />
            {memberRole === 'owner' && (
              <form onSubmit={handleAddMember} className="grid grid-cols-1 sm:grid-cols-4 gap-3 mb-4">
                <Input
                  label="Full Name"
                  value={memberName}
                  onChange={(e) => setMemberName(e.target.value)}
                  required
                />
                <Input
                  label="Work Email"
                  type="email"
                  value={memberEmail}
                  onChange={(e) => setMemberEmail(e.target.value)}
                  required
                />
                <Select
                  label="Workspace Role"
                  value={newMemberRole}
                  onChange={(e) => setNewMemberRole(e.target.value as BusinessMemberRole)}
                  options={[
                    { value: 'buyer', label: 'Buyer' },
                    { value: 'viewer', label: 'Viewer' },
                  ]}
                />
                <div className="flex items-end">
                  <Button type="submit" loading={busy} leftIcon={<UserPlus className="h-4 w-4" />} className="w-full">
                    Add Member
                  </Button>
                </div>
              </form>
            )}
            <Table
              rows={members}
              getRowKey={(m) => m.id}
              emptyMessage="Only the business owner is currently listed."
              columns={[
                { key: 'name', header: 'Name', render: (m) => m.fullName },
                { key: 'email', header: 'Email', render: (m) => m.email },
                { key: 'role', header: 'Role', render: (m) => <span className="capitalize font-medium">{m.role}</span> },
                { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status === 'active' ? 'verified' : 'pending'} label={m.status} /> },
              ]}
            />
          </Card>

          <Card>
            <CardHeader
              title={`Bulk eSIM Preparation Queue (${bulkOrders.length})`}
              subtitle="Commercial quote & batch fulfillment status"
            />
            <Table
              rows={bulkOrders}
              getRowKey={(o) => o.id}
              emptyMessage="No bulk eSIM preparation requests submitted yet."
              columns={[
                { key: 'num', header: 'Request #', render: (o) => <span className="font-semibold tabular-nums">{o.requestNumber}</span> },
                { key: 'op', header: 'Operator & Qty', render: (o) => `${o.quantity}x ${o.operatorCode === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia'} (${o.preferredTier})` },
                { key: 'price', header: 'Commercial Pricing', render: (o) => <span className="text-xs text-[#64748B]">{o.pricingNote}</span> },
                { key: 'st', header: 'Status', render: (o) => <StatusBadge status={o.status === 'ready_for_batch_fulfillment' ? 'active' : 'pending'} label={o.status.replace(/_/g, ' ')} /> },
              ]}
            />
          </Card>
        </>
      )}

      <div className="text-xs text-[#64748B] flex items-center gap-1.5">
        <ShieldCheck className="h-3.5 w-3.5 text-[#0A2DB8]" />
        Corporate business accounts stay isolated per company workspace with full staff audit logging.
      </div>
    </div>
  );
}
