import React, { useState } from 'react';
import { Globe, Menu, ShieldCheck, SwatchBook, Users, X } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useLanguage } from '../contexts/LanguageContext';
import { useRouter } from '../router/RouterContext';
import { Button } from '../components/ui/Button';
import { BrandWordmark } from '../components/yegna/BrandWordmark';
import { ThemeSwitcher } from '../components/yegna/ThemeSwitcher';

export function PublicLayout({ children }: { children: React.ReactNode }) {
  const { language, toggleLanguage, t } = useLanguage();
  const { pathname, navigate } = useRouter();
  const { firebaseUser } = useAuth();
  const [mobileOpen, setMobileOpen] = useState(false);

  const navLinks = [
    { to: '/buy-esim', label: t.nav.buyEsim },
    { to: '/how-it-works', label: t.nav.howItWorks },
    { to: '/supported-devices', label: t.nav.supportedDevices },
    { to: '/help', label: t.nav.help },
    { to: '/phones', label: t.nav.phones },
  ];

  const handleNav = (to: string) => {
    setMobileOpen(false);
    navigate(to);
  };

  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-[#0B1220] text-[#111827] dark:text-[#F8FAFC] transition-colors duration-150">
      {/* Confident Royal Blue Header preserving Yene Tele Theme */}
      <header className="sticky top-0 z-30 bg-[#0A2DB8] dark:bg-[#091847] text-white border-b border-white/15">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 h-16 flex items-center justify-between gap-4 lg:gap-8">
          <a
            href="/"
            onClick={(e) => {
              e.preventDefault();
              handleNav('/');
            }}
            className="focus:outline-none focus-visible:ring-2 focus-visible:ring-white/80 rounded-md shrink-0"
          >
            <img
              src="/assets/aistudio/image_28c3daa0.png"
              alt="Yene Tele (የእኔ ቴሌኮም)"
              className="h-9 w-auto rounded-lg bg-white px-2.5 py-1 object-contain"
            />
          </a>

          <nav className="hidden lg:flex items-center gap-6" aria-label="Main navigation">
            {navLinks.map((item) => {
              const active = pathname === item.to;
              return (
                <a
                  key={item.to}
                  href={item.to}
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav(item.to);
                  }}
                  className={`py-2 text-sm font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                    active
                      ? 'text-white border-white font-semibold'
                      : 'text-white/80 border-transparent hover:text-white'
                  }`}
                >
                  {item.label}
                </a>
              );
            })}
          </nav>

          <div className="flex items-center gap-2 shrink-0">
            <ThemeSwitcher variant="dropdown" invertedHeader />

            <button
              type="button"
              onClick={toggleLanguage}
              className="inline-flex items-center gap-1.5 min-h-[40px] sm:min-h-[36px] px-2.5 rounded-lg border border-white/25 bg-white/10 hover:bg-white/20 text-xs font-semibold text-white whitespace-nowrap shrink-0 cursor-pointer transition-colors"
              aria-label="Toggle language"
            >
              <Globe className="h-3.5 w-3.5 text-[#DCE7FF]" aria-hidden="true" />
              <span>{language === 'en' ? 'አማርኛ' : 'English'}</span>
            </button>

            <div className="hidden sm:flex items-center gap-2 pl-1">
              {firebaseUser ? (
                <>
                  <button
                    type="button"
                    onClick={() => handleNav('/app')}
                    className="px-3 min-h-[36px] rounded-lg text-sm font-medium text-white/90 hover:text-white hover:bg-white/10 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    {t.nav.myEsims}
                  </button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleNav('/buy-esim')}
                    className="!bg-white !text-[#0A2DB8] hover:!bg-[#EEF3FF] !border-transparent"
                  >
                    {t.nav.buyEsim}
                  </Button>
                </>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => handleNav('/login')}
                    className="px-3 min-h-[36px] rounded-lg text-sm font-medium text-white/90 hover:text-white hover:bg-white/10 whitespace-nowrap shrink-0 cursor-pointer transition-colors"
                  >
                    {t.nav.signIn}
                  </button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => handleNav('/buy-esim')}
                    className="!bg-white !text-[#0A2DB8] hover:!bg-[#EEF3FF] !border-transparent"
                  >
                    {t.nav.buyEsim}
                  </Button>
                </>
              )}
            </div>

            <button
              type="button"
              onClick={() => setMobileOpen((prev) => !prev)}
              aria-label={mobileOpen ? 'Close navigation menu' : 'Open navigation menu'}
              className="lg:hidden p-2 rounded-lg border border-white/25 bg-white/10 text-white hover:bg-white/20 cursor-pointer"
            >
              {mobileOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
            </button>
          </div>
        </div>

        {mobileOpen && (
          <div className="lg:hidden border-t border-white/15 bg-[#082499] dark:bg-[#0B1F5C] px-4 py-4 space-y-2">
            {navLinks.map((item) => (
              <a
                key={item.to}
                href={item.to}
                onClick={(e) => {
                  e.preventDefault();
                  handleNav(item.to);
                }}
                className={`block px-3 py-2.5 rounded-lg text-sm font-medium ${
                  pathname === item.to
                    ? 'bg-white text-[#0A2DB8] font-semibold'
                    : 'text-white/90 hover:bg-white/10 hover:text-white'
                }`}
              >
                {item.label}
              </a>
            ))}
            <div className="pt-3 border-t border-white/15 flex items-center justify-between gap-2">
              <span className="text-xs font-medium text-white/85">{t.theme.label}</span>
              <ThemeSwitcher variant="segmented" />
            </div>
            <div className="pt-3 border-t border-white/15 flex flex-col gap-2">
              {firebaseUser ? (
                <Button
                  variant="secondary"
                  className="!bg-white !text-[#0A2DB8] !border-transparent"
                  onClick={() => handleNav('/app')}
                >
                  {t.nav.customerPortal}
                </Button>
              ) : (
                <>
                  <Button
                    variant="secondary"
                    className="!bg-white/10 !text-white !border-white/25 hover:!bg-white/20"
                    onClick={() => handleNav('/login')}
                  >
                    {t.nav.signIn}
                  </Button>
                  <Button
                    variant="secondary"
                    className="!bg-white !text-[#0A2DB8] hover:!bg-[#EEF3FF] !border-transparent"
                    onClick={() => handleNav('/buy-esim')}
                  >
                    {t.nav.buyEsim}
                  </Button>
                </>
              )}
            </div>
          </div>
        )}
      </header>

      <main className="flex-1">{children}</main>

      {/* Strong Royal Blue Brand Footer */}
      <footer className="bg-[#0A2DB8] dark:bg-[#091847] text-white border-t border-white/10 py-14 px-4 sm:px-6 lg:px-8">
        <div className="max-w-7xl mx-auto grid grid-cols-1 md:grid-cols-4 gap-10">
          <div className="md:col-span-2 space-y-3.5">
            <BrandWordmark inverted useCircularEmblem />
            <p className="text-sm text-white/85 max-w-md leading-relaxed">
              {t.brandTagline}. Ethiopia&apos;s eSIM-first digital telecom platform for Ethio telecom
              and Safaricom Ethiopia lines, authorized agent distribution, and verified eSIM-ready
              handsets.
            </p>
            <p className="text-xs text-[#DCE7FF]/80">
              Yene Tele is an independent digital telecom reseller platform connecting customers
              with Ethio telecom, Safaricom Ethiopia, Fayda identity verification, and Chapa
              checkout.
            </p>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#DCE7FF]">
              eSIM &amp; Devices
            </h3>
            <ul className="mt-3.5 space-y-2.5 text-sm text-white/90">
              <li>
                <a
                  href="/buy-esim"
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav('/buy-esim');
                  }}
                  className="hover:text-white hover:underline underline-offset-4"
                >
                  {t.nav.buyEsim}
                </a>
              </li>
              <li>
                <a
                  href="/how-it-works"
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav('/how-it-works');
                  }}
                  className="hover:text-white hover:underline underline-offset-4"
                >
                  {t.nav.howItWorks}
                </a>
              </li>
              <li>
                <a
                  href="/operators"
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav('/operators');
                  }}
                  className="hover:text-white hover:underline underline-offset-4"
                >
                  {t.nav.operators}
                </a>
              </li>
              <li>
                <a
                  href="/supported-devices"
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav('/supported-devices');
                  }}
                  className="hover:text-white hover:underline underline-offset-4"
                >
                  {t.nav.supportedDevices}
                </a>
              </li>
              <li>
                <a
                  href="/phones"
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav('/phones');
                  }}
                  className="hover:text-white hover:underline underline-offset-4"
                >
                  {t.nav.phones}
                </a>
              </li>
            </ul>
          </div>

          <div>
            <h3 className="text-xs font-semibold uppercase tracking-wider text-[#DCE7FF]">
              Distribution &amp; Governance
            </h3>
            <ul className="mt-3.5 space-y-2.5 text-sm text-white/90">
              <li>
                <a
                  href="/help"
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav('/help');
                  }}
                  className="hover:text-white hover:underline underline-offset-4"
                >
                  {t.nav.help}
                </a>
              </li>
              <li>
                <a
                  href="/agent-programme"
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav('/agent-programme');
                  }}
                  className="inline-flex items-center gap-1.5 hover:text-white hover:underline underline-offset-4"
                >
                  <Users className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>Become an Authorized Agent</span>
                </a>
              </li>
              <li>
                <a
                  href="/design-system"
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav('/design-system');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#DCE7FF] hover:text-white"
                >
                  <SwatchBook className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t.nav.designSystem}</span>
                </a>
              </li>
              <li>
                <a
                  href="/admin/login"
                  onClick={(e) => {
                    e.preventDefault();
                    handleNav('/admin/login');
                  }}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-[#DCE7FF] hover:text-white"
                >
                  <ShieldCheck className="h-3.5 w-3.5" aria-hidden="true" />
                  <span>{t.nav.adminPortal}</span>
                </a>
              </li>
            </ul>
          </div>
        </div>
      </footer>
    </div>
  );
}
