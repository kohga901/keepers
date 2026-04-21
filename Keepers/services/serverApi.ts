/**
 * File: serverApi.ts
 * Description: Handles requests to the recommendation server API.
 */

import { supabase } from '../utils/supabase';
import { getClothing } from './dataServices';


const SERVER_BASE_URL = ''; 

// const SERVER_BASE_URL = 'https://your-server-url.com';

type SwipePayload = {
  user_id: string;
  item_id: string;
  liked: boolean;
};

type RecommendationPayload = {
  user_id: string;
  n: number;
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

  //CASE 1: no server URL
  if (!SERVER_BASE_URL) {
    console.log('No server URL → using fallback');
    return await getClothing();
  }

  try {
    const response = await fetch(`${SERVER_BASE_URL}/clothes/recommendations`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });

    //CASE 2: bad response
    if (!response.ok) {
      console.log('Server failed → using fallback');
      return await getClothing();
    }

    const data = await response.json();

    //CASE 3: empty data
    if (!data || data.length === 0) {
      console.log('No recommendations → using fallback');
      return await getClothing();
    }

    return data;

  } catch (error) {
    //CASE 4: crash / network error
    console.log('Error → using fallback');
    return await getClothing();
  }
};