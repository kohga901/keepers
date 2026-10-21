/**
 * File: TutorialContext.tsx
 * Description: Shows the first-run tutorial once per account and lets any screen replay it.
 * Author: Kai Markley
 * Date: 2026-10-20
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useContext, useEffect, useState } from 'react';

import { Tutorial } from '../components/tutorial/Tutorial';

// Keyed by user so a second account on the same device still gets the walkthrough.
const storageKey = (userId: string) => `tutorial:seen:${userId}`;

type TutorialContextValue = {
  showTutorial: () => void;
};

const TutorialContext = createContext<TutorialContextValue | undefined>(undefined);

export function TutorialProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let isMounted = true;
    AsyncStorage.getItem(storageKey(userId))
      .then((seen) => {
        if (isMounted && seen === null) setVisible(true);
      })
      .catch((error) => console.error('Failed to read tutorial state', error));
    return () => {
      isMounted = false;
    };
  }, [userId]);

  const finish = () => {
    setVisible(false);
    AsyncStorage.setItem(storageKey(userId), 'true').catch((error) =>
      console.error('Failed to save tutorial state', error),
    );
  };

  return (
    <TutorialContext.Provider value={{ showTutorial: () => setVisible(true) }}>
      {children}
      <Tutorial visible={visible} onFinish={finish} />
    </TutorialContext.Provider>
  );
}

export function useTutorial() {
  const context = useContext(TutorialContext);
  if (!context) {
    throw new Error('useTutorial must be used within a TutorialProvider');
  }
  return context;
}
