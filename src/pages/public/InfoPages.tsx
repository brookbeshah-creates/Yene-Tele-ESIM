import React, { useEffect, useState } from 'react';
import {
  CheckCircle2,
  Cpu,
  Fingerprint,
  HelpCircle,
  QrCode,
  ShieldCheck,
  Smartphone,
  Users,
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { apiRequest } from '../../lib/apiClient';
import { useRouter } from '../../router/RouterContext';
import type { OperatorConfigRecord } from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import {
  InfoFeatureCard,
  OperatorCard,
} from '../../components/yegna/DomainCards';
import { PhoneMarketplaceView } from './PhoneMarketplaceView';

export function HowItWorksPage() {
  const { navigate } = useRouter();
  const stepList = [
    {
      num: 'Step 01',
      title: 'Select Operator & eSIM Service',
      body: 'Choose Ethio telecom or Safaricom Ethiopia. Yene Tele transparently shows active fulfillment modes (Pre-allocated Stock, Direct API, or Authorized Manual Partner Processing).',
    },
    {
      num: 'Step 02',
      title: 'Verify Handset Compatibility (*#06#)',
      body: 'Dial *#06# to confirm a 32-digit EID and verify your phone is unlocked.',
    },
    {
      num: 'Step 03',
      title: 'Complete Subscriber Fayda Consent',
      body: 'Account sign-in and telecom KYC are separated. Subscribers submit Fayda identity consent personally.',
    },
    {
      num: 'Step 04',
      title: 'Reserve Your Ethiopian Number',
      body: 'Available numbers lock atomically for 15 minutes during checkout so two customers can never purchase the same line.',
    },
    {
      num: 'Step 05',
      title: 'Settle via Chapa with Server Verification',
      body: 'Yene Tele verifies every payment directly with Chapa server-side APIs and HMAC webhooks before releasing provisioning.',
    },
    {
      num: 'Step 06',
      title: 'Install eSIM via QR Code or Manual SM-DP+',
      body: 'Access your encrypted QR/LPA string and step-by-step iOS/Android installation instructions inside My eSIMs.',
    },
  ];

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-10">
      <div className="max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#0A2DB8] dark:text-[#60A5FA]">
          How Yene Tele Works
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
          Digital eSIM acquisition built for Ethiopian telecom standards.
        </h1>
        <p className="text-base text-[#64748B] dark:text-[#CBD5E1]">
          No paper queues when digital operator channels are active — and full visibility when an
          order routes through Authorized Partner Processing.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {stepList.map((item) => (
          <InfoFeatureCard
            key={item.num}
            eyebrow={item.num}
            title={item.title}
            description={item.body}
            icon={<QrCode className="h-4 w-4" />}
          />
        ))}
      </div>

      <Card variant="highlight" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-[#111827] dark:text-[#F8FAFC]">
            Ready to start your eSIM order?
          </h2>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Start your guided Ethiopian eSIM order and activate directly from your phone.
          </p>
        </div>
        <Button onClick={() => navigate('/buy-esim')}>Start eSIM Order</Button>
      </Card>
    </div>
  );
}

export function OperatorsPage() {
  const { navigate } = useRouter();
  const [operators, setOperators] = useState<OperatorConfigRecord[]>([]);

  useEffect(() => {
    apiRequest<{ operators: OperatorConfigRecord[] }>('/api/v1/operators', { requireAuth: false })
      .then((res) => setOperators(res.operators))
      .catch(() => {});
  }, []);

  return (
    <div className="max-w-6xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      <div className="max-w-3xl space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#0A2DB8] dark:text-[#60A5FA]">
          Operators &amp; Supply Architecture
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
          Ethio telecom and Safaricom Ethiopia partnerships
        </h1>
        <p className="text-base text-[#64748B] dark:text-[#CBD5E1]">
          Yene Tele is a digital reseller and eSIM management platform connecting Ethiopian mobile
          subscribers with authorized operator eSIM lines.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {operators.map((op) => (
          <OperatorCard
            key={op.operatorCode}
            name={op.operatorCode === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia'}
            prefixLabel={op.operatorCode === 'ethio_telecom' ? '+251 9xx numbers' : '+251 7xx numbers'}
            accent={op.operatorCode === 'ethio_telecom' ? 'blue' : 'orange'}
            modeLabel={op.integrationStatus === 'live' ? 'Live Partner' : 'Available'}
            supplyMethodLabel={op.activeSupplyMethod.replace('_', ' ')}
            summary={op.customerVisibleNote}
            onSelect={() => navigate('/buy-esim')}
          />
        ))}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <InfoFeatureCard
          eyebrow="Supply Model A"
          title="Stock-Based eSIM Supply"
          description="Consumes pre-allocated, AES-256-GCM encrypted operator QR/LPA profiles managed cleanly in Yene Tele inventory."
          icon={<Cpu className="h-4 w-4" />}
        />
        <InfoFeatureCard
          eyebrow="Supply Model B"
          title="Direct Operator API"
          description="Connects to official Ethio telecom or Safaricom Ethiopia provisioning endpoints once commercial agreements & credentials are active."
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <InfoFeatureCard
          eyebrow="Supply Model C"
          title="Authorized Manual Processing"
          description="Fallback operational queue ensuring verified paid orders are fulfilled cleanly via authorized partner outlets without inventing fake automation."
          icon={<Fingerprint className="h-4 w-4" />}
        />
      </div>
    </div>
  );
}

export function AgentProgrammePage() {
  const { navigate } = useRouter();
  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      <div className="max-w-3xl space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#0A2DB8] dark:text-[#60A5FA]">
          Authorized Distribution Network
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
          Yene Tele Authorized Agent Programme
        </h1>
        <p className="text-base text-[#64748B] dark:text-[#CBD5E1]">
          Individual sales agents, retail phone shops, and business resellers can apply to distribute
          Yene Tele eSIMs and eSIM-ready handsets with clear attribution and commission tracking.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-5">
        <InfoFeatureCard
          eyebrow="01 · Manual Review"
          title="Separate Approval Gate"
          description="Every agent applicant is reviewed manually by Yene Tele operations staff. Customer accounts are never auto-upgraded to agents."
          icon={<ShieldCheck className="h-4 w-4" />}
        />
        <InfoFeatureCard
          eyebrow="02 · Attribution"
          title="Referral Codes & Order Tracking"
          description="Approved agents receive a unique YT-AG code to attribute customer eSIM orders and secondary phone purchases cleanly."
          icon={<Users className="h-4 w-4" />}
        />
        <InfoFeatureCard
          eyebrow="03 · Compliance Boundary"
          title="No Subscriber Impersonation"
          description="Agents assist customers with onboarding and device checks, while subscribers complete their own Fayda identity consent."
          icon={<CheckCircle2 className="h-4 w-4" />}
        />
      </div>

      <Card variant="highlight" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold">Apply as an Authorized Agent</h2>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Commercial commission schedules are finalized upon partner onboarding.
          </p>
        </div>
        <Button onClick={() => navigate('/agent')}>Open Agent Application</Button>
      </Card>
    </div>
  );
}

export function HelpSupportPage() {
  const { firebaseUser, profile } = useAuth();
  const [email, setEmail] = useState(profile?.user.email ?? '');
  const [subject, setSubject] = useState('');
  const [category, setCategory] = useState<'esim_setup' | 'fayda_kyc' | 'payment' | 'agent_programme' | 'phone_order' | 'general'>('esim_setup');
  const [orderId, setOrderId] = useState('');
  const [message, setMessage] = useState('');
  const [submittedId, setSubmittedId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (profile?.user.email && !email) setEmail(profile.user.email);
  }, [profile, email]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr(null);
    setBusy(true);
    try {
      const res = await apiRequest<{ ticket: { id: string } }>('/api/v1/support/inquiries', {
        method: 'POST',
        requireAuth: Boolean(firebaseUser),
        body: { email, subject, category, orderId: orderId || undefined, message },
      });
      setSubmittedId(res.ticket.id);
      setSubject('');
      setMessage('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Failed to submit inquiry.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      <div className="max-w-2xl space-y-2">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#0A2DB8] dark:text-[#60A5FA]">
          Help &amp; Installation Support
        </p>
        <h1 className="text-3xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
          eSIM setup guides &amp; customer support
        </h1>
        <p className="text-sm sm:text-base text-[#64748B] dark:text-[#CBD5E1]">
          Submit an inquiry directly to Yene Tele operations staff. No unverified phone numbers or
          placeholder office addresses are listed here.
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
        <Card variant="subtle" className="space-y-2">
          <p className="text-sm font-semibold inline-flex items-center gap-2">
            <Smartphone className="h-4 w-4 text-[#0A2DB8] dark:text-[#60A5FA]" />
            Installing on iOS (iPhone XS and newer)
          </p>
          <p className="text-xs text-[#64748B] dark:text-[#CBD5E1] leading-relaxed">
            Settings → Cellular / Mobile Service → Add eSIM → Use QR Code → Enter Details Manually
            (paste SM-DP+ Address and Activation Code from My eSIMs).
          </p>
        </Card>
        <Card variant="subtle" className="space-y-2">
          <p className="text-sm font-semibold inline-flex items-center gap-2">
            <HelpCircle className="h-4 w-4 text-[#0A2DB8] dark:text-[#60A5FA]" />
            Installing on Android (Samsung / Pixel / Global ROM)
          </p>
          <p className="text-xs text-[#64748B] dark:text-[#CBD5E1] leading-relaxed">
            Settings → Connections / Network &amp; Internet → SIM Manager → Add eSIM → Scan QR or
            enter LPA activation string.
          </p>
        </Card>
      </div>

      <Card>
        <CardHeader title="Send a Support Inquiry" subtitle="Tracked in Operations Support Queue" />
        {submittedId && (
          <Alert tone="success" className="mb-4">
            Inquiry logged under ticket reference <strong>{submittedId}</strong>. Staff can review
            and respond from the Admin Support Console.
          </Alert>
        )}
        {err && <Alert tone="error" className="mb-4">{err}</Alert>}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Contact Email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <div>
              <label className="block text-sm font-medium mb-1.5">Category</label>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value as typeof category)}
                className="w-full min-h-[44px] px-3.5 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-sm"
              >
                <option value="esim_setup">eSIM Installation &amp; QR</option>
                <option value="fayda_kyc">Fayda KYC &amp; Consent</option>
                <option value="payment">Chapa Payment Verification</option>
                <option value="agent_programme">Agent Programme</option>
                <option value="phone_order">Phone Marketplace &amp; Klick</option>
                <option value="general">General Inquiry</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <Input
              label="Subject"
              placeholder="Unable to see Add eSIM on device"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              required
            />
            <Input
              label="Optional Order Number"
              placeholder="YN-261123-..."
              value={orderId}
              onChange={(e) => setOrderId(e.target.value)}
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1.5">Message</label>
            <textarea
              rows={4}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Describe your question or handset model..."
              className="w-full p-3 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-sm"
              required
            />
          </div>

          <Button type="submit" loading={busy}>
            Submit Support Inquiry
          </Button>
        </form>
      </Card>
    </div>
  );
}

export function PhonesMarketplacePage() {
  return <PhoneMarketplaceView mode="public" />;
}

