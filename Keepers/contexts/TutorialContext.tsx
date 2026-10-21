/**
 * File: TutorialContext.tsx
 * Description: Shows each tutorial once per account (the welcome one on first sign-in, screen ones on
 *              a screen's first visit) and lets any screen replay them.
 * Author: Kai Markley
 * Date: 2026-10-20
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { Tutorial } from '../components/tutorial/Tutorial';
import { TUTORIALS, type TutorialId } from '../components/tutorial/tutorials';

// Keyed by user so a second account on the same device still gets the walkthroughs.
const storageKey = (userId: string, id: TutorialId) => `tutorial:${id}:seen:${userId}`;

type TutorialContextValue = {
  showTutorial: (id: TutorialId) => void;
  showTutorialOnce: (id: TutorialId) => void;
};

const TutorialContext = createContext<TutorialContextValue | undefined>(undefined);

export function TutorialProvider({ userId, children }: { userId: string; children: React.ReactNode }) {
  // The id stays set while hidden so the closing fade still has steps to render.
  const [shown, setShown] = useState<{ id: TutorialId; visible: boolean }>({ id: 'welcome', visible: false });
  // Tutorials already looked up this session, so revisiting a screen doesn't hit storage again.
  const checked = useRef(new Set<string>());

  const showTutorial = useCallback((id: TutorialId) => setShown({ id, visible: true }), []);

  const showTutorialOnce = useCallback(
    (id: TutorialId) => {
      const key = storageKey(userId, id);
      if (checked.current.has(key)) return;
      checked.current.add(key);

      AsyncStorage.getItem(key)
        .then((seen) => {
          if (seen !== null) return;
          // Never cover a tutorial that's already open.
          setShown((current) => (current.visible ? current : { id, visible: true }));
        })
        .catch((error) => console.error('Failed to read tutorial state', error));
    },
    [userId],
  );

  useEffect(() => {
    showTutorialOnce('welcome');
  }, [showTutorialOnce]);

  const finish = () => {
    setShown((current) => ({ ...current, visible: false }));
    AsyncStorage.setItem(storageKey(userId, shown.id), 'true').catch((error) =>
      console.error('Failed to save tutorial state', error),
    );
  };

  const value = useMemo(() => ({ showTutorial, showTutorialOnce }), [showTutorial, showTutorialOnce]);

  return (
    <TutorialContext.Provider value={value}>
      {children}
      <Tutorial
        visible={shown.visible}
        steps={TUTORIALS[shown.id].steps}
        finishLabel={TUTORIALS[shown.id].finishLabel}
        onFinish={finish}
      />
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
