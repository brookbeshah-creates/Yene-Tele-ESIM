import React from 'react';
import { ArrowLeft, LogOut, ShieldCheck, Users } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from '../router/RouterContext';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/States';
import { BrandWordmark } from '../components/yegna/BrandWordmark';
import { ThemeSwitcher } from '../components/yegna/ThemeSwitcher';

export function AgentLayout({ children }: { children: React.ReactNode }) {
  const { firebaseUser, profile, loading, agentStatus, logout } = useAuth();
  const { navigate } = useRouter();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <LoadingState message="Verifying agent session..." />
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] flex items-center justify-center p-6">
        <div className="bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          <BrandWordmark />
          <h1 className="text-lg font-semibold text-[#111827] dark:text-[#F8FAFC]">
            Sign in to access Agent Programme
          </h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Authorized Yene Tele agent distribution requires a verified account and separate manual
            staff approval before commercial attribution or dashboards unlock.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-2">
            <Button onClick={() => navigate('/login')}>Sign In</Button>
            <Button variant="secondary" onClick={() => navigate('/agent-programme')}>
              Programme Overview
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] text-[#111827] dark:text-[#F8FAFC] flex flex-col">
      <header className="sticky top-0 z-30 h-16 bg-white dark:bg-[#111C2E] border-t-2 border-t-[#0A2DB8] dark:border-t-[#3B82F6] border-b border-b-[#E5E7EB] dark:border-b-[#24344D] px-4 sm:px-6 flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              navigate('/');
            }}
          >
            <BrandWordmark compact />
          </a>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-[#EEF3FF] dark:bg-[#13254A] text-xs font-semibold text-[#0A2DB8] dark:text-[#93C5FD]">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Authorized Agent Portal
          </span>
        </div>

        <div className="flex items-center gap-2.5">
          <ThemeSwitcher variant="dropdown" />
          <span className="hidden sm:inline-flex items-center gap-1 px-2.5 py-1 rounded-md bg-[#F8FAFC] dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] text-xs font-medium capitalize">
            <ShieldCheck className="h-3.5 w-3.5 text-[#0A2DB8] dark:text-[#60A5FA]" />
            Status: {agentStatus.replace(/_/g, ' ')}
          </span>
          <Button
            size="sm"
            variant="secondary"
            leftIcon={<ArrowLeft className="h-3.5 w-3.5" />}
            onClick={() => navigate('/app')}
          >
            Customer Portal
          </Button>
          <button
            type="button"
            onClick={async () => {
              await logout();
              navigate('/');
            }}
            aria-label="Sign out"
            className="p-2 rounded-lg text-[#64748B] hover:text-[#DC2626] hover:bg-[#FEF2F2] dark:hover:bg-[#7F1D1D]/30 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <main className="flex-1 p-4 sm:p-6 lg:p-8">
        <div className="max-w-5xl mx-auto space-y-5">
          <div className="text-xs text-[#64748B] dark:text-[#94A3B8]">
            Signed in as <strong className="text-[#111827] dark:text-[#F8FAFC]">{profile?.user.email}</strong>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
