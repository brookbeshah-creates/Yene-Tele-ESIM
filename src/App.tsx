import React, { useEffect } from 'react';
import { ErrorBoundary } from './components/ErrorBoundary';
import { Button } from './components/ui/Button';
import { AuthProvider, useAuth } from './contexts/AuthContext';
import { LanguageProvider } from './contexts/LanguageContext';
import { PhoneCartProvider } from './contexts/PhoneCartContext';
import { ThemeProvider } from './contexts/ThemeContext';
import { AdminLayout } from './layouts/AdminLayout';
import { AgentLayout } from './layouts/AgentLayout';
import { CustomerLayout } from './layouts/CustomerLayout';
import { PublicLayout } from './layouts/PublicLayout';
import { AdminAgentsPage } from './pages/admin/AdminAgentsPage';
import { AdminInventoryPage } from './pages/admin/AdminInventoryPage';
import { AdminLoginPage } from './pages/admin/AdminLoginPage';
import {
  AdminAuditLogsPage,
  AdminCustomersPage,
  AdminPaymentsPage,
  AdminPhonesPage,
  AdminSettingsPage,
  AdminSupportPage,
} from './pages/admin/AdminOperationsSubPages';
import { AdminOperatorsPage } from './pages/admin/AdminOperatorsPage';
import { AdminOrdersPage } from './pages/admin/AdminOrdersPage';
import { AdminOverviewPage } from './pages/admin/AdminOverviewPage';
import { AgentPortalPage } from './pages/agent/AgentPortalPage';
import { BusinessPortalPage } from './pages/customer/BusinessPortalPage';
import { CustomerOrdersPage, CustomerPhonesPage } from './pages/customer/CustomerOrdersPages';
import {
  CustomerSettingsPage,
  CustomerSupportPage,
} from './pages/customer/CustomerSupportSettingsPage';
import { MyEsimsPage } from './pages/customer/MyEsimsPage';
import { OverviewPage } from './pages/customer/OverviewPage';
import { AuthPages } from './pages/public/AuthPages';
import { BuyEsimPage } from './pages/public/BuyEsimPage';
import { DesignSystemPage } from './pages/public/DesignSystemPage';
import { HomePage } from './pages/public/HomePage';
import {
  AgentProgrammePage,
  HelpSupportPage,
  HowItWorksPage,
  OperatorsPage,
  PhonesMarketplacePage,
} from './pages/public/InfoPages';
import { SupportedDevicesPage } from './pages/public/SupportedDevicesPage';
import { RouterProvider, useRouter } from './router/RouterContext';

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
      if (rawRedirect && (rawRedirect.startsWith('/phones') || rawRedirect.startsWith('/app/phones'))) {
        const normalized = rawRedirect.startsWith('/phones') ? `/app${rawRedirect}` : rawRedirect;
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
    return <AdminLoginPage />;
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

    return <AdminLayout>{adminView}</AdminLayout>;
  }

  // Authorized Agent Portal routes
  if (pathname === '/agent' || pathname.startsWith('/agent/')) {
    return (
      <AgentLayout>
        <AgentPortalPage />
      </AgentLayout>
    );
  }

  // Authenticated users NEVER see public marketing website headers/footers
  if (!loading && firebaseUser) {
    if (pathname === '/buy-esim') {
      return (
        <CustomerLayout>
          <BuyEsimPage />
        </CustomerLayout>
      );
    }
    if (
      pathname === '/phones' ||
      pathname.startsWith('/phones/') ||
      pathname === '/app/phones' ||
      pathname.startsWith('/app/phones/')
    ) {
      return (
        <CustomerLayout>
          <CustomerPhonesPage />
        </CustomerLayout>
      );
    }
    if (pathname === '/supported-devices') {
      return (
        <CustomerLayout>
          <SupportedDevicesPage />
        </CustomerLayout>
      );
    }
    if (pathname === '/help' || pathname === '/app/support') {
      return (
        <CustomerLayout>
          <CustomerSupportPage />
        </CustomerLayout>
      );
    }
    if (pathname === '/app/esims') {
      return (
        <CustomerLayout>
          <MyEsimsPage />
        </CustomerLayout>
      );
    }
    if (pathname === '/app/orders') {
      return (
        <CustomerLayout>
          <CustomerOrdersPage />
        </CustomerLayout>
      );
    }
    if (pathname === '/app/business') {
      return (
        <CustomerLayout>
          <BusinessPortalPage />
        </CustomerLayout>
      );
    }
    if (pathname === '/app/settings') {
      return (
        <CustomerLayout>
          <CustomerSettingsPage />
        </CustomerLayout>
      );
    }

    return (
      <CustomerLayout>
        <OverviewPage />
      </CustomerLayout>
    );
  }

  // Unauthenticated visits to /app* render CustomerLayout's Sign-In gate
  if (pathname === '/app' || pathname.startsWith('/app/')) {
    return (
      <CustomerLayout>
        <OverviewPage />
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
            <h1 className="text-2xl font-semibold text-[#111827] dark:text-[#F8FAFC]">
              Page not found
            </h1>
            <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
              The requested Yene Tele route does not exist.
            </p>
            <Button onClick={() => navigate('/')}>Return to Home</Button>
          </div>
        );
        break;
    }
  }

  return <PublicLayout>{publicView}</PublicLayout>;
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
              </AuthProvider>
            </RouterProvider>
          </PhoneCartProvider>
        </LanguageProvider>
      </ThemeProvider>
    </ErrorBoundary>
  );
}
