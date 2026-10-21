/**
 * File: TutorialContext.tsx
 * Description: Shows each tutorial once to new accounts (the welcome one on first sign-in, screen ones on
 *              a screen's first visit) and lets any screen replay them.
 * Author: Kai Markley
 * Date: 2026-10-20
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import type { User } from '@supabase/supabase-js';
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { Tutorial } from '../components/tutorial/Tutorial';
import { TUTORIALS, type TutorialId } from '../components/tutorial/tutorials';
import { supabase } from '../utils/supabase';

// Tutorials only open on their own for accounts younger than this; older accounts can replay them from Settings.
const NEW_ACCOUNT_WINDOW_MS = 7 * 24 * 60 * 60 * 1000;

// Local copy of the seen flag, checked first so a known answer doesn't wait on the account.
const storageKey = (userId: string, id: TutorialId) => `tutorial:${id}:seen:${userId}`;

type SeenTutorials = Partial<Record<TutorialId, boolean>>;

function isNewAccount(user: User) {
  const created = Date.parse(user.created_at);
  return Number.isFinite(created) && Date.now() - created < NEW_ACCOUNT_WINDOW_MS;
}

// The seen flags also live on the account, so they survive reinstalls, new devices, and the web build.
function seenOnAccount(user: User): SeenTutorials {
  const seen = user.user_metadata?.tutorials_seen;
  return seen && typeof seen === 'object' ? (seen as SeenTutorials) : {};
}

type TutorialContextValue = {
  showTutorial: (id: TutorialId) => void;
  showTutorialOnce: (id: TutorialId) => void;
};

const TutorialContext = createContext<TutorialContextValue | undefined>(undefined);

export function TutorialProvider({ user, children }: { user: User; children: React.ReactNode }) {
  // The id stays set while hidden so the closing fade still has steps to render.
  const [shown, setShown] = useState<{ id: TutorialId; visible: boolean }>({ id: 'welcome', visible: false });
  // Tutorials already looked up this session, so revisiting a screen doesn't check again.
  const checked = useRef(new Set<string>());

  const showTutorial = useCallback((id: TutorialId) => setShown({ id, visible: true }), []);

  const showTutorialOnce = useCallback(
    (id: TutorialId) => {
      const key = storageKey(user.id, id);
      if (checked.current.has(key)) return;
      checked.current.add(key);

      if (!isNewAccount(user) || seenOnAccount(user)[id]) return;

      AsyncStorage.getItem(key)
        .then((seen) => {
          if (seen !== null) return;
          // Never cover a tutorial that's already open.
          setShown((current) => (current.visible ? current : { id, visible: true }));
        })
        .catch((error) => console.error('Failed to read tutorial state', error));
    },
    [user],
  );

  useEffect(() => {
    showTutorialOnce('welcome');
  }, [showTutorialOnce]);

  const finish = () => {
    const id = shown.id;
    setShown((current) => ({ ...current, visible: false }));
    AsyncStorage.setItem(storageKey(user.id, id), 'true').catch((error) =>
      console.error('Failed to save tutorial state', error),
    );
    if (seenOnAccount(user)[id]) return;
    supabase.auth
      .updateUser({ data: { tutorials_seen: { ...seenOnAccount(user), [id]: true } } })
      .then(({ error }) => {
        if (error) console.error('Failed to save tutorial state to account', error.message);
      });
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
