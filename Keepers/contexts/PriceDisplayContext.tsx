/**
 * File: PriceDisplayContext.tsx
 * Description: Persists and shares the user's preference for showing prices as $ tier symbols vs exact prices.
 * Author: Kai Markley
 * Date: 2026-09-02
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

const STORAGE_KEY = 'settings:showPriceAsTier';

type PriceDisplayContextValue = {
  showPriceAsTier: boolean;
  setShowPriceAsTier: (value: boolean) => void;
};

const PriceDisplayContext = createContext<PriceDisplayContextValue | undefined>(undefined);

export function PriceDisplayProvider({ children }: { children: React.ReactNode }) {
  const [showPriceAsTier, setShowPriceAsTierState] = useState(true);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((stored) => {
      if (stored !== null) {
        setShowPriceAsTierState(stored === 'true');
      }
    });
  }, []);

  const setShowPriceAsTier = (value: boolean) => {
    setShowPriceAsTierState(value);
    AsyncStorage.setItem(STORAGE_KEY, String(value));
  };

  return (
    <PriceDisplayContext.Provider value={{ showPriceAsTier, setShowPriceAsTier }}>
      {children}
    </PriceDisplayContext.Provider>
  );
}

export function usePriceDisplay() {
  const context = useContext(PriceDisplayContext);
  if (!context) {
    throw new Error('usePriceDisplay must be used within a PriceDisplayProvider');
  }
  return context;
}
