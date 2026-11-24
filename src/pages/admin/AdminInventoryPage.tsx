import React, { useEffect, useState } from 'react';
import { apiRequest } from '../../lib/apiClient';
import type {
  CsvStockImportPreviewResult,
  EsimStockBatchRecord,
  EsimStockItemRecord,
  OperatorCode,
  StockItemStatus,
} from '../../types/domain';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { Card, CardHeader } from '../../components/ui/Card';
import { Dialog } from '../../components/ui/Dialog';
import { Input } from '../../components/ui/Input';
import { LoadingState } from '../../components/ui/States';
import { StatusBadge } from '../../components/ui/StatusBadge';
import { Table } from '../../components/ui/Table';

const SAMPLE_CSV = `msisdn,iccid,smdpAddress,activationCode,numberTier,externalRef
+251900000801,892510100000000801,sandbox-smdp.ethiotelecom.yene.invalid,ET-CSV-801,bronze,CSV-REF-801
+251900000802,892510100000000802,sandbox-smdp.ethiotelecom.yene.invalid,ET-CSV-802,gold,CSV-REF-802`;

export function AdminInventoryPage() {
  const [batches, setBatches] = useState<EsimStockBatchRecord[]>([]);
  const [items, setItems] = useState<EsimStockItemRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterOperator, setFilterOperator] = useState<'all' | OperatorCode>('all');
  const [filterStatus, setFilterStatus] = useState<'all' | StockItemStatus>('all');
  const [importTab, setImportTab] = useState<'single' | 'csv'>('single');

  const [operatorCode, setOperatorCode] = useState<OperatorCode>('ethio_telecom');
  const [batchName, setBatchName] = useState('Partner Sandbox Stock Batch');
  const [msisdn, setMsisdn] = useState('+251900000199');
  const [iccid, setIccid] = useState(`8925101000000009${Math.floor(10 + Math.random() * 89)}`);
  const [smdpAddress, setSmdpAddress] = useState('sandbox-smdp.ethiotelecom.yene.invalid');
  const [activationCode, setActivationCode] = useState('ET-SANDBOX-BATCH-199');

  const [csvText, setCsvText] = useState(SAMPLE_CSV);
  const [csvPreview, setCsvPreview] = useState<CsvStockImportPreviewResult | null>(null);
  const [inspectItem, setInspectItem] = useState<EsimStockItemRecord | null>(null);

  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = () => {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterOperator !== 'all') params.set('operator', filterOperator);
    if (filterStatus !== 'all') params.set('status', filterStatus);
    apiRequest<{ batches: EsimStockBatchRecord[]; items: EsimStockItemRecord[] }>(
      `/api/v1/admin/inventory?${params.toString()}`,
    )
      .then((res) => {
        setBatches(res.batches);
        setItems(res.items);
      })
      .finally(() => setLoading(false));
  };

  useEffect(() => {
    load();
  }, [filterOperator, filterStatus]);

  const handleImportSingle = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      await apiRequest('/api/v1/admin/inventory/batches', {
        method: 'POST',
        body: {
          operatorCode,
          batchName,
          sourceEnvironment: 'sandbox_demo',
          items: [{ msisdn, numberTier: 'standard', iccid, smdpAddress, activationCode }],
        },
      });
      setMsg('Encrypted stock item imported cleanly.');
      setIccid(`8925101000000009${Math.floor(10 + Math.random() * 89)}`);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Stock import failed.');
    } finally {
      setBusy(false);
    }
  };

  const handlePreviewCsv = async () => {
    setBusy(true);
    setMsg(null);
    setErr(null);
    try {
      const res = await apiRequest<{ preview: CsvStockImportPreviewResult }>(
        '/api/v1/admin/inventory/import-preview',
        {
          method: 'POST',
          body: { operatorCode, csvText },
        },
      );
      setCsvPreview(res.preview);
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'CSV validation preview failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleCommitCsv = async () => {
    if (!csvPreview || csvPreview.validCount === 0) return;
    setBusy(true);
    setErr(null);
    try {
      const lines = csvText
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0);
      const startIdx = lines[0]?.toLowerCase().includes('iccid') ? 1 : 0;
      const validIccids = new Set(csvPreview.rows.filter((r) => r.valid).map((r) => r.iccid));
      const parsedItems = [];
      for (let i = startIdx; i < lines.length; i += 1) {
        const [m = '', ic = '', smdp = '', code = '', tier = 'standard', ref = '', exp = ''] =
          lines[i].split(',').map((c) => c.trim());
        if (validIccids.has(ic)) {
          parsedItems.push({
            msisdn: m || undefined,
            iccid: ic,
            smdpAddress: smdp,
            activationCode: code,
            numberTier: (tier || 'standard') as EsimStockItemRecord['numberTier'],
            externalInventoryRef: ref || undefined,
            expiresAt: exp || null,
          });
        }
      }
      await apiRequest('/api/v1/admin/inventory/batches', {
        method: 'POST',
        body: {
          operatorCode,
          batchName: `${batchName} (CSV)`,
          sourceEnvironment: 'sandbox_demo',
          items: parsedItems,
        },
      });
      setMsg(`Imported ${parsedItems.length} validated CSV item(s) into encrypted inventory.`);
      setCsvPreview(null);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'CSV commit failed.');
    } finally {
      setBusy(false);
    }
  };

  const handleExpireReservations = async () => {
    setBusy(true);
    try {
      const res = await apiRequest<{ releasedCount: number }>('/api/v1/admin/inventory/expire-reservations', {
        method: 'POST',
      });
      setMsg(`Released ${res.releasedCount} stale number reservation(s).`);
      load();
    } finally {
      setBusy(false);
    }
  };

  const handleReconcile = async () => {
    setBusy(true);
    try {
      const res = await apiRequest<{
        report: {
          releasedReservations: number;
          expiredItems: number;
          flaggedReconciliation: number;
        };
      }>('/api/v1/admin/inventory/reconcile', { method: 'POST' });
      setMsg(
        `Reconciliation finished: ${res.report.releasedReservations} expired holds released, ${res.report.expiredItems} expired, ${res.report.flaggedReconciliation} flagged.`,
      );
      load();
    } finally {
      setBusy(false);
    }
  };

  const handleItemStatusChange = async (itemId: string, status: 'available' | 'invalid') => {
    setBusy(true);
    try {
      await apiRequest(`/api/v1/admin/inventory/items/${itemId}`, {
        method: 'PATCH',
        body: { status, reason: `Admin updated item status to ${status}` },
      });
      setInspectItem(null);
      setMsg(`Stock item updated to ${status}.`);
      load();
    } catch (error) {
      setErr(error instanceof Error ? error.message : 'Unable to update stock item.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <LoadingState message="Loading eSIM stock inventory..." />;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">eSIM Stock Inventory &amp; Reconciliation</h1>
          <p className="text-sm text-[#64748B] dark:text-[#CBD5E1]">
            Import encrypted stock batches, validate CSV uploads before committing, prevent
            duplicates, and run stock reconciliation. Activation secrets stay hidden.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" loading={busy} onClick={handleExpireReservations}>
            Release Expired Locks
          </Button>
          <Button loading={busy} onClick={handleReconcile}>
            Reconcile Stock
          </Button>
        </div>
      </div>

      {msg && <Alert tone="success">{msg}</Alert>}
      {err && <Alert tone="error">{err}</Alert>}

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHeader title="Import Encrypted eSIM Stock (AES-256-GCM)" />
          <div className="flex gap-2">
            <Button
              size="sm"
              variant={importTab === 'single' ? 'primary' : 'secondary'}
              onClick={() => setImportTab('single')}
            >
              Single Entry
            </Button>
            <Button
              size="sm"
              variant={importTab === 'csv' ? 'primary' : 'secondary'}
              onClick={() => setImportTab('csv')}
            >
              CSV Batch Preview &amp; Import
            </Button>
          </div>
        </div>

        {importTab === 'single' ? (
          <form onSubmit={handleImportSingle} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <div>
              <label className="block text-sm font-medium mb-1.5">Operator</label>
              <select
                value={operatorCode}
                onChange={(e) => setOperatorCode(e.target.value as OperatorCode)}
                className="w-full min-h-[44px] px-3 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-sm"
              >
                <option value="ethio_telecom">Ethio telecom</option>
                <option value="safaricom_ethiopia">Safaricom Ethiopia</option>
              </select>
            </div>
            <Input label="Batch Name" value={batchName} onChange={(e) => setBatchName(e.target.value)} required />
            <Input label="MSISDN (+251...)" value={msisdn} onChange={(e) => setMsisdn(e.target.value)} required />
            <Input label="ICCID" value={iccid} onChange={(e) => setIccid(e.target.value)} required />
            <Input label="SM-DP+ Address" value={smdpAddress} onChange={(e) => setSmdpAddress(e.target.value)} required />
            <Input label="Activation Code" value={activationCode} onChange={(e) => setActivationCode(e.target.value)} required />
            <div className="sm:col-span-2 lg:col-span-3">
              <Button type="submit" loading={busy}>
                Encrypt &amp; Add to Stock
              </Button>
            </div>
          </form>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-1.5">Operator</label>
                <select
                  value={operatorCode}
                  onChange={(e) => setOperatorCode(e.target.value as OperatorCode)}
                  className="w-full min-h-[44px] px-3 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-sm"
                >
                  <option value="ethio_telecom">Ethio telecom</option>
                  <option value="safaricom_ethiopia">Safaricom Ethiopia</option>
                </select>
              </div>
              <Input label="Batch Name" value={batchName} onChange={(e) => setBatchName(e.target.value)} />
            </div>

            <div>
              <label className="block text-sm font-medium mb-1.5">
                CSV Data (msisdn,iccid,smdpAddress,activationCode,numberTier,externalRef)
              </label>
              <textarea
                rows={5}
                value={csvText}
                onChange={(e) => {
                  setCsvText(e.target.value);
                  setCsvPreview(null);
                }}
                className="w-full p-3 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-xs font-mono"
              />
            </div>

            <div className="flex flex-wrap gap-2">
              <Button variant="secondary" loading={busy} onClick={handlePreviewCsv}>
                Validate &amp; Preview CSV
              </Button>
              {csvPreview && csvPreview.validCount > 0 && (
                <Button loading={busy} onClick={handleCommitCsv}>
                  Commit {csvPreview.validCount} Valid Row(s)
                </Button>
              )}
            </div>

            {csvPreview && (
              <div className="space-y-3 pt-2">
                <Alert tone={csvPreview.invalidCount > 0 ? 'warning' : 'success'}>
                  Validation Report: {csvPreview.validCount} valid · {csvPreview.invalidCount} invalid ·{' '}
                  {csvPreview.duplicateCount} duplicate(s) out of {csvPreview.totalRows} row(s).
                </Alert>
                <Table
                  rows={csvPreview.rows}
                  getRowKey={(r) => String(r.rowNumber)}
                  columns={[
                    { key: 'row', header: 'Row', render: (r) => `#${r.rowNumber}` },
                    { key: 'msisdn', header: 'MSISDN', render: (r) => r.msisdn ?? '—' },
                    { key: 'iccid', header: 'ICCID', render: (r) => r.iccid },
                    {
                      key: 'res',
                      header: 'Validation',
                      render: (r) =>
                        r.valid ? (
                          <StatusBadge status="verified" label="Valid" />
                        ) : (
                          <span className="text-xs text-[#B91C1C] dark:text-[#FCA5A5]">
                            {r.errors.join('; ')}
                          </span>
                        ),
                    },
                  ]}
                />
              </div>
            )}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title={`Stock Batches (${batches.length})`} />
        <Table
          rows={batches}
          getRowKey={(b) => b.id}
          columns={[
            { key: 'name', header: 'Batch', render: (b) => b.batchName },
            { key: 'op', header: 'Operator', render: (b) => b.operatorCode },
            { key: 'env', header: 'Environment', render: (b) => <StatusBadge status="sandbox" label={b.sourceEnvironment} /> },
            { key: 'avail', header: 'Available / Total', align: 'right', render: (b) => <span className="tabular-nums font-semibold">{b.availableCount} / {b.totalCount}</span> },
          ]}
        />
      </Card>

      <Card className="space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <CardHeader title={`Stock Items (${items.length})`} />
          <div className="flex flex-wrap gap-2">
            <select
              value={filterOperator}
              onChange={(e) => setFilterOperator(e.target.value as 'all' | OperatorCode)}
              className="px-3 py-1.5 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-xs"
            >
              <option value="all">All Operators</option>
              <option value="ethio_telecom">Ethio telecom</option>
              <option value="safaricom_ethiopia">Safaricom Ethiopia</option>
            </select>
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value as 'all' | StockItemStatus)}
              className="px-3 py-1.5 rounded-lg border border-[#D1D5DB] dark:border-[#334866] bg-white dark:bg-[#111C2E] text-xs"
            >
              <option value="all">All Statuses</option>
              <option value="available">Available</option>
              <option value="reserved">Reserved</option>
              <option value="assigned">Assigned</option>
              <option value="expired">Expired</option>
              <option value="invalid">Invalid</option>
              <option value="reconciliation_required">Reconciliation Required</option>
            </select>
          </div>
        </div>
        <Table
          rows={items}
          getRowKey={(i) => i.id}
          columns={[
            { key: 'msisdn', header: 'MSISDN', render: (i) => <span className="font-semibold tabular-nums">{i.msisdn ?? 'Unassigned'}</span> },
            { key: 'iccid', header: 'ICCID', render: (i) => <span className="text-xs tabular-nums">{i.iccid}</span> },
            { key: 'tier', header: 'Tier', render: (i) => i.numberTier },
            {
              key: 'st',
              header: 'Status',
              render: (i) => (
                <StatusBadge
                  status={
                    i.status === 'available'
                      ? 'verified'
                      : i.status === 'reserved'
                        ? 'processing'
                        : i.status === 'invalid' || i.status === 'expired' || i.status === 'reconciliation_required'
                          ? 'failed'
                          : 'active'
                  }
                  label={i.status.replace(/_/g, ' ')}
                />
              ),
            },
            {
              key: 'act',
              header: 'Inspect',
              render: (i) => (
                <Button size="sm" variant="tertiary" onClick={() => setInspectItem(i)}>
                  Audit History
                </Button>
              ),
            },
          ]}
        />
      </Card>

      <Dialog
        open={Boolean(inspectItem)}
        onClose={() => setInspectItem(null)}
        title={`Stock Item · ${inspectItem?.msisdn ?? inspectItem?.iccid ?? ''}`}
        description="Inventory metadata & audit trail (encrypted activation credentials omitted)"
      >
        {inspectItem && (
          <div className="space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-3 p-3 rounded-xl bg-[#F8FAFC] dark:bg-[#111C2E] border border-[#E5E7EB] dark:border-[#24344D]">
              <div>
                <p className="text-[#64748B]">External Reference</p>
                <p className="font-semibold">{inspectItem.externalInventoryRef ?? '—'}</p>
              </div>
              <div>
                <p className="text-[#64748B]">Inventory Type</p>
                <p className="font-semibold">{inspectItem.inventoryType}</p>
              </div>
              <div>
                <p className="text-[#64748B]">Imported At</p>
                <p className="font-semibold">{new Date(inspectItem.importedAt).toLocaleString()}</p>
              </div>
              <div>
                <p className="text-[#64748B]">Expiry</p>
                <p className="font-semibold">{inspectItem.expiresAt ?? 'No expiry set'}</p>
              </div>
            </div>

            <div className="max-h-44 overflow-y-auto space-y-1.5">
              {inspectItem.auditHistory.map((h, idx) => (
                <div key={idx} className="p-2 rounded border border-[#E5E7EB] dark:border-[#24344D]">
                  <span className="font-semibold">{h.action}</span> · {h.actor} — {h.note}
                </div>
              ))}
            </div>

            {!['sold', 'assigned'].includes(inspectItem.status) && (
              <div className="flex justify-end gap-2">
                {inspectItem.status !== 'invalid' && (
                  <Button
                    size="sm"
                    variant="destructive"
                    loading={busy}
                    onClick={() => handleItemStatusChange(inspectItem.id, 'invalid')}
                  >
                    Mark Invalid
                  </Button>
                )}
                {inspectItem.status !== 'available' && (
                  <Button
                    size="sm"
                    loading={busy}
                    onClick={() => handleItemStatusChange(inspectItem.id, 'available')}
                  >
                    Restore Available
                  </Button>
                )}
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
