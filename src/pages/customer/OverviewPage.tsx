import React, { useEffect, useState } from 'react';
import { History, QrCode } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useLanguage } from '../../contexts/LanguageContext';
import { apiRequest } from '../../lib/apiClient';
import { useRouter } from '../../router/RouterContext';
import type { CustomerEsimRecord, EsimOrderRecord } from '../../types/domain';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { EmptyState, LoadingState } from '../../components/ui/States';
import { EsimProfileCard, SummaryMetricCard } from '../../components/yegna/DomainCards';
import { OperatorLogoTiles } from '../../components/yegna/OperatorLogoTiles';
import { OrderSummaryRow } from '../../components/yegna/TransactionRow';

export function OverviewPage() {
  const { profile } = useAuth();
  const { language } = useLanguage();
  const { navigate } = useRouter();
  const [esims, setEsims] = useState<CustomerEsimRecord[]>([]);
  const [orders, setOrders] = useState<EsimOrderRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      apiRequest<{ esims: CustomerEsimRecord[] }>('/api/v1/esims'),
      apiRequest<{ orders: EsimOrderRecord[] }>('/api/v1/orders'),
    ])
      .then(([e, o]) => {
        setEsims(e.esims);
        setOrders(o.orders);
      })
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return <LoadingState message="Loading your Yene Tele eSIM app..." />;
  }

  const displayName =
    profile?.user.displayName?.split(' ')[0] ??
    profile?.user.email?.split('@')[0] ??
    'Subscriber';

  return (
    <div className="space-y-6">
      <div className="space-y-1">
        <p className="text-xs font-semibold uppercase tracking-wider text-[#0A2DB8] dark:text-[#60A5FA]">
          Yene Tele
        </p>
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
          {language === 'am' ? `ሰላም, ${displayName}` : `Hi, ${displayName}`}
        </h1>
      </div>

      {/* Primary mobile action: simple 1-tap operator chooser */}
      <Card padding="md" variant="highlight" className="space-y-4">
        <div className="text-center">
          <h2 className="text-base sm:text-lg font-bold text-[#111827] dark:text-[#F8FAFC]">
            {language === 'am' ? 'ኦፕሬተርዎን ይምረጡ' : 'Choose your Operator'}
          </h2>
          <p className="text-xs text-[#64748B] dark:text-[#CBD5E1] mt-0.5">
            {language === 'am'
              ? 'አዲስ eSIM ለማግኘት አንዱን ይንኩ'
              : 'Tap an operator logo to start your eSIM'}
          </p>
        </div>
        <OperatorLogoTiles onSelect={(op) => navigate(`/buy-esim?operator=${op}`)} />
      </Card>

      {/* Compact mobile 2-up status tiles */}
      <div className="grid grid-cols-2 gap-3 sm:gap-4">
        <SummaryMetricCard
          label="My eSIMs"
          value={esims.length}
          hint={`${esims.filter((e) => e.status === 'installed' || e.status === 'activated').length} active`}
          icon={<QrCode className="h-4 w-4" />}
        />
        <SummaryMetricCard
          label="Orders"
          value={orders.length}
          hint={`${orders.filter((o) => o.status === 'awaiting_manual_fulfillment').length} pending`}
          tone="neutral"
          icon={<History className="h-4 w-4" />}
        />
      </div>

      {/* My eSIMs */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-base sm:text-lg font-semibold text-[#111827] dark:text-[#F8FAFC]">
            My eSIMs
          </h2>
          {esims.length > 0 && (
            <Button variant="tertiary" size="sm" onClick={() => navigate('/app/esims')}>
              View All →
            </Button>
          )}
        </div>
        {esims.length === 0 ? (
          <EmptyState
            title="No eSIMs yet"
            description="Tap Ethio telecom or Safaricom above to get your first digital eSIM."
          />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {esims.slice(0, 3).map((esim) => (
              <EsimProfileCard
                key={esim.id}
                esim={esim}
                onOpenInstall={() => navigate('/app/esims')}
              />
            ))}
          </div>
        )}
      </div>

      {/* Recent Orders */}
      {orders.length > 0 && (
        <Card>
          <CardHeader
            title="Recent Orders"
            action={
              <Button variant="secondary" size="sm" onClick={() => navigate('/app/orders')}>
                All Orders
              </Button>
            }
          />
          <div>
            {orders.slice(0, 5).map((order) => (
              <OrderSummaryRow
                key={order.id}
                order={order}
                onSelect={() => navigate('/app/orders')}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}
