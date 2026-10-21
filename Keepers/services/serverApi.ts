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
      console.log(`Server failed → fallback (${explainServerFailure(response.status)})`);
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


// Turns the HTTP status of a failed server call into "what is probably wrong, and what to do about it".
// "Failed to send swipe" alone tells you nothing, but the status code tells you almost everything.
// This only changes what we LOG. What the user sees (the fallback items, `return false`) is untouched.
//
// Quick map, from "your problem" to "server's problem" to "the tunnel's problem":
//   4xx  → the request was wrong     (we sent something the server rejected)
//   5xx  → the server broke          (we sent something fine, the server fell over)
//   404/502 from ngrok → the tunnel  (the request never reached our server at all)
const explainServerFailure = (status: number): string => {
  switch (status) {
    case 404:
      // Our /clothes/... routes exist, so a 404 almost always means ngrok itself answered:
      // the tunnel is offline or the URL changed (free ngrok URLs change when it restarts).
      // → Check EXPO_PUBLIC_SERVER_URL and that `ngrok http 8000` is still running.
      return '404: route not found. If this is ngrok, the tunnel is offline or the URL changed.';

    case 422:
      // FastAPI says the body didn't match the request model in server/routers/clothes.py
      // (SwipeData for swipes, RecommendationRequest for the feed). For swipes, note that
      // SwipePayload.item_id is a string here while the server wants an int. FastAPI
      // converts "123" to 123 fine, but something like "abc" lands here.
      // → Log `payload` and compare it to the model.
      return '422: the server rejected the request data (wrong shape or type).';

    case 502:
    case 504:
      // ngrok is up but nothing is answering behind it, or it took too long.
      // → uvicorn is stopped or crashed. Restart it from the server/ folder.
      return `${status}: the tunnel is up but the Python server is not responding. Is uvicorn running?`;

    case 503:
      // Our own deliberate answer from the /clothes/ routes while Startup.ready is false.
      // The server is fetching every embedding from Supabase on boot, which takes a while.
      // → Wait for "SERVER READY" in the uvicorn terminal. If it never shows up, look for
      //   "Startup failed" higher up in that log: boot crashed and 503 will never go away.
      return '503: the server is still warming up (or boot failed). Look for "SERVER READY" in its log.';

    case 500:
      // Python raised an exception, usually a Supabase call (bad item id, bad user id,
      // Supabase down). FastAPI hides the details from the client.
      // → The real error with its traceback is in the uvicorn terminal. Read that, not this.
      return '500: the server crashed handling the request. The traceback is in the uvicorn terminal.';

    default:
      // Anything unexpected. At least show the number so it can be searched for.
      return `${status}: unexpected response from the server.`;
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
      console.error(`Failed to send swipe → ${explainServerFailure(response.status)}`);
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
