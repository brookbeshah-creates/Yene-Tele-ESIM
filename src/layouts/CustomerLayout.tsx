import React, { useState } from 'react';
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Cpu,
  Globe,
  HelpCircle,
  History,
  LayoutDashboard,
  LogOut,
  MoreHorizontal,
  QrCode,
  Settings,
  ShieldCheck,
  Smartphone,
  Users,
  X,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useRouter } from '../router/RouterContext';
import { Button } from '../components/ui/Button';
import { LoadingState } from '../components/ui/States';
import { BrandWordmark } from '../components/yegna/BrandWordmark';
import { ThemeSwitcher } from '../components/yegna/ThemeSwitcher';

export function CustomerLayout({ children }: { children: React.ReactNode }) {
  const { firebaseUser, profile, loading, isStaffAdmin, agentStatus, logout } = useAuth();
  const { language, toggleLanguage, t } = useLanguage();
  const { pathname, navigate } = useRouter();

  const [collapsed, setCollapsed] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  if (loading) {
    return (
      <div className="min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <LoadingState message={t.common.loading} />
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
            Sign in required
          </h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Authenticate with your Yene Tele account to view your purchased eSIM profiles, orders,
            and installation credentials.
          </p>
          <div className="flex flex-col sm:flex-row gap-2.5 justify-center pt-2">
            <Button onClick={() => navigate('/login')}>{t.nav.signIn}</Button>
            <Button variant="secondary" onClick={() => navigate('/')}>
              Back to Home
            </Button>
          </div>
        </div>
      </div>
    );
  }

  const navItems = [
    { to: '/app', label: t.nav.overview, icon: LayoutDashboard },
    { to: '/app/esims', label: t.nav.myEsims, icon: QrCode },
    { to: '/buy-esim', label: t.nav.buyEsim, icon: Cpu },
    { to: '/app/orders', label: t.nav.orders, icon: History },
    { to: '/app/business', label: 'Business eSIM', icon: Building2 },
    { to: '/app/phones', label: t.nav.phones, icon: Smartphone },
    { to: '/app/support', label: t.nav.support, icon: HelpCircle },
    { to: '/app/settings', label: t.nav.settings, icon: Settings },
  ];

  const mobileTabs = [
    { to: '/app', label: 'Home', icon: LayoutDashboard },
    { to: '/app/esims', label: 'My eSIMs', icon: QrCode },
    { to: '/buy-esim', label: 'Buy eSIM', icon: Cpu },
    { to: '/app/phones', label: 'Store', icon: Smartphone },
  ];

  const handleLogout = async () => {
    await logout();
    navigate('/');
  };

  const inMobileStore = pathname === '/app/phones' || pathname === '/phones';

  return (
    <div className="main-app-container min-h-screen bg-[#F8FAFC] dark:bg-[#0B1220] text-[#111827] dark:text-[#F8FAFC] flex flex-col transition-colors duration-150">
      <header className="sticky top-0 z-30 h-14 md:h-16 bg-white dark:bg-[#111C2E] border-t-2 border-t-[#0A2DB8] dark:border-t-[#3B82F6] border-b border-b-[#E5E7EB] dark:border-b-[#24344D] px-3 sm:px-5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2.5 min-w-0">
          <a
            href="/app"
            onClick={(e) => {
              e.preventDefault();
              navigate('/app');
            }}
            className="inline-flex items-center focus:outline-none shrink-0"
          >
            <img
              src="/assets/aistudio/image_28c3daa0.png"
              alt="Yene Tele (የእኔ ቴሌኮም)"
              className="h-8 w-auto object-contain rounded-md bg-white px-1.5 py-0.5"
            />
          </a>

          {/* Focused back-and-forth switcher between eSIMs and minimal Mobile Store */}
          <div className="inline-flex items-center rounded-lg border border-[#E5E7EB] dark:border-[#24344D] bg-[#F8FAFC] dark:bg-[#0B1220] p-0.5 text-xs font-semibold">
            <button
              type="button"
              onClick={() => navigate('/app')}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                !inMobileStore
                  ? 'bg-[#0A2DB8] text-white'
                  : 'text-[#64748B] dark:text-[#CBD5E1] hover:text-[#111827]'
              }`}
            >
              eSIM
            </button>
            <button
              type="button"
              onClick={() => navigate('/app/phones')}
              className={`px-2.5 py-1 rounded-md transition-colors cursor-pointer ${
                inMobileStore
                  ? 'bg-[#0A2DB8] text-white'
                  : 'text-[#64748B] dark:text-[#CBD5E1] hover:text-[#111827]'
              }`}
            >
              Store
            </button>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <ThemeSwitcher variant="dropdown" />

          <button
            type="button"
            onClick={toggleLanguage}
            className="inline-flex items-center gap-1 min-h-[36px] px-2.5 rounded-lg border border-[#E5E7EB] dark:border-[#24344D] bg-white dark:bg-[#162338] hover:bg-[#EEF3FF]/60 dark:hover:bg-[#1C2D45] text-xs font-semibold text-[#111827] dark:text-[#F8FAFC] cursor-pointer"
            aria-label="Toggle language"
          >
            <Globe className="h-3.5 w-3.5 text-[#0A2DB8] dark:text-[#60A5FA]" aria-hidden="true" />
            <span>{language === 'en' ? 'አማ' : 'EN'}</span>
          </button>

          {isStaffAdmin && (
            <button
              type="button"
              onClick={() => navigate('/admin')}
              className="hidden sm:inline-flex items-center gap-1.5 min-h-[36px] px-2.5 rounded-lg bg-[#081A5C] dark:bg-[#1C2D45] text-white text-xs font-medium hover:bg-[#0A2DB8] dark:hover:bg-[#2B4C8C] border border-transparent dark:border-[#334866] cursor-pointer"
            >
              <ShieldCheck className="h-3.5 w-3.5 text-[#DCE7FF]" aria-hidden="true" />
              <span>Admin</span>
            </button>
          )}

          <div className="hidden md:flex items-center gap-2 pl-2 border-l border-[#E5E7EB] dark:border-[#24344D]">
            <div className="text-right max-w-[150px]">
              <p className="text-xs font-medium text-[#111827] dark:text-[#F8FAFC] truncate">
                {profile?.user.displayName ?? profile?.user.email ?? 'Customer'}
              </p>
              <p className="text-[11px] text-[#64748B] dark:text-[#94A3B8] truncate">
                {profile?.user.email ?? ''}
              </p>
            </div>
            <button
              type="button"
              onClick={handleLogout}
              title={t.nav.logout}
              aria-label={t.nav.logout}
              className="p-2 rounded-lg text-[#64748B] dark:text-[#CBD5E1] hover:text-[#DC2626] dark:hover:text-[#FCA5A5] hover:bg-[#FEF2F2] dark:hover:bg-[#7F1D1D]/30 cursor-pointer"
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <div className="flex-1 flex">
        <aside
          className={`hidden md:flex flex-col bg-white dark:bg-[#111C2E] border-r border-[#E5E7EB] dark:border-[#24344D] transition-all shrink-0 ${
            collapsed ? 'w-[72px]' : 'w-[240px]'
          }`}
        >
          <div className="flex-1 p-3 space-y-1">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isOverview =
                item.to === '/app' && (pathname === '/app' || pathname === '/app/overview');
              const isActive = isOverview || pathname === item.to;
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => navigate(item.to)}
                  title={collapsed ? item.label : undefined}
                  className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-[#EEF3FF] dark:bg-[#13254A] text-[#0A2DB8] dark:text-[#60A5FA] font-semibold'
                      : 'text-[#64748B] dark:text-[#CBD5E1] hover:bg-[#F8FAFC] dark:hover:bg-[#1C2D45] hover:text-[#111827] dark:hover:text-[#F8FAFC]'
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0" aria-hidden="true" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </button>
              );
            })}
          </div>

          <div className="p-3 border-t border-[#E5E7EB] dark:border-[#24344D]">
            <button
              type="button"
              onClick={() => setCollapsed((prev) => !prev)}
              className="w-full flex items-center justify-center gap-2 py-2 rounded-lg text-xs font-medium text-[#64748B] dark:text-[#CBD5E1] hover:bg-[#F8FAFC] dark:hover:bg-[#1C2D45] cursor-pointer"
            >
              {collapsed ? (
                <ChevronRight className="h-4 w-4" />
              ) : (
                <>
                  <ChevronLeft className="h-4 w-4" />
                  <span>Collapse sidebar</span>
                </>
              )}
            </button>
          </div>
        </aside>

        <main className="flex-1 min-w-0 p-4 sm:p-6 lg:p-8 pb-24 md:pb-8">
          <div className="max-w-5xl mx-auto space-y-5">
            {children}
          </div>
        </main>
      </div>

      {/* Mobile 5-Tab Bottom Bar */}
      <nav
        className="md:hidden fixed bottom-0 inset-x-0 z-30 bg-white dark:bg-[#111C2E] border-t border-[#E5E7EB] dark:border-[#24344D] grid grid-cols-5 h-16"
        aria-label="Customer mobile navigation"
      >
        {mobileTabs.map((tab) => {
          const Icon = tab.icon;
          const active =
            tab.to === '/app'
              ? pathname === '/app' || pathname === '/app/overview'
              : pathname === tab.to;
          return (
            <button
              key={tab.to}
              type="button"
              onClick={() => navigate(tab.to)}
              className={`flex flex-col items-center justify-center gap-1 text-[11px] font-medium cursor-pointer ${
                active
                  ? 'text-[#0A2DB8] dark:text-[#60A5FA] font-semibold'
                  : 'text-[#64748B] dark:text-[#CBD5E1]'
              }`}
            >
              <Icon className="h-5 w-5" aria-hidden="true" />
              <span className="truncate max-w-[68px]">{tab.label}</span>
            </button>
          );
        })}
        <button
          type="button"
          onClick={() => setMoreOpen(true)}
          className="flex flex-col items-center justify-center gap-1 text-[11px] font-medium text-[#64748B] dark:text-[#CBD5E1] cursor-pointer"
        >
          <MoreHorizontal className="h-5 w-5" aria-hidden="true" />
          <span>More</span>
        </button>
      </nav>

      {moreOpen && (
        <div className="md:hidden fixed inset-0 z-50 bg-[#111827]/55 flex items-end">
          <div className="fixed inset-0" onClick={() => setMoreOpen(false)} aria-hidden="true" />
          <div className="relative z-10 w-full bg-white dark:bg-[#162338] border-t border-[#E5E7EB] dark:border-[#24344D] rounded-t-2xl p-4 space-y-2 max-h-[85vh] overflow-y-auto">
            <div className="flex items-center justify-between pb-2 border-b border-[#E5E7EB] dark:border-[#24344D]">
              <span className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
                Yene Tele Account Menu
              </span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close menu"
                className="p-1.5 rounded-lg text-[#64748B] dark:text-[#94A3B8]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="py-2 flex items-center justify-between gap-2 border-b border-[#E5E7EB] dark:border-[#24344D]">
              <span className="text-xs font-medium text-[#64748B] dark:text-[#CBD5E1]">
                {t.theme.label}
              </span>
              <ThemeSwitcher variant="segmented" />
            </div>

            {navItems.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.to}
                  type="button"
                  onClick={() => {
                    setMoreOpen(false);
                    navigate(item.to);
                  }}
                  className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-[#111827] dark:text-[#F8FAFC] hover:bg-[#EEF3FF]/60 dark:hover:bg-[#1C2D45]"
                >
                  <Icon className="h-4 w-4 text-[#0A2DB8] dark:text-[#60A5FA]" aria-hidden="true" />
                  <span>{item.label}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                navigate('/agent');
              }}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-[#111827] dark:text-[#F8FAFC] hover:bg-[#EEF3FF]/60 dark:hover:bg-[#1C2D45]"
            >
              <Users className="h-4 w-4 text-[#0A2DB8] dark:text-[#60A5FA]" aria-hidden="true" />
              <span>{t.nav.agentPortal}</span>
            </button>
            {isStaffAdmin && (
              <button
                type="button"
                onClick={() => {
                  setMoreOpen(false);
                  navigate('/admin');
                }}
                className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-[#111827] dark:text-[#F8FAFC] bg-[#EEF3FF] dark:bg-[#13254A]"
              >
                <ShieldCheck className="h-4 w-4 text-[#0A2DB8] dark:text-[#60A5FA]" aria-hidden="true" />
                <span>{t.nav.adminPortal}</span>
              </button>
            )}
            <button
              type="button"
              onClick={handleLogout}
              className="w-full flex items-center gap-3 px-3 py-3 rounded-lg text-sm font-medium text-[#DC2626] dark:text-[#FCA5A5] hover:bg-[#FEF2F2] dark:hover:bg-[#7F1D1D]/30"
            >
              <LogOut className="h-4 w-4" aria-hidden="true" />
              <span>{t.nav.logout}</span>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
