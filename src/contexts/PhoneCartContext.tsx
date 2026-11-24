import React, { createContext, useContext, useEffect, useState } from 'react';
import type { OperatorCode, PhoneProductRecord } from '../types/domain';

export interface PhoneBagItem {
  phoneProductId: string;
  brand: string;
  model: string;
  exactModelNumber: string;
  storage: string;
  condition: string;
  imageKey: string | null;
  imageUrl: string | null;
  unitPriceEtb: number | null;
  sandboxPreviewPriceEtb: number | null;
  esimCompatibilityStatus: PhoneProductRecord['esimCompatibilityStatus'];
  bulkMinimumQty: number;
  stockQty: number;
  orderKind: 'individual' | 'bulk_business';
  quantity: number;
  pairedEsimOperator: OperatorCode | null;
}

interface PhoneCartContextValue {
  items: PhoneBagItem[];
  drawerOpen: boolean;
  setDrawerOpen: (open: boolean) => void;
  addItem: (
    phone: PhoneProductRecord,
    options?: {
      quantity?: number;
      orderKind?: 'individual' | 'bulk_business';
      pairedEsimOperator?: OperatorCode | null;
    },
  ) => void;
  updateItemQty: (phoneProductId: string, quantity: number) => void;
  updateItemOrderKind: (phoneProductId: string, orderKind: 'individual' | 'bulk_business') => void;
  updateItemPairedEsim: (phoneProductId: string, op: OperatorCode | null) => void;
  removeItem: (phoneProductId: string) => void;
  clearBag: () => void;
  totalUnits: number;
}

const STORAGE_KEY = 'yene_phone_bag_v1';

const PhoneCartContext = createContext<PhoneCartContextValue | null>(null);

export function PhoneCartProvider({ children }: { children: React.ReactNode }) {
  const [items, setItems] = useState<PhoneBagItem[]>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      const parsed = JSON.parse(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  });
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      // ignore storage quota
    }
  }, [items]);

  const addItem: PhoneCartContextValue['addItem'] = (phone, options) => {
    const orderKind = options?.orderKind ?? 'individual';
    const minQty = orderKind === 'bulk_business' ? phone.bulkMinimumQty : 1;
    const desiredQty = Math.max(minQty, Math.min(phone.stockQty, options?.quantity ?? minQty));
    if (phone.stockQty <= 0) return;

    setItems((prev) => {
      const idx = prev.findIndex((i) => i.phoneProductId === phone.id);
      if (idx >= 0) {
        const copy = [...prev];
        const existing = copy[idx];
        const nextQty = Math.min(phone.stockQty, existing.quantity + desiredQty);
        copy[idx] = {
          ...existing,
          orderKind,
          quantity: nextQty,
          pairedEsimOperator: options?.pairedEsimOperator ?? existing.pairedEsimOperator,
        };
        return copy;
      }
      return [
        ...prev,
        {
          phoneProductId: phone.id,
          brand: phone.brand,
          model: phone.model,
          exactModelNumber: phone.exactModelNumber,
          storage: phone.storage,
          condition: phone.condition,
          imageKey: phone.imageKey,
          imageUrl: phone.imageUrl,
          unitPriceEtb: phone.unitPriceEtb,
          sandboxPreviewPriceEtb: phone.sandboxPreviewPriceEtb,
          esimCompatibilityStatus: phone.esimCompatibilityStatus,
          bulkMinimumQty: phone.bulkMinimumQty,
          stockQty: phone.stockQty,
          orderKind,
          quantity: desiredQty,
          pairedEsimOperator: options?.pairedEsimOperator ?? null,
        },
      ];
    });
    setDrawerOpen(true);
  };

  const updateItemQty = (phoneProductId: string, quantity: number) => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.phoneProductId !== phoneProductId) return item;
        const min = item.orderKind === 'bulk_business' ? item.bulkMinimumQty : 1;
        const clamped = Math.max(min, Math.min(item.stockQty, Math.floor(quantity) || min));
        return { ...item, quantity: clamped };
      }),
    );
  };

  const updateItemOrderKind = (phoneProductId: string, orderKind: 'individual' | 'bulk_business') => {
    setItems((prev) =>
      prev.map((item) => {
        if (item.phoneProductId !== phoneProductId) return item;
        const min = orderKind === 'bulk_business' ? item.bulkMinimumQty : 1;
        return {
          ...item,
          orderKind,
          quantity: Math.min(item.stockQty, Math.max(item.quantity, min)),
        };
      }),
    );
  };

  const updateItemPairedEsim = (phoneProductId: string, op: OperatorCode | null) => {
    setItems((prev) =>
      prev.map((item) =>
        item.phoneProductId === phoneProductId ? { ...item, pairedEsimOperator: op } : item,
      ),
    );
  };

  const removeItem = (phoneProductId: string) => {
    setItems((prev) => prev.filter((item) => item.phoneProductId !== phoneProductId));
  };

  const clearBag = () => setItems([]);

  const totalUnits = items.reduce((sum, item) => sum + item.quantity, 0);

  return (
    <PhoneCartContext.Provider
      value={{
        items,
        drawerOpen,
        setDrawerOpen,
        addItem,
        updateItemQty,
        updateItemOrderKind,
        updateItemPairedEsim,
        removeItem,
        clearBag,
        totalUnits,
      }}
    >
      {children}
    </PhoneCartContext.Provider>
  );
}

export function usePhoneCart() {
  const ctx = useContext(PhoneCartContext);
  if (!ctx) throw new Error('usePhoneCart must be used within PhoneCartProvider');
  return ctx;
}
