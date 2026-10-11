/**
 * File: StackHeaderHeightContext.tsx
 * Description: Shares the measured height of the root "KEEPERS" stack header so screens that hide it
 *  (e.g. Liked History) can render their own header at the exact same height.
 * Author: Kai Markley
 * Date: 2026-10-06
 */

import React, { createContext, useContext, useState } from 'react';
import { useHeaderHeight } from 'expo-router/react-navigation';

const StackHeaderHeightContext = createContext(0);

// Must be rendered inside the root stack screen so it can read that header's height.
export function StackHeaderHeightProvider({ children }: { children: React.ReactNode }) {
  const measuredHeight = useHeaderHeight();
  const [lastHeight, setLastHeight] = useState(measuredHeight);

  // The stack reports 0 while its header is hidden, so keep the last real measurement.
  if (measuredHeight > 0 && measuredHeight !== lastHeight) {
    setLastHeight(measuredHeight);
  }

  return (
    <StackHeaderHeightContext.Provider value={lastHeight}>
      {children}
    </StackHeaderHeightContext.Provider>
  );
}

// Returns 0 until the header has been shown at least once.
export function useStackHeaderHeight() {
  return useContext(StackHeaderHeightContext);
}
