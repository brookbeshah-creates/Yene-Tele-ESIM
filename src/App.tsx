import React, { Suspense, lazy, useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/ui/Button';
import { LoadingState } from './components/ui/States';
import { MelaAssistant } from './components/yegna/MelaAssistant';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { PhoneCartProvider } from './contexts/PhoneCartContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AdminLayout } from './layouts/AdminLayout';
import { AgentLayout } from './layouts/AgentLayout';
import { CustomerLayout } from './layouts/CustomerLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { HomePage } from './pages/public/HomePage';
import { RouterProvider, useRouter } from './router/RouterContext';

// Code-split secondary, customer, agent, and admin views for fast mobile startup
const BuyEsimPage = lazy(() =>
  import('./pages/public/BuyEsimPage').then((m) => ({ default: m.BuyEsimPage })),
);
const AuthPages = lazy(() =>
  import('./pages/public/AuthPages').then((m) => ({ default: m.AuthPages })),
);
const SupportedDevicesPage = lazy(() =>
  import('./pages/public/SupportedDevicesPage').then((m) => ({ default: m.SupportedDevicesPage })),
);
const DesignSystemPage = lazy(() =>
  import('./pages/public/DesignSystemPage').then((m) => ({ default: m.DesignSystemPage })),
);
const AgentProgrammePage = lazy(() =>
  import('./pages/public/InfoPages').then((m) => ({ default: m.AgentProgrammePage })),
);
const HelpSupportPage = lazy(() =>
  import('./pages/public/InfoPages').then((m) => ({ default: m.HelpSupportPage })),
);
const HowItWorksPage = lazy(() =>
  import('./pages/public/InfoPages').then((m) => ({ default: m.HowItWorksPage })),
);
const OperatorsPage = lazy(() =>
  import('./pages/public/InfoPages').then((m) => ({ default: m.OperatorsPage })),
);
const PhonesMarketplacePage = lazy(() =>
  import('./pages/public/InfoPages').then((m) => ({ default: m.PhonesMarketplacePage })),
);

const OverviewPage = lazy(() =>
  import('./pages/customer/OverviewPage').then((m) => ({ default: m.OverviewPage })),
);
const MyEsimsPage = lazy(() =>
  import('./pages/customer/MyEsimsPage').then((m) => ({ default: m.MyEsimsPage })),
);
const BusinessPortalPage = lazy(() =>
  import('./pages/customer/BusinessPortalPage').then((m) => ({ default: m.BusinessPortalPage })),
);
const CustomerOrdersPage = lazy(() =>
  import('./pages/customer/CustomerOrdersPages').then((m) => ({ default: m.CustomerOrdersPage })),
);
const CustomerPhonesPage = lazy(() =>
  import('./pages/customer/CustomerOrdersPages').then((m) => ({ default: m.CustomerPhonesPage })),
);
const CustomerSettingsPage = lazy(() =>
  import('./pages/customer/CustomerSupportSettingsPage').then((m) => ({
    default: m.CustomerSettingsPage,
  })),
);
const CustomerSupportPage = lazy(() =>
  import('./pages/customer/CustomerSupportSettingsPage').then((m) => ({
    default: m.CustomerSupportPage,
  })),
);

const AgentPortalPage = lazy(() =>
  import('./pages/agent/AgentPortalPage').then((m) => ({ default: m.AgentPortalPage })),
);

const AdminLoginPage = lazy(() =>
  import('./pages/admin/AdminLoginPage').then((m) => ({ default: m.AdminLoginPage })),
);
const AdminOverviewPage = lazy(() =>
  import('./pages/admin/AdminOverviewPage').then((m) => ({ default: m.AdminOverviewPage })),
);
const AdminOrdersPage = lazy(() =>
  import('./pages/admin/AdminOrdersPage').then((m) => ({ default: m.AdminOrdersPage })),
);
const AdminOperatorsPage = lazy(() =>
  import('./pages/admin/AdminOperatorsPage').then((m) => ({ default: m.AdminOperatorsPage })),
);
const AdminInventoryPage = lazy(() =>
  import('./pages/admin/AdminInventoryPage').then((m) => ({ default: m.AdminInventoryPage })),
);
const AdminAgentsPage = lazy(() =>
  import('./pages/admin/AdminAgentsPage').then((m) => ({ default: m.AdminAgentsPage })),
);
const AdminAuditLogsPage = lazy(() =>
  import('./pages/admin/AdminOperationsSubPages').then((m) => ({ default: m.AdminAuditLogsPage })),
);
const AdminCustomersPage = lazy(() =>
  import('./pages/admin/AdminOperationsSubPages').then((m) => ({ default: m.AdminCustomersPage })),
);
const AdminPaymentsPage = lazy(() =>
  import('./pages/admin/AdminOperationsSubPages').then((m) => ({ default: m.AdminPaymentsPage })),
);
const AdminPhonesPage = lazy(() =>
  import('./pages/admin/AdminOperationsSubPages').then((m) => ({ default: m.AdminPhonesPage })),
);
const AdminSettingsPage = lazy(() =>
  import('./pages/admin/AdminOperationsSubPages').then((m) => ({ default: m.AdminSettingsPage })),
);
const AdminSupportPage = lazy(() =>
  import('./pages/admin/AdminOperationsSubPages').then((m) => ({ default: m.AdminSupportPage })),
);

function RouteLoader() {
  return (
    <div className="max-w-lg mx-auto px-4 py-12">
      <LoadingState message="Loading Yene Tele..." />
    </div>
  );
}

function AppRoutes() {
  const { pathname, search, navigate } = useRouter();
  const { firebaseUser, loading } = useAuth();

  const isAuthOrRoot =
    pathname === '/' ||
    pathname === '/login' ||
    pathname === '/register' ||
    pathname === '/forgot-password' ||
    pathname === '/how-it-works' ||
    pathname === '/operators';

  useEffect(() => {
    if (!loading && firebaseUser && isAuthOrRoot) {
      const rawRedirect = new URLSearchParams(search).get('redirect');
      if (rawRedirect && rawRedirect.startsWith('/') && !rawRedirect.startsWith('//')) {
        const normalized =
          rawRedirect === '/phones' || rawRedirect.startsWith('/phones/')
            ? `/app${rawRedirect}`
            : rawRedirect;
        navigate(normalized, { replace: true });
      } else {
        navigate('/app', { replace: true });
      }
    } else if (!loading && firebaseUser && (pathname === '/phones' || pathname.startsWith('/phones/'))) {
      navigate(`/app${pathname}`, { replace: true });
    }
  }, [loading, firebaseUser, isAuthOrRoot, pathname, search, navigate]);

  // Staff Admin Portal routes
  if (pathname === '/admin/login') {
    return (
      <Suspense fallback={<RouteLoader />}>
        <AdminLoginPage />
      </Suspense>
    );
  }

  if (pathname === '/admin' || pathname.startsWith('/admin/')) {
    let adminView: React.ReactNode = <AdminOverviewPage />;
    if (pathname === '/admin/orders') adminView = <AdminOrdersPage />;
    else if (pathname === '/admin/operators') adminView = <AdminOperatorsPage />;
    else if (pathname === '/admin/inventory') adminView = <AdminInventoryPage />;
    else if (pathname === '/admin/agents') adminView = <AdminAgentsPage />;
    else if (pathname === '/admin/payments') adminView = <AdminPaymentsPage />;
    else if (pathname === '/admin/customers') adminView = <AdminCustomersPage />;
    else if (pathname === '/admin/phones') adminView = <AdminPhonesPage />;
    else if (pathname === '/admin/support') adminView = <AdminSupportPage />;
    else if (pathname === '/admin/audit-logs') adminView = <AdminAuditLogsPage />;
    else if (pathname === '/admin/settings') adminView = <AdminSettingsPage />;

    return (
      <AdminLayout>
        <Suspense fallback={<RouteLoader />}>{adminView}</Suspense>
      </AdminLayout>
    );
  }

  // Authorized Agent Portal routes
  if (pathname === '/agent' || pathname.startsWith('/agent/')) {
    return (
      <AgentLayout>
        <Suspense fallback={<RouteLoader />}>
          <AgentPortalPage />
        </Suspense>
      </AgentLayout>
    );
  }

  // Authenticated users NEVER see public marketing website headers/footers
  if (!loading && firebaseUser) {
    let customerView: React.ReactNode = <OverviewPage />;
    if (pathname === '/buy-esim') customerView = <BuyEsimPage />;
    else if (
      pathname === '/phones' ||
      pathname.startsWith('/phones/') ||
      pathname === '/app/phones' ||
      pathname.startsWith('/app/phones/')
    ) {
      customerView = <CustomerPhonesPage />;
    } else if (pathname === '/supported-devices') customerView = <SupportedDevicesPage />;
    else if (pathname === '/help' || pathname === '/app/support') customerView = <CustomerSupportPage />;
    else if (pathname === '/app/esims') customerView = <MyEsimsPage />;
    else if (pathname === '/app/orders') customerView = <CustomerOrdersPage />;
    else if (pathname === '/app/business') customerView = <BusinessPortalPage />;
    else if (pathname === '/app/settings') customerView = <CustomerSettingsPage />;

    return (
      <CustomerLayout>
        <Suspense fallback={<RouteLoader />}>{customerView}</Suspense>
      </CustomerLayout>
    );
  }

  // Unauthenticated visits to /app* render CustomerLayout's Sign-In gate
  if (pathname === '/app' || pathname.startsWith('/app/')) {
    return (
      <CustomerLayout>
        <Suspense fallback={<RouteLoader />}>
          <OverviewPage />
        </Suspense>
      </CustomerLayout>
    );
  }

  // Public Storefront & Authentication routes
  let publicView: React.ReactNode;
  if (pathname === '/phones' || pathname.startsWith('/phones/')) {
    publicView = <PhonesMarketplacePage />;
  } else {
    switch (pathname) {
      case '/':
        publicView = <HomePage />;
        break;
      case '/buy-esim':
        publicView = <BuyEsimPage />;
        break;
      case '/how-it-works':
        publicView = <HowItWorksPage />;
        break;
      case '/operators':
        publicView = <OperatorsPage />;
        break;
      case '/supported-devices':
        publicView = <SupportedDevicesPage />;
        break;
      case '/help':
        publicView = <HelpSupportPage />;
        break;
      case '/agent-programme':
        publicView = <AgentProgrammePage />;
        break;
      case '/design-system':
        publicView = <DesignSystemPage />;
        break;
      case '/login':
        publicView = <AuthPages mode="login" />;
        break;
      case '/register':
        publicView = <AuthPages mode="register" />;
        break;
      case '/forgot-password':
        publicView = <AuthPages mode="forgot" />;
        break;
      default:
        publicView = (
          <div className="max-w-lg mx-auto px-4 py-20 text-center space-y-4">
            <h1 className="text-2xl font-semibold text-[#202124] dark:text-[#F8FAFC]">
              Page not found
            </h1>
            <p className="text-sm text-[#5F6368] dark:text-[#CBD5E1]">
              The requested Yene Tele route does not exist.
            </p>
            <Button onClick={() => navigate('/')}>Return to Home</Button>
          </div>
        );
        break;
    }
  }

  return (
    <PublicLayout>
      <Suspense fallback={<RouteLoader />}>{publicView}</Suspense>
    </PublicLayout>
  );
}

export default function App() {
  return (
    <ErrorBoundary>
      <ThemeProvider>
        <LanguageProvider>
          <PhoneCartProvider>
            <RouterProvider>
              <AuthProvider>
                <AppRoutes />
                <MelaAssistant />
              </AuthProvider>
            </RouterProvider>
          </PhoneCartProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
