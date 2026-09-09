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

const SERVER_BASE_URL = process.env.EXPO_PUBLIC_SERVER_URL ?? 'https://trial-exact-usable.ngrok-free.dev';

type SwipePayload = {
  user_id: string;
  item_id: string;
  liked: boolean;
};

export const getRecommendationsFromServer = async (n: number) => {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    console.error('No user found');
    return await getClothing(); // fallback
  }

  const payload = {
    user_id: userData.user.id,
    n,
  };

  // if server URL not set
  if (!SERVER_BASE_URL) {
    console.log('No server URL → fallback');
    return await getClothing();
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
      return await getClothing();
    }

    const result = await response.json();
    //console.log('Server result:', result);

    const data = Array.isArray(result)
      ? result
      : result.recommendations ?? [];

    if (data.length === 0) {
      console.log('Empty → fallback');
      return await getClothing();
    }

    return data;

  } catch (error) {
    console.log('Error → fallback', error);
    return await getClothing();
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