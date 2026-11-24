import type { Pool, PoolClient, QueryResult, QueryResultRow } from 'pg';

export interface RecordedQuery {
  text: string;
  values?: unknown[];
}

function normalizeSql(sql: string): string {
  return sql.replace(/\s+/g, ' ').trim();
}

function emptyResult<R extends QueryResultRow = Record<string, unknown>>(command = 'SELECT'): QueryResult<R> {
  return { rows: [], command, rowCount: 0, oid: 0, fields: [] };
}

function rowsResult<R extends QueryResultRow = Record<string, unknown>>(
  rows: Record<string, unknown>[],
  command = 'SELECT',
): QueryResult<R> {
  return {
    rows: rows as unknown as R[],
    command,
    rowCount: rows.length,
    oid: 0,
    fields: [],
  };
}

export function createMockRelationalPgPool() {
  const queries: RecordedQuery[] = [];
  const appliedMigrations = new Set<string>();
  let simulateInsertError = false;
  let simulateConnectionDown = false;
  let holdAdvisoryLock = false;

  const tables = {
    users: new Map<string, Record<string, unknown>>(),
    staff_admins: new Map<string, Record<string, unknown>>(),
    staff_admin_invites: new Map<string, Record<string, unknown>>(),
    operators: new Map<string, Record<string, unknown>>(),
    esim_products: new Map<string, Record<string, unknown>>(),
    phone_products: new Map<string, Record<string, unknown>>(),
    esim_stock_batches: new Map<string, Record<string, unknown>>(),
    esim_stock_items: new Map<string, Record<string, unknown>>(),
    esim_orders: new Map<string, Record<string, unknown>>(),
    kyc_verifications: new Map<string, Record<string, unknown>>(),
    payments: new Map<string, Record<string, unknown>>(),
    processed_webhook_events: new Map<string, Record<string, unknown>>(),
    esim_activations: new Map<string, Record<string, unknown>>(),
    agent_applications: new Map<string, Record<string, unknown>>(),
    agents: new Map<string, Record<string, unknown>>(),
    agent_commissions: new Map<string, Record<string, unknown>>(),
    agent_payouts: new Map<string, Record<string, unknown>>(),
    phone_orders: new Map<string, Record<string, unknown>>(),
    support_tickets: new Map<string, Record<string, unknown>>(),
    business_accounts: new Map<string, Record<string, unknown>>(),
    business_members: new Map<string, Record<string, unknown>>(),
    business_bulk_orders: new Map<string, Record<string, unknown>>(),
    audit_logs: [] as Record<string, unknown>[],
    scheduled_job_runs: [] as Record<string, unknown>[],
  };

  const lockedStockIds = new Set<string>();

  const executeQuery = async <R extends QueryResultRow = Record<string, unknown>>(
    text: string,
    values?: unknown[],
  ): Promise<QueryResult<R>> => {
    queries.push({ text, values });
    const sql = normalizeSql(text);

    if (simulateConnectionDown) {
      const err = new Error('connect ECONNREFUSED 127.0.0.1:5432') as Error & { code?: string };
      err.code = 'ECONNREFUSED';
      throw err;
    }

    if (simulateInsertError && sql.includes('SIMULATE_ERROR')) {
      throw new Error('Simulated transaction error');
    }

    if (sql === 'BEGIN' || sql === 'COMMIT' || sql === 'ROLLBACK') {
      if (sql === 'COMMIT' || sql === 'ROLLBACK') {
        lockedStockIds.clear();
      }
      return emptyResult(sql);
    }

    if (sql === 'SELECT 1 AS ok') {
      return rowsResult([{ ok: 1 }]);
    }

    // Migrations & schema check
    if (sql.includes('CREATE TABLE IF NOT EXISTS schema_migrations')) {
      return emptyResult('CREATE');
    }
    if (sql.includes('SELECT version FROM schema_migrations')) {
      return rowsResult(Array.from(appliedMigrations).map((version) => ({ version })));
    }
    if (sql.includes('INSERT INTO schema_migrations') && values?.[0]) {
      appliedMigrations.add(String(values[0]));
      return emptyResult('INSERT');
    }
    if (sql.includes('FROM information_schema.tables')) {
      const required = [
        'users',
        'staff_admins',
        'staff_admin_invites',
        'operators',
        'esim_products',
        'esim_stock_batches',
        'esim_stock_items',
        'esim_orders',
        'kyc_verifications',
        'payments',
        'esim_activations',
        'processed_webhook_events',
        'agent_applications',
        'agents',
        'agent_commissions',
        'agent_payouts',
        'phone_products',
        'phone_orders',
        'support_tickets',
        'business_accounts',
        'business_members',
        'business_bulk_orders',
        'audit_logs',
        'scheduled_job_runs',
        'schema_migrations',
      ];
      return rowsResult(required.map((table_name) => ({ table_name })));
    }

    // Advisory lock
    if (sql.includes('pg_try_advisory_xact_lock')) {
      return rowsResult([{ locked: !holdAdvisoryLock }]);
    }

    // OPERATORS
    if (sql.startsWith('INSERT INTO operators')) {
      const code = String(values?.[0]);
      if (!tables.operators.has(code)) {
        tables.operators.set(code, {
          code,
          display_name: values?.[1],
          amharic_name: values?.[1],
          supply_method: values?.[2],
          integration_mode: values?.[3],
          new_esim_enabled: true,
          sim_conversion_enabled: values?.[4],
          number_selection_mode: values?.[5],
          is_enabled: values?.[6],
          kyc_required: values?.[7],
          supports_pre_payment_reservation: values?.[8],
          provisioning_status: values?.[9],
          customer_visible_note: values?.[10],
          live_authorized: values?.[11],
          updated_at: values?.[12],
        });
      }
      return emptyResult('INSERT');
    }
    if (sql.startsWith('SELECT * FROM operators ORDER BY code ASC')) {
      return rowsResult(Array.from(tables.operators.values()));
    }
    if (sql.startsWith('SELECT supply_method FROM operators WHERE code = $1')) {
      const op = tables.operators.get(String(values?.[0]));
      return op ? rowsResult([{ supply_method: op.supply_method }]) : emptyResult();
    }
    if (sql.startsWith('UPDATE operators SET')) {
      const op = tables.operators.get(String(values?.[0]));
      if (op) {
        op.is_enabled = values?.[1];
        op.integration_mode = values?.[2];
        op.supply_method = values?.[3];
        op.sim_conversion_enabled = values?.[4];
        op.supports_pre_payment_reservation = values?.[5];
        op.number_selection_mode = values?.[6];
        op.provisioning_status = values?.[7];
        op.customer_visible_note = values?.[8];
        op.live_authorized = values?.[9];
        op.updated_at = values?.[10];
        op.updated_by = values?.[11];
      }
      return emptyResult('UPDATE');
    }

    // ESIM PRODUCTS
    if (sql.startsWith('INSERT INTO esim_products')) {
      const id = String(values?.[0]);
      if (!tables.esim_products.has(id)) {
        tables.esim_products.set(id, {
          id,
          operator_code: values?.[1],
          name: values?.[2],
          name_am: values?.[3],
          service_type: values?.[4],
          summary: values?.[5],
          description_am: values?.[6],
          price_etb: values?.[7],
          sandbox_preview_amount_etb: values?.[8],
          price_label: values?.[9],
          pricing_status: values?.[10],
          enabled: values?.[11],
          requires_fayda_kyc: values?.[12],
          is_sandbox_catalog: values?.[13],
          updated_at: values?.[14],
        });
      }
      return emptyResult('INSERT');
    }
    if (sql.startsWith('SELECT * FROM esim_products ORDER BY')) {
      return rowsResult(Array.from(tables.esim_products.values()));
    }
    if (sql.startsWith('UPDATE esim_products SET enabled = $2')) {
      for (const p of tables.esim_products.values()) {
        if (p.operator_code === values?.[0] && p.service_type === 'sim_conversion') {
          p.enabled = values?.[1];
        }
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_products SET price_etb = $2')) {
      const p = tables.esim_products.get(String(values?.[0]));
      if (p) {
        p.price_etb = values?.[1];
        p.sandbox_preview_amount_etb = values?.[2];
        p.price_label = values?.[3];
        p.pricing_status = values?.[4];
        p.enabled = values?.[5];
        p.is_sandbox_catalog = values?.[6];
        p.updated_at = values?.[7];
      }
      return emptyResult('UPDATE');
    }

    // PHONE PRODUCTS & ORDERS
    if (sql.startsWith('INSERT INTO phone_products')) {
      const id = String(values?.[0]);
      const record = {
        id,
        brand: values?.[1],
        category: values?.[2],
        model: values?.[3],
        exact_model_number: values?.[4],
        regional_variant: values?.[5],
        storage: values?.[6],
        condition: values?.[7],
        warranty_summary: values?.[8],
        esim_ready: values?.[9],
        esim_capable: values?.[9],
        esim_compatibility_status: values?.[10],
        network_unlock_status: values?.[11],
        ethio_telecom_compatibility: values?.[12],
        safaricom_compatibility: values?.[13],
        compatibility_notes: values?.[14],
        compatibility_evidence: values?.[15],
        image_key: values?.[16],
        image_url: values?.[17],
        is_featured: values?.[18],
        price_etb: values?.[19],
        sandbox_preview_price_etb: values?.[20],
        price_label: values?.[21],
        pricing_status: values?.[22],
        stock_count: values?.[23],
        bulk_eligible: values?.[24],
        bulk_minimum_qty: values?.[25],
        specs: values?.[26],
        is_active: values?.[27],
        updated_at: values?.[28],
      };
      if (sql.includes('DO UPDATE')) {
        tables.phone_products.set(id, record);
        return rowsResult([record], 'INSERT');
      }
      if (!tables.phone_products.has(id)) {
        tables.phone_products.set(id, record);
      }
      return emptyResult('INSERT');
    }
    if (sql.includes('FROM phone_products WHERE id = $1')) {
      const ph = tables.phone_products.get(String(values?.[0]));
      return ph ? rowsResult([ph]) : emptyResult();
    }
    if (sql.includes('FROM phone_products')) {
      const rows = Array.from(tables.phone_products.values());
      return rowsResult(sql.includes('is_active = TRUE') ? rows.filter((r) => Boolean(r.is_active)) : rows);
    }
    if (sql.startsWith('UPDATE phone_products SET stock_count = stock_count - $2')) {
      const ph = tables.phone_products.get(String(values?.[0]));
      const qty = Number(values?.[1] ?? 0);
      if (ph && Boolean(ph.is_active) && Number(ph.stock_count ?? 0) >= qty) {
        ph.stock_count = Number(ph.stock_count ?? 0) - qty;
        return rowsResult([{ stock_count: ph.stock_count }], 'UPDATE');
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('INSERT INTO phone_orders')) {
      const row = {
        id: values?.[0],
        order_number: values?.[1],
        user_id: values?.[2],
        product_id: values?.[3],
        phone_model: values?.[4],
        order_kind: values?.[5],
        quantity: values?.[6],
        company_name: values?.[7],
        contact_phone: values?.[8],
        delivery_address_note: values?.[9],
        delivery_city: values?.[9],
        delivery_address: values?.[10],
        delivery_notes: values?.[11],
        paired_esim_operator: values?.[12],
        estimated_total_etb: values?.[13],
        is_sandbox_estimate: values?.[14],
        payment_status: values?.[15],
        payment_reference: values?.[16],
        checkout_url: values?.[17],
        delivery_partner: 'klick_pending_agreement',
        delivery_status: values?.[18],
        klick_delivery_partner_status: values?.[19],
        attributed_agent_id: values?.[20],
        created_at: values?.[21],
      };
      tables.phone_orders.set(String(row.id), row);
      return rowsResult([row], 'INSERT');
    }
    if (sql.startsWith('SELECT * FROM phone_orders WHERE id = $1')) {
      const ord = tables.phone_orders.get(String(values?.[0]));
      return ord ? rowsResult([ord]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM phone_orders')) {
      const rows = Array.from(tables.phone_orders.values());
      return rowsResult(sql.includes('WHERE user_id = $1') ? rows.filter((r) => r.user_id === values?.[0]) : rows);
    }
    if (sql.startsWith('UPDATE phone_orders')) {
      const ord = tables.phone_orders.get(String(values?.[0]));
      if (!ord) return emptyResult('UPDATE');
      if (values?.[1] !== null && values?.[1] !== undefined) ord.payment_status = values[1];
      if (values?.[2] !== null && values?.[2] !== undefined) ord.payment_reference = values[2];
      if (values?.[3] !== null && values?.[3] !== undefined) ord.checkout_url = values[3];
      if (values?.[4] !== null && values?.[4] !== undefined) ord.delivery_status = values[4];
      if (values?.[5] !== null && values?.[5] !== undefined) ord.klick_delivery_partner_status = values[5];
      return rowsResult([ord], 'UPDATE');
    }

    // STOCK BATCHES & ITEMS
    if (sql.startsWith('SELECT COUNT(*)::int AS cnt FROM esim_stock_batches')) {
      return rowsResult([{ cnt: tables.esim_stock_batches.size }]);
    }
    if (sql.startsWith('INSERT INTO esim_stock_batches')) {
      const id = String(values?.[0]);
      if (!tables.esim_stock_batches.has(id)) {
        tables.esim_stock_batches.set(id, {
          id,
          operator_code: values?.[1],
          batch_code: values?.[2],
          batch_name: values?.[3],
          total_count: values?.[4],
          available_count: values?.[5],
          source_environment: values?.[6],
          supplier_reference: values?.[7],
          imported_by: values?.[8],
          imported_at: values?.[9],
        });
      }
      return emptyResult('INSERT');
    }
    if (sql.startsWith('SELECT * FROM esim_stock_batches')) {
      return rowsResult(Array.from(tables.esim_stock_batches.values()));
    }
    if (sql.startsWith('INSERT INTO esim_stock_items')) {
      const id = String(values?.[0]);
      if (!tables.esim_stock_items.has(id)) {
        tables.esim_stock_items.set(id, {
          id,
          batch_id: values?.[1],
          operator_code: values?.[2],
          stock_identifier: values?.[3],
          msisdn: values?.[4],
          tier: values?.[5],
          encrypted_credential_payload: values?.[6],
          status: values?.[7],
          reserved_by_order_id: values?.[8],
          reserved_until: values?.[9],
          assigned_to_order_id: values?.[10],
          expires_at: values?.[11],
          eid: values?.[12],
          external_inventory_ref: values?.[13],
          inventory_type: values?.[14],
          source_environment: values?.[15],
          imported_at: values?.[16],
          audit_history: JSON.parse(String(values?.[17] ?? '[]')),
          created_at: values?.[18],
        });
      }
      return emptyResult('INSERT');
    }
    if (sql.startsWith('SELECT encrypted_credential_payload FROM esim_stock_items WHERE id = $1')) {
      const item = tables.esim_stock_items.get(String(values?.[0]));
      return item ? rowsResult([{ encrypted_credential_payload: item.encrypted_credential_payload }]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM esim_stock_items') && !sql.includes('FOR UPDATE')) {
      let rows = Array.from(tables.esim_stock_items.values());
      if (sql.includes('operator_code = $1') && values?.[0]) {
        rows = rows.filter((r) => r.operator_code === values[0]);
      }
      if (sql.includes('status = $1') && values?.[0]) {
        rows = rows.filter((r) => r.status === values[0]);
      } else if (sql.includes('status = $2') && values?.[1]) {
        rows = rows.filter((r) => r.status === values[1]);
      }
      return rowsResult(rows);
    }
    if (sql.startsWith('SELECT id FROM esim_stock_items') && sql.includes('FOR UPDATE SKIP LOCKED')) {
      const operatorCode = sql.includes('id = $1') ? String(values?.[1]) : String(values?.[0]);
      const idFilter = sql.includes('id = $1') ? String(values?.[0]) : null;
      const found = Array.from(tables.esim_stock_items.values()).find(
        (i) =>
          i.operator_code === operatorCode &&
          i.status === 'available' &&
          (!idFilter || i.id === idFilter) &&
          !lockedStockIds.has(String(i.id)),
      );
      if (!found) return emptyResult();
      lockedStockIds.add(String(found.id));
      return rowsResult([{ id: found.id }]);
    }
    if (sql.startsWith('SELECT * FROM esim_stock_items') && sql.includes('FOR UPDATE SKIP LOCKED')) {
      let candidate: Record<string, unknown> | undefined;
      if (sql.includes('WHERE id = $1')) {
        const id = String(values?.[0]);
        const op = String(values?.[1]);
        const item = tables.esim_stock_items.get(id);
        if (item && item.operator_code === op && item.status === 'available' && !lockedStockIds.has(id)) {
          candidate = item;
        }
      } else if (sql.includes('tier = $2')) {
        const op = String(values?.[0]);
        const tier = String(values?.[1]);
        candidate = Array.from(tables.esim_stock_items.values()).find(
          (i) => i.operator_code === op && i.status === 'available' && i.tier === tier && !lockedStockIds.has(String(i.id)),
        );
      } else {
        const op = String(values?.[0]);
        candidate = Array.from(tables.esim_stock_items.values()).find(
          (i) => i.operator_code === op && i.status === 'available' && !lockedStockIds.has(String(i.id)),
        );
      }
      if (!candidate) return emptyResult();
      lockedStockIds.add(String(candidate.id));
      return rowsResult([candidate]);
    }
    if (sql.startsWith('SELECT id, operator_code, status FROM esim_stock_items WHERE id = $1')) {
      const item = tables.esim_stock_items.get(String(values?.[0]));
      return item ? rowsResult([{ id: item.id, operator_code: item.operator_code, status: item.status }]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM esim_stock_items WHERE id = $1')) {
      const item = tables.esim_stock_items.get(String(values?.[0]));
      if (!item) return emptyResult();
      if (sql.includes("status = 'available' OR") && values?.[1]) {
        const ok = item.status === 'available' || (item.status === 'reserved' && item.reserved_by_order_id === values[1]);
        return ok ? rowsResult([item]) : emptyResult();
      }
      return rowsResult([item]);
    }
    if (sql.startsWith('SELECT stock_identifier FROM esim_stock_items')) {
      const arr = Array.isArray(values?.[0]) ? (values[0] as string[]) : [];
      const set = new Set(arr);
      return rowsResult(
        Array.from(tables.esim_stock_items.values())
          .filter((i) => set.has(String(i.stock_identifier)))
          .map((i) => ({ stock_identifier: i.stock_identifier })),
      );
    }
    if (sql.startsWith('SELECT msisdn FROM esim_stock_items')) {
      const arr = Array.isArray(values?.[0]) ? (values[0] as string[]) : [];
      const set = new Set(arr);
      return rowsResult(
        Array.from(tables.esim_stock_items.values())
          .filter((i) => i.msisdn && set.has(String(i.msisdn)) && ['imported', 'available', 'reserved', 'assigned', 'sold'].includes(String(i.status)))
          .map((i) => ({ msisdn: i.msisdn })),
      );
    }
    if (sql.startsWith("UPDATE esim_stock_items SET status = 'reserved'")) {
      const item = tables.esim_stock_items.get(String(values?.[0]));
      if (item) {
        item.status = 'reserved';
        item.reserved_by_order_id = values?.[1];
        if (values?.[2] && sql.includes('reserved_until')) {
          item.reserved_until = values[2];
        }
        if (values?.[3]) {
          item.audit_history = [...((item.audit_history as unknown[]) ?? []), ...JSON.parse(String(values[3]))];
        }
      }
      return item ? rowsResult([item], 'UPDATE') : emptyResult('UPDATE');
    }
    if (sql.startsWith("UPDATE esim_stock_items SET status = 'assigned'")) {
      const item = tables.esim_stock_items.get(String(values?.[0]));
      if (item) {
        item.status = 'assigned';
        item.assigned_to_order_id = values?.[1];
        item.reserved_until = null;
        if (values?.[2]) {
          item.audit_history = [...((item.audit_history as unknown[]) ?? []), ...JSON.parse(String(values[2]))];
        }
      }
      return item ? rowsResult([{ batch_id: item.batch_id }], 'UPDATE') : emptyResult('UPDATE');
    }
    if (sql.startsWith("UPDATE esim_stock_items SET status = 'available'")) {
      if (sql.includes('WHERE id = $1 AND reserved_by_order_id = $2')) {
        const item = tables.esim_stock_items.get(String(values?.[0]));
        if (item && item.reserved_by_order_id === values?.[1] && item.status === 'reserved') {
          item.status = 'available';
          item.reserved_by_order_id = null;
          item.reserved_until = null;
          return rowsResult([{ batch_id: item.batch_id }], 'UPDATE');
        }
        return emptyResult('UPDATE');
      }
      if (sql.includes('reserved_until <= $1')) {
        const nowMs = new Date(String(values?.[0])).getTime();
        const released: Record<string, unknown>[] = [];
        for (const item of tables.esim_stock_items.values()) {
          if (item.status === 'reserved' && item.reserved_until && new Date(String(item.reserved_until)).getTime() <= nowMs) {
            const prevOrder = item.reserved_by_order_id;
            item.status = 'available';
            item.reserved_by_order_id = null;
            item.reserved_until = null;
            released.push({ id: item.id, batch_id: item.batch_id, reserved_by_order_id: prevOrder });
          }
        }
        return rowsResult(released, 'UPDATE');
      }
    }
    if (sql.startsWith('UPDATE esim_stock_items SET status = $2')) {
      const item = tables.esim_stock_items.get(String(values?.[0]));
      if (item) {
        item.status = values?.[1];
        if (values?.[1] === 'available') {
          item.reserved_by_order_id = null;
          item.reserved_until = null;
        }
        if (values?.[2]) {
          item.audit_history = JSON.parse(String(values[2]));
        }
        return rowsResult([item], 'UPDATE');
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_stock_items SET status = \'expired\'')) {
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_stock_batches SET')) {
      const batch = tables.esim_stock_batches.get(String(values?.[0]));
      if (batch) {
        const items = Array.from(tables.esim_stock_items.values()).filter((i) => i.batch_id === batch.id);
        batch.total_count = items.length;
        batch.available_count = items.filter((i) => i.status === 'available').length;
      }
      return emptyResult('UPDATE');
    }

    // USERS & STAFF
    if (sql.startsWith('SELECT * FROM users WHERE uid = $1')) {
      const u = tables.users.get(String(values?.[0]));
      return u ? rowsResult([u]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM users WHERE LOWER(email)') || sql.startsWith('SELECT uid, email, display_name FROM users WHERE LOWER(email)')) {
      const email = String(values?.[0]).toLowerCase();
      const u = Array.from(tables.users.values()).find((x) => String(x.email ?? '').toLowerCase() === email);
      return u ? rowsResult([u]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM users ORDER BY')) {
      return rowsResult(Array.from(tables.users.values()));
    }
    if (sql.startsWith('INSERT INTO users')) {
      const uid = String(values?.[0]);
      const existing = tables.users.get(uid);
      const row = {
        uid,
        email: values?.[1] ?? existing?.email ?? null,
        phone_number: existing?.phone_number ?? values?.[2] ?? null,
        display_name: values?.[3] ?? existing?.display_name ?? null,
        email_verified: values?.[4],
        preferred_language: existing?.preferred_language ?? values?.[5],
        account_status: existing?.account_status ?? values?.[6],
        suspended_reason: existing?.suspended_reason ?? values?.[7] ?? null,
        created_at: existing?.created_at ?? values?.[8],
        last_seen_at: values?.[9],
      };
      tables.users.set(uid, row);
      return rowsResult([row], 'INSERT');
    }
    if (sql.startsWith('UPDATE users SET account_status = $2')) {
      const u = tables.users.get(String(values?.[0]));
      if (u) {
        u.account_status = values?.[1];
        u.suspended_reason = values?.[2];
        return rowsResult([u], 'UPDATE');
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE users SET display_name = $2')) {
      const u = tables.users.get(String(values?.[0]));
      if (u) {
        u.display_name = values?.[1];
        u.preferred_language = values?.[2];
        u.phone_number = values?.[3];
        return rowsResult([u], 'UPDATE');
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('SELECT * FROM staff_admins WHERE uid = $1')) {
      const a = tables.staff_admins.get(String(values?.[0]));
      if (!a) return emptyResult();
      if (sql.includes('active = TRUE') && !a.active) return emptyResult();
      return rowsResult([a]);
    }
    if (sql.startsWith('SELECT * FROM staff_admins ORDER BY')) {
      return rowsResult(Array.from(tables.staff_admins.values()));
    }
    if (sql.startsWith('SELECT COUNT(*)::int AS cnt FROM staff_admins')) {
      const cnt = Array.from(tables.staff_admins.values()).filter((a) => Boolean(a.active) && a.role === 'super_admin').length;
      return rowsResult([{ cnt }]);
    }
    if (sql.startsWith('INSERT INTO staff_admins')) {
      const uid = String(values?.[0]);
      if (!tables.staff_admins.has(uid) || sql.includes('DO UPDATE')) {
        tables.staff_admins.set(uid, {
          uid,
          email: values?.[1],
          display_name: values?.[2],
          role: values?.[3],
          source: values?.[4] ?? 'admin_grant',
          active: values?.[5] ?? true,
          granted_at: values?.[6] ?? new Date().toISOString(),
        });
      }
      return emptyResult('INSERT');
    }
    if (sql.startsWith('UPDATE staff_admins SET role = $2')) {
      const a = tables.staff_admins.get(String(values?.[0]));
      if (a) {
        a.role = values?.[1];
        a.active = values?.[2];
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('INSERT INTO staff_admin_invites')) {
      const email = String(values?.[0]).toLowerCase();
      tables.staff_admin_invites.set(email, {
        email: values?.[0],
        display_name: values?.[1],
        role: values?.[2],
        active: true,
        granted_by: values?.[3],
        granted_at: values?.[4],
      });
      return emptyResult('INSERT');
    }
    if (sql.startsWith('DELETE FROM staff_admin_invites')) {
      tables.staff_admin_invites.delete(String(values?.[0]).toLowerCase());
      return emptyResult('DELETE');
    }
    if (sql.startsWith('SELECT * FROM staff_admin_invites')) {
      if (sql.includes('LOWER(email)')) {
        const email = String(values?.[0]).toLowerCase();
        const inv = tables.staff_admin_invites.get(email);
        return inv ? rowsResult([inv]) : emptyResult();
      }
      return rowsResult(Array.from(tables.staff_admin_invites.values()));
    }

    // ORDERS
    if (sql.startsWith('SELECT * FROM esim_orders WHERE user_id = $1 AND idempotency_key')) {
      const found = Array.from(tables.esim_orders.values()).find(
        (o) =>
          o.user_id === values?.[0] &&
          o.idempotency_key === values?.[1] &&
          !['cancelled', 'expired', 'failed', 'refunded'].includes(String(o.status)),
      );
      return found ? rowsResult([found]) : emptyResult();
    }
    if (sql.startsWith('SELECT selected_msisdn FROM esim_orders WHERE operator_code = $1') || sql.startsWith('SELECT * FROM esim_orders WHERE operator_code = $1 AND selected_msisdn IS NOT NULL')) {
      return rowsResult(
        Array.from(tables.esim_orders.values())
          .filter(
            (o) =>
              o.operator_code === values?.[0] &&
              o.selected_msisdn &&
              !['cancelled', 'expired', 'failed', 'refunded'].includes(String(o.status)) &&
              (!values?.[1] || o.id !== values[1]),
          )
          .map((o) => ({ selected_msisdn: o.selected_msisdn })),
      );
    }
    if (sql.startsWith('SELECT status, update_history FROM esim_orders WHERE id = $1') || sql.startsWith('SELECT update_history FROM esim_orders WHERE id = $1') || sql.startsWith('SELECT payment_status, update_history FROM esim_orders WHERE id = $1')) {
      const o = tables.esim_orders.get(String(values?.[0]));
      return o ? rowsResult([{ status: o.status, payment_status: o.payment_status, update_history: o.update_history }]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM esim_orders WHERE id = $1')) {
      const o = tables.esim_orders.get(String(values?.[0]));
      return o ? rowsResult([o]) : emptyResult();
    }
    if (sql.startsWith('SELECT id, order_number, operator_code, status, created_at FROM esim_orders WHERE attributed_agent_id = $1')) {
      return rowsResult(Array.from(tables.esim_orders.values()).filter((o) => o.attributed_agent_id === values?.[0]));
    }
    if (sql.startsWith('SELECT * FROM esim_orders WHERE user_id = $1 ORDER BY')) {
      return rowsResult(Array.from(tables.esim_orders.values()).filter((o) => o.user_id === values?.[0]));
    }
    if (sql.startsWith('SELECT * FROM esim_orders ORDER BY')) {
      return rowsResult(Array.from(tables.esim_orders.values()));
    }
    if (sql.startsWith('INSERT INTO esim_orders')) {
      const row = {
        id: values?.[0],
        order_number: values?.[1],
        idempotency_key: values?.[2],
        user_id: values?.[3],
        operator_code: values?.[4],
        product_id: values?.[5],
        service_type: values?.[6],
        selected_msisdn: values?.[7],
        existing_msisdn: values?.[8],
        device_model: values?.[9],
        device_os: values?.[10],
        device_esim_confirmed: values?.[11],
        subscriber_full_name: values?.[12],
        subscriber_contact_phone: values?.[13],
        selected_number_tier: values?.[14],
        reserved_until: values?.[15],
        number_reservation_confirmed: values?.[16],
        status: values?.[17],
        identity_status: values?.[18],
        payment_status: values?.[19],
        provisioning_status: values?.[20],
        delivery_status: values?.[21],
        amount_etb: values?.[22],
        currency: values?.[23],
        pricing_snapshot_note: values?.[24],
        is_sandbox_pricing: values?.[25],
        fulfillment_method: values?.[26],
        stock_item_id: values?.[27],
        operator_order_ref: values?.[28],
        attributed_agent_id: values?.[29],
        agent_referral_code: values?.[30],
        failure_reason: values?.[31],
        update_history: JSON.parse(String(values?.[32] ?? '[]')),
        created_at: values?.[33],
        updated_at: values?.[34],
      };
      tables.esim_orders.set(String(row.id), row);
      return rowsResult([row], 'INSERT');
    }
    if (sql.startsWith('UPDATE esim_orders SET identity_status = $2')) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.identity_status = values?.[1];
        o.status = values?.[2];
        o.failure_reason = values?.[3];
        o.subscriber_full_name = values?.[4];
        o.subscriber_contact_phone = values?.[5];
        o.update_history = JSON.parse(String(values?.[6] ?? '[]'));
        o.updated_at = values?.[7];
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith("UPDATE esim_orders SET fulfillment_method = 'stock_based'")) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.fulfillment_method = 'stock_based';
        o.stock_item_id = values?.[1];
        o.selected_msisdn = values?.[2];
        o.selected_number_tier = values?.[3];
        o.reserved_until = values?.[4];
        o.number_reservation_confirmed = true;
        o.status = 'number_reserved';
        o.update_history = JSON.parse(String(values?.[5] ?? '[]'));
        o.updated_at = values?.[6];
      }
      return o ? rowsResult([o], 'UPDATE') : emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_orders SET stock_item_id = NULL, selected_number_tier = $2')) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.stock_item_id = null;
        o.selected_number_tier = values?.[1];
        o.selected_msisdn = values?.[2];
        o.number_reservation_confirmed = values?.[3];
        o.reserved_until = values?.[4];
        o.status = 'number_reserved';
        o.update_history = JSON.parse(String(values?.[5] ?? '[]'));
        o.updated_at = values?.[6];
      }
      return o ? rowsResult([o], 'UPDATE') : emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_orders SET stock_item_id = NULL, payment_status = $2')) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.stock_item_id = null;
        o.payment_status = values?.[1];
        o.status = values?.[2];
        o.failure_reason = values?.[3];
        o.update_history = JSON.parse(String(values?.[4] ?? '[]'));
        o.updated_at = values?.[5];
      }
      return o ? rowsResult([o], 'UPDATE') : emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_orders SET selected_msisdn = COALESCE($2, selected_msisdn)')) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.selected_msisdn = values?.[1] ?? o.selected_msisdn;
        o.fulfillment_method = values?.[2];
        o.operator_order_ref = values?.[3];
        o.provisioning_status = 'provisioned';
        o.delivery_status = 'delivered';
        o.status = 'ready_for_installation';
        o.failure_reason = null;
        o.update_history = JSON.parse(String(values?.[4] ?? '[]'));
        o.updated_at = values?.[5];
      }
      return o ? rowsResult([o], 'UPDATE') : emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_orders SET status = $2, provisioning_status = $3')) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.status = values?.[1];
        o.provisioning_status = values?.[2];
        o.operator_order_ref = values?.[3] ?? o.operator_order_ref;
        o.fulfillment_method = values?.[4];
        o.failure_reason = values?.[5];
        if (values?.[6] !== null && values?.[6] !== undefined) o.stock_item_id = null;
        o.payment_status = values?.[7];
        o.update_history = JSON.parse(String(values?.[8] ?? '[]'));
        o.updated_at = values?.[9];
      }
      return o ? rowsResult([o], 'UPDATE') : emptyResult('UPDATE');
    }
    if (sql.startsWith("UPDATE esim_orders SET payment_status = 'verified'")) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.payment_status = 'verified';
        o.status = 'payment_verified';
        if (sql.includes('provisioning_status')) {
          o.provisioning_status = 'submitted_to_operator';
          o.fulfillment_method = values?.[1];
          o.stock_item_id = values?.[2];
          o.failure_reason = null;
          o.update_history = JSON.parse(String(values?.[3] ?? '[]'));
          o.updated_at = values?.[4];
        } else {
          o.update_history = JSON.parse(String(values?.[1] ?? '[]'));
          o.updated_at = values?.[2];
        }
      }
      return o ? rowsResult([o], 'UPDATE') : emptyResult('UPDATE');
    }
    if (sql.startsWith("UPDATE esim_orders SET payment_status = 'failed', status = 'awaiting_payment'")) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.payment_status = 'failed';
        o.status = 'awaiting_payment';
        o.failure_reason = values?.[1];
        o.update_history = JSON.parse(String(values?.[2] ?? '[]'));
        o.updated_at = values?.[3];
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith("UPDATE esim_orders SET payment_status = 'failed', status = 'expired'")) {
      const ids = Array.isArray(values?.[0]) ? (values[0] as string[]) : [];
      const out: Record<string, unknown>[] = [];
      for (const id of ids) {
        const o = tables.esim_orders.get(id);
        if (o && o.payment_status !== 'verified' && !['cancelled', 'expired', 'refunded'].includes(String(o.status))) {
          o.payment_status = 'failed';
          o.status = 'expired';
          o.failure_reason = values?.[1];
          o.reserved_until = null;
          o.number_reservation_confirmed = false;
          o.update_history = [...((o.update_history as unknown[]) ?? []), ...JSON.parse(String(values?.[2] ?? '[]'))];
          o.updated_at = values?.[3];
          out.push({ id: o.id, stock_item_id: o.stock_item_id });
        }
      }
      return rowsResult(out, 'UPDATE');
    }
    if (sql.startsWith("UPDATE esim_orders SET payment_status = 'refunded'")) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.payment_status = 'refunded';
        o.status = 'refunded';
        o.update_history = JSON.parse(String(values?.[1] ?? '[]'));
        o.updated_at = values?.[2];
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_orders SET payment_status = $2, status = $3')) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.payment_status = values?.[1];
        o.status = values?.[2];
        if (sql.includes('failure_reason')) {
          o.failure_reason = values?.[3];
          o.update_history = JSON.parse(String(values?.[4] ?? '[]'));
          o.updated_at = values?.[5];
        } else {
          o.update_history = JSON.parse(String(values?.[3] ?? '[]'));
          o.updated_at = values?.[4];
        }
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_orders SET delivery_status = $2, status = $2')) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) {
        o.delivery_status = values?.[1];
        o.status = values?.[1];
        o.update_history = JSON.parse(String(values?.[2] ?? '[]'));
        o.updated_at = values?.[3];
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_orders SET stock_item_id = NULL, reserved_until = NULL')) {
      const itemIds = new Set(Array.isArray(values?.[0]) ? (values[0] as string[]) : []);
      const out: Record<string, unknown>[] = [];
      for (const o of tables.esim_orders.values()) {
        if (o.stock_item_id && itemIds.has(String(o.stock_item_id))) {
          o.stock_item_id = null;
          o.reserved_until = null;
          o.number_reservation_confirmed = false;
          o.status = 'expired';
          o.failure_reason = 'Number reservation expired before checkout verification.';
          out.push({ id: o.id });
        }
      }
      return rowsResult(out, 'UPDATE');
    }
    if (sql.startsWith('UPDATE esim_orders SET stock_item_id = NULL WHERE id = $1')) {
      const o = tables.esim_orders.get(String(values?.[0]));
      if (o) o.stock_item_id = null;
      return emptyResult('UPDATE');
    }

    // KYC
    if (sql.startsWith('INSERT INTO kyc_verifications')) {
      const row = {
        id: values?.[0],
        order_id: values?.[1],
        user_id: values?.[2],
        operator_code: values?.[3],
        full_name: values?.[4],
        contact_phone: values?.[5],
        status: values?.[6],
        verification_mode: values?.[7],
        verification_reference: values?.[8],
        consent_given: values?.[9],
        failure_reason: values?.[10],
        verified_at: values?.[11],
        created_at: values?.[11],
      };
      tables.kyc_verifications.set(String(row.id), row);
      return emptyResult('INSERT');
    }
    if (sql.startsWith('SELECT * FROM kyc_verifications WHERE order_id = $1')) {
      const rows = Array.from(tables.kyc_verifications.values()).filter((k) => k.order_id === values?.[0]);
      return rowsResult(rows.slice(-1));
    }

    // PAYMENTS & WEBHOOK DEDUP
    if (sql.startsWith('SELECT * FROM payments WHERE order_id = $1 AND idempotency_key = $2')) {
      const p = Array.from(tables.payments.values()).find(
        (x) => x.order_id === values?.[0] && x.idempotency_key === values?.[1],
      );
      return p ? rowsResult([p]) : emptyResult();
    }
    if (sql.startsWith("SELECT * FROM payments WHERE order_id = $1 AND status = 'verified'")) {
      const p = Array.from(tables.payments.values()).find(
        (x) => x.order_id === values?.[0] && x.status === 'verified',
      );
      return p ? rowsResult([p]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM payments WHERE order_id = $1 ORDER BY')) {
      const list = Array.from(tables.payments.values()).filter((x) => x.order_id === values?.[0]);
      return list.length > 0 ? rowsResult([list[list.length - 1]]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM payments WHERE order_id = $1 AND tx_ref = $2') || sql.startsWith('SELECT * FROM payments WHERE tx_ref = $1 AND order_id = $2')) {
      const isTxFirst = sql.startsWith('SELECT * FROM payments WHERE tx_ref = $1');
      const txRefVal = isTxFirst ? values?.[0] : values?.[1];
      const orderIdVal = isTxFirst ? values?.[1] : values?.[0];
      const p = Array.from(tables.payments.values()).find(
        (x) => x.order_id === orderIdVal && x.tx_ref === txRefVal,
      );
      return p ? rowsResult([p]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM payments WHERE tx_ref = $1')) {
      const p = Array.from(tables.payments.values()).find((x) => x.tx_ref === values?.[0]);
      return p ? rowsResult([p]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM payments WHERE id = $1') || sql.startsWith('SELECT status FROM payments WHERE id = $1')) {
      const p = tables.payments.get(String(values?.[0]));
      return p ? rowsResult([p]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM payments ORDER BY')) {
      return rowsResult(Array.from(tables.payments.values()));
    }
    if (sql.startsWith('INSERT INTO payments')) {
      const row = {
        id: values?.[0],
        order_type: values?.[1],
        order_id: values?.[2],
        user_id: values?.[3],
        tx_ref: values?.[4],
        idempotency_key: values?.[5],
        chapa_reference: values?.[6],
        amount_etb: values?.[7],
        currency: values?.[8],
        checkout_url: values?.[9],
        status: values?.[10],
        mode: values?.[11],
        verified_via: values?.[12],
        webhook_event_count: values?.[13],
        failure_reason: values?.[14],
        refund_reason: values?.[15],
        refund_reference: values?.[16],
        refund_status_checked_at: values?.[17],
        reconciled_at: values?.[18],
        created_at: values?.[19],
        updated_at: values?.[20],
      };
      tables.payments.set(String(row.id), row);
      return emptyResult('INSERT');
    }
    if (sql.startsWith("UPDATE payments SET status = 'verified'")) {
      const p = tables.payments.get(String(values?.[0]));
      if (p) {
        p.status = 'verified';
        p.chapa_reference = values?.[1];
        p.verified_via = values?.[2];
        p.webhook_event_count = Number(p.webhook_event_count ?? 0) + Number(values?.[3] ?? 0);
        p.failure_reason = null;
        p.verified_at = p.verified_at ?? values?.[4];
        p.updated_at = values?.[4];
      }
      return p ? rowsResult([p], 'UPDATE') : emptyResult('UPDATE');
    }
    if (sql.startsWith("UPDATE payments SET status = 'refund_pending'")) {
      const out: Record<string, unknown>[] = [];
      for (const p of tables.payments.values()) {
        if (p.order_id === values?.[0] && p.status === 'verified') {
          p.status = 'refund_pending';
          p.refund_reason = values?.[1];
          p.updated_at = values?.[2];
          out.push({ id: p.id });
        }
      }
      return rowsResult(out, 'UPDATE');
    }
    if (sql.startsWith("UPDATE payments SET status = 'failed'")) {
      if (sql.includes('WHERE id = $1')) {
        const p = tables.payments.get(String(values?.[0]));
        if (p) {
          p.status = 'failed';
          p.failure_reason = values?.[1];
          p.updated_at = values?.[2];
          return rowsResult([p], 'UPDATE');
        }
        return emptyResult('UPDATE');
      }
      const cutoffMs = new Date(String(values?.[0])).getTime();
      const out: Record<string, unknown>[] = [];
      for (const p of tables.payments.values()) {
        if (p.status === 'initialized' && new Date(String(p.created_at)).getTime() <= cutoffMs) {
          p.status = 'failed';
          p.failure_reason = values?.[1];
          p.updated_at = values?.[2];
          out.push({ id: p.id, order_id: p.order_id });
        }
      }
      return rowsResult(out, 'UPDATE');
    }
    if (sql.startsWith('UPDATE payments SET status = $2, refund_reason = $3')) {
      const p = tables.payments.get(String(values?.[0]));
      if (p) {
        p.status = values?.[1];
        p.refund_reason = values?.[2];
        p.refund_reference = values?.[3] ?? p.refund_reference;
        p.refund_status_checked_at = values?.[4];
        p.updated_at = values?.[4];
        return rowsResult([p], 'UPDATE');
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE payments SET status = $2, chapa_reference = $3')) {
      const p = tables.payments.get(String(values?.[0]));
      if (p) {
        p.status = values?.[1];
        p.chapa_reference = values?.[2];
        p.verified_via = values?.[3];
        p.reconciled_at = values?.[4];
        p.refund_status_checked_at = values?.[5];
        p.refund_reference = values?.[6];
        p.failure_reason = values?.[7];
        p.updated_at = values?.[8];
        return rowsResult([p], 'UPDATE');
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE payments SET status = $2, failure_reason = $3')) {
      const p = tables.payments.get(String(values?.[0]));
      if (p) {
        p.status = values?.[1];
        p.failure_reason = values?.[2];
        p.webhook_event_count = Number(p.webhook_event_count ?? 0) + 1;
        p.updated_at = values?.[3];
        return rowsResult([p], 'UPDATE');
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE payments SET webhook_event_count')) {
      const p = tables.payments.get(String(values?.[0]));
      if (p) p.webhook_event_count = Number(p.webhook_event_count ?? 0) + 1;
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('INSERT INTO processed_webhook_events')) {
      const evtId = String(values?.[0]);
      if (tables.processed_webhook_events.has(evtId)) {
        return emptyResult('INSERT');
      }
      tables.processed_webhook_events.set(evtId, {
        event_id: evtId,
        provider: values?.[1],
        tx_ref: values?.[2],
        order_id: values?.[3],
        event_status: values?.[4],
      });
      return rowsResult([{ event_id: evtId }], 'INSERT');
    }
    if (sql.startsWith('SELECT 1 FROM processed_webhook_events')) {
      return tables.processed_webhook_events.has(String(values?.[0])) ? rowsResult([{ '?column?': 1 }]) : emptyResult();
    }

    // ACTIVATIONS & ESIMS
    if (sql.startsWith('SELECT * FROM esim_activations WHERE order_id = $1')) {
      const a = Array.from(tables.esim_activations.values()).find((x) => x.order_id === values?.[0]);
      return a ? rowsResult([a]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM esim_activations WHERE id = ANY($1)')) {
      const candidates = new Set(Array.isArray(values?.[0]) ? (values[0] as string[]) : []);
      const userIdFilter = sql.includes('AND user_id = $2') ? String(values?.[1]) : null;
      const a = Array.from(tables.esim_activations.values()).find(
        (x) => candidates.has(String(x.id)) && (!userIdFilter || x.user_id === userIdFilter),
      );
      return a ? rowsResult([a]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM esim_activations WHERE user_id = $1')) {
      return rowsResult(Array.from(tables.esim_activations.values()).filter((x) => x.user_id === values?.[0]));
    }
    if (sql.startsWith('SELECT * FROM esim_activations ORDER BY')) {
      return rowsResult(Array.from(tables.esim_activations.values()));
    }
    if (sql.startsWith('INSERT INTO esim_activations')) {
      const row = {
        id: values?.[0],
        order_id: values?.[1],
        user_id: values?.[2],
        operator_code: values?.[3],
        msisdn: values?.[4],
        iccid_masked: values?.[5],
        encrypted_activation_payload: values?.[6],
        activation_status: values?.[7],
        fulfillment_method: values?.[8],
        is_sandbox_profile: values?.[9],
        device_model: values?.[10],
        eid: values?.[11],
        provisioned_at: values?.[12],
      };
      tables.esim_activations.set(String(row.id), row);
      return rowsResult([row], 'INSERT');
    }
    if (sql.startsWith('UPDATE esim_activations SET downloaded_at')) {
      const a = tables.esim_activations.get(String(values?.[0]));
      if (a && !a.downloaded_at) a.downloaded_at = new Date().toISOString();
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('UPDATE esim_activations SET activation_status = $2')) {
      const a = tables.esim_activations.get(String(values?.[0]));
      if (a) {
        a.activation_status = values?.[1];
        a.installed_at = a.installed_at ?? values?.[2];
        if (values?.[3] === 'activated') a.activated_at = values?.[2];
        return rowsResult([a], 'UPDATE');
      }
      return emptyResult('UPDATE');
    }

    // AGENTS & COMMISSIONS & PAYOUTS
    if (sql.startsWith('INSERT INTO agent_applications')) {
      const row = {
        id: values?.[0],
        user_id: values?.[1],
        applicant_name: values?.[2],
        email: values?.[3],
        contact_phone: values?.[4],
        business_or_individual: values?.[5],
        business_name: values?.[6],
        applicant_type: values?.[7],
        city_region: values?.[8],
        experience_summary: values?.[9],
        experience_note: values?.[9],
        status: values?.[10],
        submitted_at: values?.[11],
      };
      tables.agent_applications.set(String(row.id), row);
      return rowsResult([row], 'INSERT');
    }
    if (sql.startsWith('SELECT * FROM agent_applications WHERE user_id = $1')) {
      const list = Array.from(tables.agent_applications.values()).filter((a) => a.user_id === values?.[0]);
      return list.length > 0 ? rowsResult([list[list.length - 1]]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM agent_applications WHERE id = $1')) {
      const app = tables.agent_applications.get(String(values?.[0]));
      return app ? rowsResult([app]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM agent_applications ORDER BY')) {
      return rowsResult(Array.from(tables.agent_applications.values()));
    }
    if (sql.startsWith('UPDATE agent_applications SET status = $2')) {
      const app = tables.agent_applications.get(String(values?.[0]));
      if (app) {
        app.status = values?.[1];
        app.review_notes = values?.[2];
        app.review_note = values?.[2];
        app.reviewed_by = values?.[3];
        app.reviewed_at = values?.[4];
        return rowsResult([app], 'UPDATE');
      }
      return emptyResult('UPDATE');
    }
    if (sql.startsWith('INSERT INTO agents')) {
      const row = {
        id: values?.[0],
        user_id: values?.[1],
        application_id: values?.[2],
        display_name: values?.[3],
        email: values?.[4],
        referral_code: values?.[5],
        status: 'approved',
        ethio_telecom_authorized: values?.[6],
        safaricom_authorized: values?.[7],
        total_attributed_orders: 0,
        total_earned_commission_etb: 0,
        total_paid_out_etb: 0,
        created_at: values?.[8],
      };
      tables.agents.set(String(row.id), row);
      return rowsResult([row], 'INSERT');
    }
    if (sql.startsWith('SELECT * FROM agents WHERE user_id = $1')) {
      const ag = Array.from(tables.agents.values()).find(
        (a) => a.user_id === values?.[0] && (!sql.includes("status = 'approved'") || a.status === 'approved'),
      );
      return ag ? rowsResult([ag]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM agents WHERE UPPER(referral_code)')) {
      const code = String(values?.[0]).toUpperCase();
      const ag = Array.from(tables.agents.values()).find(
        (a) => String(a.referral_code).toUpperCase() === code && a.status === 'approved',
      );
      return ag ? rowsResult([ag]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM agents WHERE id = $1') || sql.startsWith('SELECT id FROM agents WHERE id = $1')) {
      const ag = tables.agents.get(String(values?.[0]));
      return ag ? rowsResult([ag]) : emptyResult();
    }
    if (sql.startsWith('SELECT * FROM agents ORDER BY')) {
      return rowsResult(Array.from(tables.agents.values()));
    }
    if (sql.startsWith('INSERT INTO agent_commissions')) {
      const row = {
        id: values?.[0],
        agent_id: values?.[1],
        order_id: values?.[2],
        order_number: values?.[3],
        operator_code: values?.[4],
        commission_amount_etb: values?.[5],
        pricing_status: values?.[6],
        commercial_term_note: values?.[7],
        status: values?.[8],
        created_at: values?.[9],
      };
      tables.agent_commissions.set(String(row.id), row);
      return rowsResult([{ id: row.id }], 'INSERT');
    }
    if (sql.startsWith('SELECT * FROM agent_commissions WHERE agent_id = $1')) {
      return rowsResult(Array.from(tables.agent_commissions.values()).filter((c) => c.agent_id === values?.[0]));
    }
    if (sql.startsWith('UPDATE agents SET total_attributed_orders')) {
      const ag = tables.agents.get(String(values?.[0]));
      if (ag) ag.total_attributed_orders = Number(ag.total_attributed_orders ?? 0) + 1;
      return emptyResult('UPDATE');
    }

    // SUPPORT TICKETS, AUDIT LOGS, SCHEDULED JOBS
    if (sql.startsWith('INSERT INTO support_tickets')) {
      const row = {
        id: values?.[0],
        user_id: values?.[1],
        contact_email: values?.[2],
        related_order_id: values?.[3],
        subject: values?.[4],
        category: values?.[5],
        message: values?.[6],
        status: values?.[7],
        admin_response: values?.[8],
        created_at: values?.[9],
      };
      tables.support_tickets.set(String(row.id), row);
      return rowsResult([row], 'INSERT');
    }
    if (sql.startsWith('SELECT * FROM support_tickets')) {
      const rows = Array.from(tables.support_tickets.values());
      return rowsResult(sql.includes('WHERE user_id = $1') ? rows.filter((t) => t.user_id === values?.[0]) : rows);
    }
    if (sql.startsWith('INSERT INTO audit_logs')) {
      tables.audit_logs.unshift({
        id: values?.[0],
        actor_type: values?.[1],
        actor_id: values?.[2],
        actor_email: values?.[3],
        action: values?.[4],
        target_type: values?.[5],
        target_id: values?.[6],
        reason: values?.[7],
        created_at: values?.[8],
      });
      return emptyResult('INSERT');
    }
    if (sql.startsWith('SELECT * FROM audit_logs WHERE target_id = $1')) {
      return rowsResult(tables.audit_logs.filter((a) => a.target_id === values?.[0]).slice(0, 50));
    }
    if (sql.startsWith('SELECT * FROM audit_logs ORDER BY')) {
      const limit = Number(values?.[0] ?? 100);
      return rowsResult(tables.audit_logs.slice(0, limit));
    }
    if (sql.startsWith('INSERT INTO scheduled_job_runs')) {
      tables.scheduled_job_runs.unshift({
        id: values?.[0],
        job_name: values?.[1],
        instance_id: values?.[2],
        status: 'succeeded',
        processed_count: values?.[3],
        started_at: values?.[5],
        finished_at: values?.[6],
      });
      return emptyResult('INSERT');
    }
    if (sql.startsWith('SELECT * FROM scheduled_job_runs')) {
      const nameFilter = sql.includes('job_name = $1') ? String(values?.[0]) : null;
      return rowsResult(
        nameFilter ? tables.scheduled_job_runs.filter((r) => r.job_name === nameFilter) : tables.scheduled_job_runs,
      );
    }

    // OVERVIEW METRICS / STATS
    if (sql.includes('COUNT(*)::int AS total_orders') && sql.includes('GROUP BY operator_code')) {
      return rowsResult([]);
    }
    if (sql.includes('COUNT(*)::int AS total_users')) {
      return rowsResult([
        {
          total_users: tables.users.size,
          total_esim_orders: tables.esim_orders.size,
          awaiting_manual: Array.from(tables.esim_orders.values()).filter((o) => o.status === 'awaiting_manual_fulfillment').length,
          provisioned_esims: tables.esim_activations.size,
          avail_stock: Array.from(tables.esim_stock_items.values()).filter((i) => i.status === 'available').length,
          res_stock: Array.from(tables.esim_stock_items.values()).filter((i) => i.status === 'reserved').length,
          pending_ag_apps: tables.agent_applications.size,
          approved_agents: tables.agents.size,
          verified_etb: Array.from(tables.payments.values())
            .filter((p) => p.status === 'verified')
            .reduce((s, p) => s + Number(p.amount_etb ?? 0), 0),
          open_tickets: Array.from(tables.support_tickets.values()).filter((t) => t.status === 'open').length,
          phone_orders: tables.phone_orders.size,
          biz_accounts: tables.business_accounts.size,
          pending_bulk: tables.business_bulk_orders.size,
        },
      ]);
    }

    // DEFAULT CATCH-ALL
    return emptyResult();
  };

  const client = {
    query: executeQuery,
    release: () => {},
  } as unknown as PoolClient;

  const pool = {
    query: executeQuery,
    connect: async () => {
      if (simulateConnectionDown) {
        const err = new Error('connect ECONNREFUSED 127.0.0.1:5432') as Error & { code?: string };
        err.code = 'ECONNREFUSED';
        throw err;
      }
      return client;
    },
  } as unknown as Pick<Pool, 'query' | 'connect'>;

  return {
    pool,
    queries,
    tables,
    appliedMigrations,
    setSimulateInsertError: (flag: boolean) => {
      simulateInsertError = flag;
    },
    setSimulateConnectionDown: (flag: boolean) => {
      simulateConnectionDown = flag;
    },
    setHoldAdvisoryLock: (flag: boolean) => {
      holdAdvisoryLock = flag;
    },
  };
}
