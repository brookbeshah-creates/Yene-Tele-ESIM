import React, { useEffect, useState } from 'react';
import { CheckCircle2, Copy, HelpCircle, Radio, Smartphone } from 'lucide-react';
import { apiRequest } from '../../lib/apiClient';
import { useRouter } from '../../router/RouterContext';
import type { CustomerEsimRecord, EsimActivationSecretView } from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { EmptyState, LoadingState } from '../../components/ui/States';
import { EsimProfileCard } from '../../components/yegna/DomainCards';
import { QrCodeDisplay } from '../../components/yegna/QrCodeDisplay';

export function MyEsimsPage() {
  const { navigate } = useRouter();
  const [esims, setEsims] = useState<CustomerEsimRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [selectedEsim, setSelectedEsim] = useState<CustomerEsimRecord | null>(null);
  const [activation, setActivation] = useState<EsimActivationSecretView | null>(null);
  const [installOsTab, setInstallOsTab] = useState<'ios' | 'android'>('ios');
  const [secretBusy, setSecretBusy] = useState(false);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [copied, setCopied] = useState<string | null>(null);

  const loadEsims = () => {
    setLoading(true);
    apiRequest<{ esims: CustomerEsimRecord[] }>('/api/v1/esims')
      .then((res) => setEsims(res.esims))
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    loadEsims();
  }, []);

  const handleOpenInstall = async (esim: CustomerEsimRecord) => {
    setSelectedEsim(esim);
    setActivation(null);
    setErrMsg(null);
    setSecretBusy(true);
    try {
      const res = await apiRequest<{ activation: EsimActivationSecretView }>(
        `/api/v1/esims/${esim.id}/activation`,
      );
      setActivation(res.activation);
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to decrypt activation credentials.');
    } finally {
      setSecretBusy(false);
    }
  };

  const handleMarkInstalled = async () => {
    if (!selectedEsim) return;
    setSecretBusy(true);
    try {
      const res = await apiRequest<{ esim: CustomerEsimRecord }>(
        `/api/v1/esims/${selectedEsim.id}/mark-installed`,
        { method: 'POST' },
      );
      setSelectedEsim(res.esim);
      loadEsims();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to update installation state.');
    } finally {
      setSecretBusy(false);
    }
  };

  const handleMarkActivated = async () => {
    if (!selectedEsim) return;
    setSecretBusy(true);
    try {
      await apiRequest(`/api/v1/esims/${selectedEsim.id}/mark-activated`, { method: 'POST' });
      setSelectedEsim(null);
      loadEsims();
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to update activation state.');
    } finally {
      setSecretBusy(false);
    }
  };

  const copyField = (label: string, val: string) => {
    navigator.clipboard?.writeText(val).catch(() => {});
    setCopied(label);
    setTimeout(() => setCopied(null), 1500);
  };

  if (loading) {
    return <LoadingState message="Loading your encrypted eSIM profiles..." />;
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">My eSIMs</h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Access your encrypted QR profile, SM-DP+ credentials, and iOS/Android installation
            steps.
          </p>
        </div>
        <Button onClick={() => navigate('/buy-esim')}>Buy New eSIM</Button>
      </div>

      {esims.length === 0 ? (
        <EmptyState
          title="No eSIM profiles ready yet"
          description="Complete an eSIM order or wait for partner fulfillment to unlock installation credentials."
          action={<Button onClick={() => navigate('/buy-esim')}>Start eSIM Order</Button>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {esims.map((esim) => (
            <EsimProfileCard key={esim.id} esim={esim} onOpenInstall={handleOpenInstall} />
          ))}
        </div>
      )}

      <Dialog
        open={Boolean(selectedEsim)}
        onClose={() => setSelectedEsim(null)}
        title="eSIM Installation Credentials"
        description={
          selectedEsim
            ? `${selectedEsim.operatorCode === 'ethio_telecom' ? 'Ethio telecom' : 'Safaricom Ethiopia'} · ${selectedEsim.assignedMsisdn ?? ''}`
            : undefined
        }
      >
        {errMsg && <Alert tone="error" className="mb-4">{errMsg}</Alert>}
        {secretBusy && !activation && <LoadingState message="Decrypting vault credentials..." />}
        {activation && (
          <div className="space-y-4">
            {activation.isSandboxSimulation && (
              <Alert tone="warning" title="Sandbox Evaluation Credentials">
                These credentials are sandbox test strings generated for workflow verification — not
                a live commercial operator carrier profile.
              </Alert>
            )}

            <div className="p-4 rounded-xl bg-[#EEF3FF] dark:bg-[#13254A] border border-[#C7D6FE] dark:border-[#2B4C8C] flex justify-center">
              <QrCodeDisplay
                payload={activation.qrPayload}
                isSandboxSimulation={activation.isSandboxSimulation}
                size={140}
              />
            </div>

            <div className="space-y-2">
              {[
                { label: 'SM-DP+ Address', value: activation.smdpAddress },
                { label: 'Activation Code', value: activation.activationCode },
                { label: 'LPA String', value: activation.lpaUri },
              ].map((row) => (
                <div
                  key={row.label}
                  className="p-3 rounded-lg border border-[#E5E7EB] dark:border-[#24344D] bg-[#F8FAFC] dark:bg-[#111C2E] flex items-center justify-between gap-2"
                >
                  <div className="min-w-0">
                    <p className="text-[11px] font-medium text-[#64748B]">{row.label}</p>
                    <p className="text-xs font-semibold break-all tabular-nums">{row.value}</p>
                  </div>
                  <button
                    type="button"
                    onClick={() => copyField(row.label, row.value)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded-md border border-[#E5E7EB] dark:border-[#24344D] bg-white dark:bg-[#162338] text-xs font-medium cursor-pointer shrink-0"
                  >
                    <Copy className="h-3.5 w-3.5" />
                    <span>{copied === row.label ? 'Copied' : 'Copy'}</span>
                  </button>
                </div>
              ))}
            </div>

            <Card padding="sm" variant="subtle" className="text-xs space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold inline-flex items-center gap-1.5">
                  <Smartphone className="h-3.5 w-3.5 text-[#0A2DB8]" />
                  Installation Guide
                </p>
                <div className="flex gap-1">
                  {(['ios', 'android'] as const).map((os) => (
                    <button
                      key={os}
                      type="button"
                      onClick={() => setInstallOsTab(os)}
                      className={`px-2 py-1 rounded text-[11px] font-semibold uppercase cursor-pointer ${
                        installOsTab === os
                          ? 'bg-[#0A2DB8] text-white'
                          : 'bg-white dark:bg-[#162338] text-[#64748B]'
                      }`}
                    >
                      {os}
                    </button>
                  ))}
                </div>
              </div>
              {installOsTab === 'ios' ? (
                <ol className="list-decimal list-inside space-y-1 text-[#64748B] dark:text-[#CBD5E1]">
                  <li>Connect to stable Wi-Fi and open Settings → Cellular (or Mobile Service).</li>
                  <li>Tap Add eSIM → Use QR Code (or Enter Details Manually).</li>
                  <li>Scan the QR above or paste SM-DP+ Address &amp; Activation Code.</li>
                  <li>Label your line (e.g. Yene Tele) and wait for activation signal bars.</li>
                </ol>
              ) : (
                <ol className="list-decimal list-inside space-y-1 text-[#64748B] dark:text-[#CBD5E1]">
                  <li>Connect to Wi-Fi and open Settings → Connections / Network → SIM Manager.</li>
                  <li>Tap Add eSIM → Scan QR code or Enter activation code manually.</li>
                  <li>Paste the LPA string or SM-DP+ credentials above and confirm download.</li>
                  <li>Enable the eSIM toggle once downloaded.</li>
                </ol>
              )}
            </Card>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <Button
                variant="tertiary"
                size="sm"
                leftIcon={<HelpCircle className="h-4 w-4" />}
                onClick={() => {
                  setSelectedEsim(null);
                  navigate('/app/support');
                }}
              >
                Need Setup Help?
              </Button>
              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" onClick={() => setSelectedEsim(null)}>
                  Close
                </Button>
                {selectedEsim?.status === 'ready_for_installation' && (
                  <Button
                    leftIcon={<CheckCircle2 className="h-4 w-4" />}
                    loading={secretBusy}
                    onClick={handleMarkInstalled}
                  >
                    Mark Installed
                  </Button>
                )}
                {selectedEsim?.status === 'installed' && (
                  <Button
                    leftIcon={<Radio className="h-4 w-4" />}
                    loading={secretBusy}
                    onClick={handleMarkActivated}
                  >
                    Confirm Activated
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}
      </Dialog>
    </div>
  );
}
