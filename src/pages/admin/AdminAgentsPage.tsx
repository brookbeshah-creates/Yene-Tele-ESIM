import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/apiClient';
import type { AgentApplicationRecord, AgentProfileRecord } from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';
import { LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table } from '../../components/ui/Table';

export function AdminAgentsPage() {
  const [applications, setApplications] = useState<AgentApplicationRecord[]>([]);
  const [agents, setAgents] = useState<AgentProfileRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [payoutAgent, setPayoutAgent] = useState<AgentProfileRecord | null>(null);
  const [payoutAmount, setPayoutAmount] = useState(500);
  const [payoutRef, setPayoutRef] = useState('PAY-SANDBOX-001');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    apiRequest<{ applications: AgentApplicationRecord[]; agents: AgentProfileRecord[] }>(
      '/api/v1/admin/agents',
    )
      .then((res) => {
        setApplications(res.applications);
        setAgents(res.agents);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, []);

  const handleReview = async (
    id: string,
    decision: 'approved' | 'rejected' | 'suspended',
  ) => {
    setErr(null);
    setMsg(null);
    try {
      await apiRequest(`/api/v1/admin/agents/applications/${id}/review`, {
        method: 'POST',
        body: {
          decision,
          reviewNotes: `Reviewed via Yene Tele Operations Console (${decision})`,
          ethioTelecomAuthorized: decision === 'approved',
          safaricomAuthorized: false,
        },
      });
      setMsg(`Application ${id} marked as ${decision}.`);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to review application.');
    }
  };

  const handleRecordPayout = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!payoutAgent) return;
    try {
      await apiRequest(`/api/v1/admin/agents/${payoutAgent.id}/payouts`, {
        method: 'POST',
        body: { amountEtb: payoutAmount, paymentReference: payoutRef, status: 'paid' },
      });
      setMsg(`Payout recorded for ${payoutAgent.fullName}.`);
      setPayoutAgent(null);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Payout failed.');
    }
  };

  if (loading) return <LoadingState message="Loading agent applications and profiles..." />;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Authorized Agent Review &amp; Payouts</h1>
        <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
          Manually review agent applications, enforce operator authorization separation, and log
          commission payouts.
        </p>
      </div>

      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}

      <Card>
        <CardHeader title={`Agent Applications (${applications.length})`} />
        <Table
          rows={applications}
          getRowKey={(a) => a.id}
          emptyMessage="No agent applications submitted yet."
          columns={[
            {
              key: 'app',
              header: 'Applicant',
              render: (a) => (
                <div>
                  <p className="font-semibold">{a.fullName}</p>
                  <p className="text-xs text-[#64748B]">{a.city} · {a.applicantType.replace('_', ' ')}</p>
                </div>
              ),
            },
            {
              key: 'st',
              header: 'Status',
              render: (a) => (
                <StatusBadge
                  status={a.status === 'approved' ? 'verified' : a.status === 'pending_review' ? 'pending' : 'failed'}
                  label={a.status.replace(/_/g, ' ')}
                />
              ),
            },
            {
              key: 'act',
              header: 'Decision',
              render: (a) => (
                <div className="flex flex-wrap gap-1.5">
                  {a.status !== 'approved' && (
                    <Button size="sm" onClick={() => handleReview(a.id, 'approved')}>
                      Approve
                    </Button>
                  )}
                  {a.status === 'pending_review' && (
                    <Button size="sm" variant="destructive" onClick={() => handleReview(a.id, 'rejected')}>
                      Reject
                    </Button>
                  )}
                  {a.status === 'approved' && (
                    <Button size="sm" variant="secondary" onClick={() => handleReview(a.id, 'suspended')}>
                      Suspend
                    </Button>
                  )}
                </div>
              ),
            },
          ]}
        />
      </Card>

      <Card>
        <CardHeader title={`Approved Agents (${agents.length})`} />
        <Table
          rows={agents}
          getRowKey={(a) => a.id}
          emptyMessage="No approved agents yet."
          columns={[
            { key: 'name', header: 'Agent', render: (a) => a.fullName },
            { key: 'code', header: 'Referral Code', render: (a) => <span className="font-semibold tabular-nums">{a.referralCode}</span> },
            { key: 'ord', header: 'Attributed Orders', align: 'right', render: (a) => a.totalAttributedOrders },
            { key: 'paid', header: 'Paid Out', align: 'right', render: (a) => `${a.totalPaidOutEtb.toFixed(2)} ETB` },
            {
              key: 'pay',
              header: 'Payouts',
              render: (a) => (
                <Button size="sm" variant="secondary" onClick={() => setPayoutAgent(a)}>
                  Record Payout
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Dialog
        open={Boolean(payoutAgent)}
        onClose={() => setPayoutAgent(null)}
        title={`Record Agent Payout · ${payoutAgent?.fullName ?? ''}`}
      >
        <form onSubmit={handleRecordPayout} className="space-y-4">
          <Input
            label="Amount (ETB)"
            inputKind="currency"
            value={payoutAmount}
            onChange={(e) => setPayoutAmount(Number(e.target.value) || 0)}
            required
          />
          <Input
            label="Bank / Settlement Reference"
            value={payoutRef}
            onChange={(e) => setPayoutRef(e.target.value)}
            required
          />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setPayoutAgent(null)}>
              Cancel
            </Button>
            <Button type="submit">Save Payout</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
