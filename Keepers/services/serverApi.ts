import { supabase } from '../utils/supabase';
import { getClothing } from './dataServices';

const SERVER_BASE_URL = 'https://trial-exact-usable.ngrok-free.dev';

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