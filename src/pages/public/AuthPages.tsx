import React, { useState } from 'react';
import { KeyRound, Mail, ShieldCheck } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useRouter } from '../../router/RouterContext';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';

export function AuthPages({ mode }: { mode: 'login' | 'register' | 'forgot' }) {
  const {
    signInWithGoogle,
    signInWithEmail,
    registerWithEmail,
    requestPasswordReset,
    authError,
    clearAuthError,
  } = useAuth();
  const { navigate, search } = useRouter();

  const redirectTarget = React.useMemo(() => {
    const raw = new URLSearchParams(search).get('redirect');
    if (raw && raw.startsWith('/') && !raw.startsWith('//')) {
      return raw.startsWith('/phones') ? `/app${raw}` : raw;
    }
    return '/app';
  }, [search]);

  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [localMsg, setLocalMsg] = useState<string | null>(null);

  const handleGoogle = async () => {
    clearAuthError();
    setLocalMsg(null);
    setBusy(true);
    try {
      await signInWithGoogle();
      navigate(redirectTarget);
    } catch {
      // handled in AuthContext
    } finally {
      setBusy(false);
    }
  };

  const handleEmailSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    clearAuthError();
    setLocalMsg(null);
    setBusy(true);
    try {
      if (mode === 'login') {
        await signInWithEmail(email, password);
        navigate(redirectTarget);
      } else if (mode === 'register') {
        await registerWithEmail(name, email, password);
        navigate(redirectTarget);
      } else {
        await requestPasswordReset(email);
        setLocalMsg('Password reset instructions sent if this email is registered in Firebase Auth.');
      }
    } catch {
      // handled in AuthContext
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-lg mx-auto px-4 py-12 sm:py-16">
      <Card>
        <div className="space-y-1.5 mb-5">
          <h1 className="text-2xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
            {mode === 'login'
              ? 'Sign in to Yene Tele'
              : mode === 'register'
                ? 'Create your Yene Tele account'
                : 'Reset your password'}
          </h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            {mode === 'forgot'
              ? 'Enter your email address to receive password recovery instructions.'
              : 'Manage your Ethiopian eSIM purchases, QR credentials, and orders.'}
          </p>
        </div>

        <Alert tone="info" className="mb-4">
          <span className="inline-flex items-center gap-1.5 text-xs">
            <ShieldCheck className="h-3.5 w-3.5 shrink-0" />
            Portal sign-in uses Firebase Auth and stays strictly separate from subscriber Fayda
            telecom KYC verification during eSIM checkout.
          </span>
        </Alert>

        {authError && (
          <Alert tone="error" className="mb-4">
            {authError}
          </Alert>
        )}

        {localMsg && (
          <Alert tone="info" className="mb-4">
            {localMsg}
          </Alert>
        )}

        {mode !== 'forgot' && (
          <>
            <Button
              variant="secondary"
              className="w-full"
              loading={busy}
              onClick={handleGoogle}
            >
              Continue with Google
            </Button>

            <div className="my-5 flex items-center gap-3">
              <div className="flex-1 h-px bg-[#E5E7EB] dark:bg-[#24344D]" />
              <span className="text-xs font-medium text-[#64748B] dark:text-[#94A3B8]">OR EMAIL</span>
              <div className="flex-1 h-px bg-[#E5E7EB] dark:bg-[#24344D]" />
            </div>
          </>
        )}

        <form onSubmit={handleEmailSubmit} className="space-y-4">
          {mode === 'register' && (
            <Input
              label="Full Name"
              placeholder="Abebe Bikila"
              value={name}
              onChange={(e) => setName(e.target.value)}
              required
            />
          )}
          <Input
            label="Email Address"
            type="email"
            placeholder="you@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
          {mode !== 'forgot' && (
            <Input
              label="Password"
              inputKind="password"
              placeholder="At least 6 characters"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
          )}

          <Button
            type="submit"
            className="w-full"
            loading={busy}
            leftIcon={mode === 'forgot' ? <KeyRound className="h-4 w-4" /> : <Mail className="h-4 w-4" />}
          >
            {mode === 'login'
              ? 'Sign In with Email'
              : mode === 'register'
                ? 'Create Account'
                : 'Send Reset Email'}
          </Button>
        </form>

        <div className="mt-6 pt-4 border-t border-[#E5E7EB] dark:border-[#24344D] flex flex-wrap items-center justify-between gap-2 text-xs text-[#64748B] dark:text-[#CBD5E1]">
          {mode === 'login' ? (
            <>
              <button
                type="button"
                onClick={() => navigate('/forgot-password')}
                className="text-[#0A2DB8] dark:text-[#60A5FA] hover:underline cursor-pointer"
              >
                Forgot password?
              </button>
              <button
                type="button"
                onClick={() => navigate('/register')}
                className="font-semibold text-[#0A2DB8] dark:text-[#60A5FA] hover:underline cursor-pointer"
              >
                Create an account →
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => navigate('/login')}
              className="font-semibold text-[#0A2DB8] dark:text-[#60A5FA] hover:underline cursor-pointer"
            >
              ← Already have an account? Sign in
            </button>
          )}
        </div>
      </Card>
    </div>
  );
}
