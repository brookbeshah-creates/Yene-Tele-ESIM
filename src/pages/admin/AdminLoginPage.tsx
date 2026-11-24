import React, { useState } from 'react';
import { ArrowLeft, KeyRound, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from '../../router/RouterContext';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { BrandWordmark } from '../../components/yegna/BrandWordmark';
import { ThemeSwitcher } from '../../components/yegna/ThemeSwitcher';

export function AdminLoginPage() {
  const {
    firebaseUser,
    profile,
    isStaffAdmin,
    signInWithGoogle,
    signInWithEmail,
    refreshProfile,
    authError,
    clearAuthError,
  } = useAuth();
  const { navigate } = useRouter();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);

  const handleGoogle = async () => {
    clearAuthError();
    setBusy(true);
    try {
      await signInWithGoogle();
      const updated = await refreshProfile();
      if (updated?.isStaffAdmin) {
        navigate('/admin');
      }
    } catch {
      // handled in AuthContext
    } finally {
      setBusy(false);
    }
  };

  const handleEmailLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();
    setBusy(true);
    try {
      await signInWithEmail(email, password);
      const updated = await refreshProfile();
      if (updated?.isStaffAdmin) {
        navigate('/admin');
      }
    } catch {
      // handled in AuthContext
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] flex flex-col transition-colors">
      <header className="h-16 bg-[#081A5C] dark:bg-[#070E24] text-white px-4 sm:px-6 flex items-center justify-between border-b border-white/10">
        <div className="flex items-center gap-3">
          <BrandWordmark inverted compact />
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 border border-white/20 text-xs font-medium text-[#DCE7FF]">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden sm:inline">Yene Tele Staff Operations</span>
            <span className="sm:hidden">Admin</span>
          </span>
        </div>
        <div className="flex items-center gap-2">
          <ThemeSwitcher variant="dropdown" invertedHeader />
          <Button
            variant="secondary"
            size="sm"
            leftIcon={<ArrowLeft className="h-4 w-4" />}
            onClick={() => navigate('/')}
            className="!bg-white/10 !text-white !border-white/25 hover:!bg-white/20"
          >
            Public Site
          </Button>
        </div>
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <Card className="max-w-md w-full space-y-5">
          <div>
            <h1 className="text-xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
              Internal Staff Sign In
            </h1>
            <p className="text-sm text-[#64748B] dark:text-[#CBD5E1] mt-1">
              Staff access is enforced strictly server-side via the server administrator allowlist
              and staff RBAC authorization. Customer and agent accounts receive 403 Forbidden.
            </p>
          </div>

          {authError && <Alert tone="error">{authError}</Alert>}

          {firebaseUser && isStaffAdmin && (
            <Alert
              tone="success"
              title="Staff Admin Session Verified"
              action={
                <Button size="sm" onClick={() => navigate('/admin')}>
                  Enter Admin Portal
                </Button>
              }
            >
              Signed in as {profile?.user.email}.
            </Alert>
          )}

          {firebaseUser && !isStaffAdmin && (
            <Alert tone="warning" title="Signed-in account is not authorized for Staff Admin">
              Account <strong>{profile?.user.email}</strong> does not hold Staff Admin authorization
              on the server. Ask a Super Admin to authorize your email on the server allowlist.
            </Alert>
          )}

          {!firebaseUser && (
            <>
              <Button variant="secondary" className="w-full" loading={busy} onClick={handleGoogle}>
                Sign in with Staff Google Account
              </Button>

              <div className="flex items-center gap-3">
                <div className="flex-1 h-px bg-[#E5E7EB] dark:bg-[#24344D]" />
                <span className="text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">OR</span>
                <div className="flex-1 h-px bg-[#E5E7EB] dark:bg-[#24344D]" />
              </div>

              <form onSubmit={handleEmailLogin} className="space-y-4">
                <Input
                  label="Staff Email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                />
                <Input
                  label="Password"
                  inputKind="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  required
                />
                <Button
                  type="submit"
                  className="w-full"
                  loading={busy}
                  leftIcon={<KeyRound className="h-4 w-4" />}
                >
                  Verify Staff Credentials
                </Button>
              </form>
            </>
          )}
        </Card>
      </div>
    </div>
  );
}
