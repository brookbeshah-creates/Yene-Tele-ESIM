import React, { useEffect, useState } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { apiRequest } from '../../lib/apiClient';
import { useRouter } from '../../router/RouterContext';
import type { SupportTicketRecord } from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { EmptyState, LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { ThemeSwitcher } from '../../components/yegna/ThemeSwitcher';

export function CustomerSupportPage() {
  const { navigate } = useRouter();
  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    apiRequest<{ tickets: SupportTicketRecord[] }>('/api/v1/support/my-tickets')
      .then((res) => setTickets(res.tickets))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <LoadingState message="Loading your support tickets..." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Customer Support Tickets</h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Track installation, Fayda KYC, or order support inquiries.
          </p>
        </div>
        <Button onClick={() => navigate('/help')}>New Support Inquiry</Button>
      </div>

      {tickets.length === 0 ? (
        <EmptyState
          title="No support tickets opened"
          description="Need assistance installing your eSIM? Open an inquiry and our operations team will respond."
          action={<Button onClick={() => navigate('/help')}>Open Support Form</Button>}
        />
      ) : (
        <div className="space-y-3">
          {tickets.map((t) => (
            <Card key={t.id} padding="sm" className="space-y-2">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold">{t.subject}</p>
                  <p className="text-xs text-[#64748B] tabular-nums">
                    {t.id} · {t.category.replace('_', ' ')} ·{' '}
                    {new Date(t.createdAt).toLocaleDateString()}
                  </p>
                </div>
                <StatusBadge
                  status={t.status === 'resolved' ? 'active' : t.status === 'in_review' ? 'processing' : 'pending'}
                  label={t.status.replace('_', ' ')}
                />
              </div>
              <p className="text-xs text-[#64748B] dark:text-[#CBD5E1]">{t.message}</p>
              {t.adminResponse && (
                <div className="p-2.5 rounded-lg bg-[#EEF3FF] dark:bg-[#13254A] text-xs">
                  <strong>Staff Response:</strong> {t.adminResponse}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

export function CustomerSettingsPage() {
  const { profile, refreshProfile } = useAuth();
  const { language, setLanguage } = useLanguage();
  const [displayName, setDisplayName] = useState(profile?.user.displayName ?? '');
  const [phoneNumber, setPhoneNumber] = useState(profile?.user.phoneNumber ?? '');
  const [busy, setBusy] = useState(false);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSavedMsg(null);
    setErrMsg(null);
    try {
      await apiRequest('/api/v1/me', {
        method: 'PATCH',
        body: {
          displayName,
          preferredLanguage: language,
          phoneNumber: phoneNumber.trim() || null,
        },
      });
      await refreshProfile();
      setSavedMsg('Account preferences updated.');
    } catch (err) {
      setErrMsg(err instanceof Error ? err.message : 'Unable to save settings.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-6 max-w-3xl">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Account Settings</h1>
        <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
          Manage your portal display preferences, theme, and language.
        </p>
      </div>

      {savedMsg && <Alert tone="success">{savedMsg}</Alert>}
      {errMsg && <Alert tone="error">{errMsg}</Alert>}

      <Card>
        <CardHeader
          title="Profile & Language"
          action={
            <StatusBadge
              status={profile?.user.emailVerified ? 'verified' : 'pending'}
              label={profile?.user.emailVerified ? 'Email Verified' : 'Email Unverified'}
            />
          }
        />
        <form onSubmit={handleSave} className="space-y-4">
          <Input label="Account Email" value={profile?.user.email ?? ''} disabled />
          <Input
            label="Full Name"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
          />
          <Input
            label="Optional Contact Phone (+251...)"
            placeholder="+251911223344"
            value={phoneNumber}
            onChange={(e) => setPhoneNumber(e.target.value)}
          />

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#E5E7EB] dark:border-[#24344D]">
            <div>
              <p className="text-sm font-medium">Portal Language</p>
              <p className="text-xs text-[#64748B]">Switch between English and አማርኛ</p>
            </div>
            <div className="flex gap-2">
              {(['en', 'am'] as const).map((lang) => (
                <button
                  key={lang}
                  type="button"
                  onClick={() => setLanguage(lang)}
                  className={`px-3 py-1.5 rounded-lg border text-xs font-semibold cursor-pointer ${
                    language === lang
                      ? 'bg-[#0A2DB8] text-white border-[#0A2DB8]'
                      : 'border-[#E5E7EB] dark:border-[#24344D]'
                  }`}
                >
                  {lang === 'en' ? 'English' : 'አማርኛ'}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-4 pt-2 border-t border-[#E5E7EB] dark:border-[#24344D]">
            <div>
              <p className="text-sm font-medium">Appearance Theme</p>
              <p className="text-xs text-[#64748B]">Light, Dark, or follow system preference</p>
            </div>
            <ThemeSwitcher variant="segmented" />
          </div>

          <Button type="submit" loading={busy}>
            Save Preferences
          </Button>
        </form>
      </Card>
    </div>
  );
}
