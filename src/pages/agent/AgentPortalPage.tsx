import React, { useEffect, useState } from 'react';
import { CheckCircle2, Clock, Copy, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiRequest } from '../../lib/apiClient';
import type {
  AgentApplicationRecord,
  AgentCommissionRecord,
  AgentPayoutRecord,
  AgentProfileRecord,
  EsimOrderRecord,
} from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table } from '../../components/ui/Table';
import { SummaryMetricCard } from '../../components/yegna/DomainCards';

export function AgentPortalPage() {
  const { profile, refreshProfile } = useAuth();
  const [application, setApplication] = useState<AgentApplicationRecord | null>(null);
  const [agent, setAgent] = useState<AgentProfileRecord | null>(null);
  const [dashboard, setDashboard] = useState<{
    agent: AgentProfileRecord;
    attributedOrders: Array<{
      id: string;
      orderNumber: string;
      operatorCode: EsimOrderRecord['operatorCode'];
      status: EsimOrderRecord['status'];
      createdAt: string;
    }>;
    commissions: AgentCommissionRecord[];
    payouts: AgentPayoutRecord[];
  } | null>(null);

  const [fullName, setFullName] = useState(profile?.user.displayName ?? '');
  const [phone, setPhone] = useState('+251911223344');
  const [city, setCity] = useState('Addis Ababa');
  const [businessName, setBusinessName] = useState('');
  const [applicantType, setApplicantType] = useState<'individual_agent' | 'retail_shop' | 'corporate_reseller'>('individual_agent');
  const [experienceSummary, setExperienceSummary] = useState('');

  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [copiedCode, setCopiedCode] = useState(false);

  const loadAgentState = async () => {
    setLoading(true);
    try {
      const appRes = await apiRequest<{
        application: AgentApplicationRecord | null;
        agent: AgentProfileRecord | null;
      }>('/api/v1/agent/application');
      setApplication(appRes.application);
      setAgent(appRes.agent);

      if (appRes.agent?.status === 'approved') {
        const dashRes = await apiRequest<NonNullable<typeof dashboard>>('/api/v1/agent/dashboard');
        setDashboard(dashRes);
      } else {
        setDashboard(null);
      }
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to load agent application status.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadAgentState();
  }, []);

  const handleApply = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErrMsg(null);
    try {
      await apiRequest('/api/v1/agent/application', {
        method: 'POST',
        body: { fullName, phone, city, businessName, applicantType, experienceSummary },
      });
      await refreshProfile();
      await loadAgentState();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to submit agent application.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState message="Checking agent authorization status..." />;

  if (agent?.status === 'approved' && dashboard) {
    return (
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[#0A2DB8] dark:text-[#60A5FA]">
              Approved Yene Tele Agent Dashboard
            </p>
            <h1 className="text-2xl font-bold tracking-tight">{dashboard.agent.fullName}</h1>
          </div>
          <StatusBadge status="verified" label="Approved Agent" />
        </div>

        <Alert tone="info" title="Compliance Reminder — Subscriber Self-Consent">
          Share your attribution code so orders tie cleanly to your account. Customers must always
          complete Fayda KYC consent personally; agents never impersonate subscribers.
        </Alert>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <SummaryMetricCard
            label="Attributed Orders"
            value={dashboard.agent.totalAttributedOrders}
            hint="Orders carrying your referral code"
            icon={<Users className="h-4 w-4" />}
          />
          <SummaryMetricCard
            label="Earned Commission"
            value={`${dashboard.agent.totalEarnedCommissionEtb.toFixed(2)} ETB`}
            hint="Rate schedule finalized upon onboarding"
            tone="neutral"
          />
          <SummaryMetricCard
            label="Paid Out"
            value={`${dashboard.agent.totalPaidOutEtb.toFixed(2)} ETB`}
            hint={`${dashboard.payouts.length} payout record(s)`}
            tone="orange"
          />
          <SummaryMetricCard
            label="Operator Auth"
            value={
              dashboard.agent.operatorAuthorizationStatus.ethio_telecom === 'authorized' ||
              dashboard.agent.operatorAuthorizationStatus.safaricom_ethiopia === 'authorized'
                ? 'Active'
                : 'Pending'
            }
            hint={`Ethio: ${dashboard.agent.operatorAuthorizationStatus.ethio_telecom} · Safaricom: ${dashboard.agent.operatorAuthorizationStatus.safaricom_ethiopia}`}
          />
        </div>

        <Card variant="highlight" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-[#0A2DB8] dark:text-[#60A5FA]">
              Your Attribution Referral Code
            </p>
            <p className="text-2xl font-bold tabular-nums mt-0.5">{dashboard.agent.referralCode}</p>
            <p className="text-xs text-[#64748B] dark:text-[#CBD5E1] mt-1">
              Customers enter this code in Step 1 of Buy eSIM.
            </p>
          </div>
          <Button
            variant="secondary"
            leftIcon={<Copy className="h-4 w-4" />}
            onClick={() => {
              navigator.clipboard?.writeText(dashboard.agent.referralCode).catch(() => {});
              setCopiedCode(true);
              setTimeout(() => setCopiedCode(false), 1800);
            }}
          >
            {copiedCode ? 'Copied Code' : 'Copy Code'}
          </Button>
        </Card>

        <Card>
          <CardHeader title="Attributed Orders" subtitle="Live customer orders linked to your agent ID" />
          <Table
            rows={dashboard.attributedOrders}
            getRowKey={(r) => r.id}
            emptyMessage="No attributed eSIM orders recorded yet."
            columns={[
              { key: 'num', header: 'Order', render: (r) => <span className="font-medium tabular-nums">{r.orderNumber}</span> },
              { key: 'op', header: 'Operator', render: (r) => r.operatorCode === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia' },
              { key: 'st', header: 'Status', render: (r) => <StatusBadge status={r.status === 'installed' ? 'active' : 'processing'} label={r.status.replace(/_/g, ' ')} /> },
              { key: 'dt', header: 'Date', render: (r) => new Date(r.createdAt).toLocaleDateString() },
            ]}
          />
        </Card>

        <Card>
          <CardHeader title="Payout History" />
          <Table
            rows={dashboard.payouts}
            getRowKey={(r) => r.id}
            emptyMessage="No payouts recorded yet."
            columns={[
              { key: 'ref', header: 'Reference', render: (r) => r.paymentReference },
              { key: 'amt', header: 'Amount', align: 'right', render: (r) => <span className="tabular-nums font-semibold">{r.amountEtb.toFixed(2)} ETB</span> },
              { key: 'st', header: 'Status', render: (r) => <StatusBadge status={r.status === 'paid' ? 'active' : 'pending'} label={r.status} /> },
            ]}
          />
        </Card>
      </div>
    );
  }

  if (application && application.status === 'pending_review') {
    return (
      <Card className="space-y-4">
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8]">
              <Clock className="h-5 w-5" />
            </span>
            <div>
              <h1 className="text-xl font-bold">Agent Application Pending Manual Review</h1>
              <p className="text-xs text-[#64748B]">Reference: {application.id}</p>
            </div>
          </div>
          <StatusBadge status="pending" label="Pending Review" />
        </div>
        <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
          Yene Tele operations staff manually verify all distributor applications before unlocking
          agent attribution codes or dashboards. Customer accounts never auto-approve.
        </p>
        <div className="p-4 rounded-xl bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D] text-xs space-y-1">
          <p><strong>Applicant:</strong> {application.fullName} ({application.applicantType.replace('_', ' ')})</p>
          <p><strong>City:</strong> {application.city}</p>
          <p><strong>Submitted:</strong> {new Date(application.createdAt).toLocaleString()}</p>
        </div>
      </Card>
    );
  }

  return (
    <Card className="space-y-5">
      <CardHeader
        title="Apply to Become an Authorized Yene Tele Agent"
        subtitle="Requires separate staff approval before commercial attribution unlocks"
      />
      {application?.status === 'rejected' && (
        <Alert tone="error" title="Previous Application Not Approved">
          {application.reviewNotes ?? 'Please update your distribution details and reapply.'}
        </Alert>
      )}
      {application?.status === 'suspended' && (
        <Alert tone="error" title="Agent Account Suspended">
          {application.reviewNotes ?? 'Contact Yene Tele operations staff.'}
        </Alert>
      )}
      {errMsg && <Alert tone="error">{errMsg}</Alert>}

      <form onSubmit={handleApply} className="space-y-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Input
            label="Applicant Full Name"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            required
          />
          <Input
            label="Phone Number (+251...)"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            required
          />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <Input
            label="City / Region"
            value={city}
            onChange={(e) => setCity(e.target.value)}
            required
          />
          <Input
            label="Shop / Business Name (Optional)"
            value={businessName}
            onChange={(e) => setBusinessName(e.target.value)}
          />
          <div>
            <label className="block text-sm font-medium mb-1.5">Partner Type</label>
            <select
              value={applicantType}
              onChange={(e) => setApplicantType(e.target.value as typeof applicantType)}
              className="w-full min-h-[44px] px-3 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-sm"
            >
              <option value="individual_agent">Individual Agent</option>
              <option value="retail_shop">Retail Phone Shop</option>
              <option value="corporate_reseller">Corporate Reseller</option>
            </select>
          </div>
        </div>

        <div>
          <label className="block text-sm font-medium mb-1.5">
            Distribution Experience &amp; Expected Monthly Reach
          </label>
          <textarea
            rows={4}
            value={experienceSummary}
            onChange={(e) => setExperienceSummary(e.target.value)}
            placeholder="Describe your mobile retail or digital onboarding background..."
            className="w-full p-3 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-sm"
            required
          />
        </div>

        <div className="p-3 rounded-lg bg-[#EEF3FF]/60 dark:bg-[#13254A] text-xs flex items-start gap-2">
          <ShieldCheck className="h-4 w-4 text-[#0A2DB8] shrink-0 mt-0.5" />
          <span>
            Approval grants attribution codes and order visibility only. Subscriber Fayda KYC consent
            always remains with the end customer.
          </span>
        </div>

        <Button type="submit" loading={busy} leftIcon={<CheckCircle2 className="h-4 w-4" />}>
          Submit Agent Application
        </Button>
      </form>
    </Card>
  );
}
