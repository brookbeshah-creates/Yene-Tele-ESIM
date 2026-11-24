import React, { useEffect, useState } from 'react';
import { PhoneCall, Smartphone } from 'lucide-react';
import { apiRequest } from '../../lib/apiClient';
import { useRouter } from '../../router/RouterContext';
import type { DeviceCompatibilityRecord } from '../../types/domain';
import { Button } from '../../components/ui/Button';
import { Card } from '../../components/ui/Card';
import { Input } from '../../components/ui/Input';
import { DeviceCompatibilityCard } from '../../components/yegna/DomainCards';

export function SupportedDevicesPage() {
  const { navigate } = useRouter();
  const [devices, setDevices] = useState<DeviceCompatibilityRecord[]>([]);
  const [query, setQuery] = useState('');
  const [osFilter, setOsFilter] = useState<'all' | 'ios' | 'android'>('all');

  useEffect(() => {
    const params = new URLSearchParams();
    if (query.trim()) params.set('q', query.trim());
    if (osFilter !== 'all') params.set('os', osFilter);
    apiRequest<{ devices: DeviceCompatibilityRecord[] }>(
      `/api/v1/devices/compatibility?${params.toString()}`,
      { requireAuth: false },
    )
      .then((res) => setDevices(res.devices))
      .catch(() => {});
  }, [query, osFilter]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12 space-y-8">
      <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
        <div className="max-w-2xl space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wider text-[#0A2DB8] dark:text-[#60A5FA]">
            Device Compatibility Checker
          </p>
          <h1 className="text-3xl font-bold tracking-tight text-[#111827] dark:text-[#F8FAFC]">
            Supported eSIM smartphones &amp; regional caveats
          </h1>
          <p className="text-sm sm:text-base text-[#64748B] dark:text-[#CBD5E1]">
            Confirm your handset supports eSIM hardware and is carrier-unlocked before ordering.
          </p>
        </div>
        <Button onClick={() => navigate('/buy-esim')}>Buy eSIM</Button>
      </div>

      <Card variant="highlight" padding="sm" className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-[#0A2DB8] text-white shrink-0">
            <PhoneCall className="h-5 w-5" />
          </span>
          <div>
            <p className="text-sm font-semibold text-[#111827] dark:text-[#F8FAFC]">
              Verify EID directly on your handset: dial <span className="tabular-nums">*#06#</span>
            </p>
            <p className="text-xs text-[#64748B] dark:text-[#CBD5E1]">
              If a 32-digit EID appears and Settings shows &ldquo;Add eSIM&rdquo;, your device can
              install an Ethiopian eSIM profile. Mainland China / HK variants often omit hardware eSIM.
            </p>
          </div>
        </div>
        <Button variant="secondary" size="sm" onClick={() => navigate('/phones')}>
          Need an eSIM Phone?
        </Button>
      </Card>

      <div className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
        <div className="flex-1">
          <Input
            label="Search phone brand or model"
            inputKind="search"
            placeholder="e.g. iPhone 15, Galaxy S24, Pixel, Xiaomi..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="flex gap-2">
          {(['all', 'ios', 'android'] as const).map((os) => (
            <button
              key={os}
              type="button"
              onClick={() => setOsFilter(os)}
              className={`px-4 min-h-[44px] rounded-lg border text-sm font-medium capitalize cursor-pointer ${
                osFilter === os
                  ? 'bg-[#0A2DB8] text-white border-[#0A2DB8]'
                  : 'bg-white dark:bg-[#162338] border-[#E5E7EB] dark:border-[#24344D] text-[#111827] dark:text-[#F8FAFC]'
              }`}
            >
              {os === 'all' ? 'All OS' : os === 'ios' ? 'Apple iOS' : 'Android'}
            </button>
          ))}
        </div>
      </div>

      {devices.length === 0 ? (
        <Card className="text-center py-10 space-y-2">
          <Smartphone className="h-8 w-8 mx-auto text-[#64748B]" />
          <p className="text-sm font-medium">No matching models found.</p>
          <p className="text-xs text-[#64748B]">
            Try dialing *#06# on your phone directly to confirm EID support.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
          {devices.map((device) => (
            <DeviceCompatibilityCard key={device.id} device={device} />
          ))}
        </div>
      )}
    </div>
  );
}
