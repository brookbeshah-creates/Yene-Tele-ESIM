import React from 'react';
import {
  Activity,
  Boxes,
  ClipboardList,
  CreditCard,
  HelpCircle,
  LogOut,
  Radio,
  Settings,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  UserCheck,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useRouter } from '../router/RouterContext';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/States';
import { BrandWordmark } from '../components/yegna/BrandWordmark';
import { SandboxModeBanner } from '../components/yegna/SandboxModeBanner';
import { ThemeSwitcher } from '../components/yegna/ThemeSwitcher';

export function AdminLayout({ children }: { children: React.ReactNode }) {
  const { firebaseUser, profile, loading, isStaffAdmin, adminRole, logout } = useAuth();
  const { pathname, navigate } = useRouter();

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <LoadingState message="Verifying staff administrator session..." />
        </div>
      </div>
    );
  }

  if (!firebaseUser) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] flex items-center justify-center p-6">
        <div className="bg-white dark:bg-[#162338] border border-[#E5E7EB] dark:border-[#24344D] rounded-2xl p-8 max-w-md w-full text-center space-y-4">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-md bg-[#081A5C] dark:bg-[#13254A] text-white text-xs font-semibold">
            <ShieldCheck className="h-3.5 w-3.5 text-[#DCE7FF]" />
            Yene Tele Staff Portal
          </div>
          <h1 className="text-lg font-semibold text-[#111827] dark:text-[#F8FAFC]">
            Staff authentication required
          </h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            This internal administration portal is separated from customer and agent accounts and
            protected by server-side RBAC authorization.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-2">
            <Button onClick={() => navigate('/admin/login')}>Staff Sign In</Button>
            <Button variant="secondary" onClick={() => navigate('/')}>
              Public Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!isStaffAdmin) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] flex items-center justify-center p-6">
        <div className="bg-white dark:bg-[#162338] border border-[#FECACA] dark:border-[#991B1B]/60 rounded-2xl p-8 max-w-lg w-full text-center space-y-4">
          <div className="mx-auto h-11 w-11 rounded-xl bg-[#FEF2F2] dark:bg-[#7F1D1D]/45 text-[#DC2626] dark:text-[#FCA5A5] flex items-center justify-center">
            <ShieldAlert className="h-6 w-6" />
          </div>
          <h1 className="text-lg font-semibold text-[#111827] dark:text-[#F8FAFC]">
            Access Restricted — 403 Forbidden
          </h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Signed-in account{' '}
            <strong className="text-[#111827] dark:text-[#F8FAFC]">{profile?.user.email}</strong>{' '}
            does not hold Staff Admin authorization on the server.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Button onClick={() => navigate('/app')}>Return to Customer Portal</Button>
            <Button variant="secondary" onClick={() => navigate('/admin/login')}>
              Admin Login / Setup
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const adminNav = [
    { to: '/admin', label: 'Overview', icon: Activity },
    { to: '/admin/orders', label: 'eSIM Orders', icon: ClipboardList },
    { to: '/admin/operators', label: 'Operators & Modes', icon: Radio },
    { to: '/admin/inventory', label: 'Stock Inventory', icon: Boxes },
    { to: '/admin/agents', label: 'Agents & Payouts', icon: UserCheck },
    { to: '/admin/payments', label: 'Chapa Payments', icon: CreditCard },
    { to: '/admin/customers', label: 'Customers', icon: Users },
    { to: '/admin/phones', label: 'Phones & Klick', icon: Smartphone },
    { to: '/admin/support', label: 'Support Tickets', icon: HelpCircle },
    { to: '/admin/audit-logs', label: 'Audit Logs', icon: ShieldCheck },
    { to: '/admin/settings', label: 'Environment & Rules', icon: Settings },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/admin/login');
  };

  return (
    <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] text-[#111827] dark:text-[#F8FAFC] flex flex-col transition-colors duration-150">
      <header className="sticky top-0 z-30 h-16 bg-[#081A5C] dark:bg-[#070E24] text-white px-4 sm:px-6 flex items-center justify-between gap-4 border-b border-white/10">
        <div className="flex items-center gap-3 min-w-0">
          <a
            href="/admin"
            onClick={(e) => {
              e.preventDefault();
              navigate('/admin');
            }}
            className="focus:outline-none"
          >
            <BrandWordmark inverted compact />
          </a>
          <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md bg-white/10 border border-white/20 text-xs font-medium text-[#DCE7FF] whitespace-nowrap">
            <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
            Operations Admin
          </span>
        </div>

        <div className="flex items-center gap-2.5 shrink-0">
          <ThemeSwitcher variant="dropdown" invertedHeader />

          <div className="hidden sm:block text-right">
            <p className="text-xs font-medium text-white">{profile?.user.email}</p>
            <p className="text-[11px] text-[#DCE7FF]/80 uppercase">{adminRole ?? 'staff'}</p>
          </div>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => navigate('/app')}
            className="!bg-white/10 !text-white !border-white/25 hover:!bg-white/20"
          >
            Customer App
          </Button>
          <button
            type="button"
            onClick={handleLogout}
            aria-label="Sign out"
            className="p-2 rounded-lg text-white/80 hover:text-white hover:bg-white/15 cursor-pointer"
          >
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      </header>

      <div className="flex-1 flex flex-col md:flex-row">
        <aside className="w-full md:w-64 bg-white dark:bg-[#111C2E] border-b md:border-b-0 md:border-r border-[#E5E7EB] dark:border-[#24344D] p-3 flex md:flex-col gap-1 overflow-x-auto shrink-0">
          {adminNav.map((item) => {
            const Icon = item.icon;
            const active = pathname === item.to;
            return (
              <button
                key={item.to}
                type="button"
                onClick={() => navigate(item.to)}
                className={`flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium whitespace-nowrap shrink-0 cursor-pointer transition-colors ${
                  active
                    ? 'bg-[#0A2DB8] dark:bg-[#13254A] text-white dark:text-[#60A5FA]'
                    : 'text-[#64748B] dark:text-[#CBD5E1] hover:bg-[#F8FAFC] dark:hover:bg-[#1C2D45] hover:text-[#111827] dark:hover:text-[#F8FAFC]'
                }`}
              >
                <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                <span>{item.label}</span>
              </button>
            );
          })}
        </aside>

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8">
          <div className="max-w-6xl mx-auto space-y-5">
            <SandboxModeBanner compact />
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
