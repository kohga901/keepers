/**
 * File: serverApi.ts
 * Description: API functions for interacting with the server, including fetching recommendations and sending swipe data.
 * Author: Kai Markley 
 * Date: 2026-04-21
 * 
 * 
 */

import { supabase } from '../utils/supabase';
import { getClothing } from './dataServices';
import type { Tag } from '../utils/tagFilter';

const SERVER_BASE_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'https://trial-exact-usable.ngrok-free.dev';

type SwipePayload = {
  user_id: string;
  item_id: string;
  liked: boolean;
};

// What to show when the server can't answer. The unfiltered catalog would ignore the user's filter,
// so while a filter is active the answer is "nothing" instead.
const fallbackItems = (categories: readonly string[]) =>
  categories.length === 0 ? getClothing() : Promise.resolve([]);

export const getRecommendationsFromServer = async (n: number, categories: readonly string[] = []) => {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    console.error('No user found');
    return await fallbackItems(categories); // fallback
  }

  const payload = {
    user_id: userData.user.id,
    n,
    categories,
  };

  // if server URL not set
  if (!SERVER_BASE_URL) {
    console.log('No server URL → fallback');
    return await fallbackItems(categories);
  }

  try {
    const response = await fetch(`${SERVER_BASE_URL}/clothes/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    // bad response
    if (!response.ok) {
      console.log('Server failed → fallback');
      return await fallbackItems(categories);
    }

    const result = await response.json();
    //console.log('Server result:', result);

    const data = Array.isArray(result)
      ? result
      : result.recommendations ?? [];

    if (data.length === 0) {
      console.log('Empty → fallback');
      return await fallbackItems(categories);
    }

    return data;

  } catch (error) {
    console.log('Error → fallback', error);
    return await fallbackItems(categories);
  }
};

// The tags the feed can be filtered by. An empty list (server down) just means no filter options.
export const getTagsFromServer = async (): Promise<readonly Tag[]> => {
  try {
    const response = await fetch(`${SERVER_BASE_URL}/clothes/tags`);
    if (!response.ok) return [];

    const result = await response.json();
    return Array.isArray(result.tags) ? result.tags : [];
  } catch (error) {
    console.log('Could not load filter tags', error);
    return [];
  }
};


export const sendSwipeToServer = async (itemId: string, liked: boolean) => {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    console.error('No user found');
    return false;
  }

  const payload: SwipePayload = {
    user_id: userData.user.id,
    item_id: itemId,
    liked,
  };

  try {
    const response = await fetch(`${SERVER_BASE_URL}/clothes/swipe`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      console.error('Failed to send swipe');
      return false;
    }

    const data = await response.json();
    //console.log('Swipe sent:', data);
    return true;
  } catch (error) {
    console.error('Error sending swipe:', error);
    return false;
  }
};
export type ClearHistoryScope = 'liked' | 'disliked' | 'all';

// Wipes the signed-in user's likes, dislikes, or both. The server checks the access token,
// so it only ever clears the caller's own history. Returns an error message, or null on success.
export const clearHistoryOnServer = async (scope: ClearHistoryScope): Promise<string | null> => {
  const { data, error } = await supabase.auth.getSession();
  const token = data.session?.access_token;

  if (error || !token) {
    return 'Sign in again to clear your history.';
  }

  try {
    const response = await fetch(`${SERVER_BASE_URL}/clothes/history/clear`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ scope }),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => null);
      return typeof result?.detail === 'string' ? result.detail : 'Your history could not be cleared. Please try again.';
    }

    return null;
  } catch (fetchError) {
    console.error('Error clearing history:', fetchError);
    return 'Could not reach the Keepers server. Check your connection and try again.';
  }
};
