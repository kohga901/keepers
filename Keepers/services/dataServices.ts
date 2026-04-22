/**
 * File: dataServices.ts
 * Description: This file will contain all the fuctions that interact
 *  with the database, such as fetching clothing items and saving liked 
 * items.
 * Author: Kai Markley
 */
import { supabase } from '../utils/supabase';


export const getClothing = async () => {
  
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
        console.error('No user found');
        return;
    }
    const userId = userData.user.id;

    const{data:liked,error: likedError} = await supabase
        .from('Likes')
        .select('clothes_id')
        .eq('user_id', userId);
    if (likedError) {
        console.error(likedError);
        return;
    }
    const likedIds = liked.map((item) => item.clothes_id);
    let query = supabase
        .from('Clothing')
        .select('*')
        

    if (likedIds.length > 0) {
        query = query.not('item_id', 'in', `(${likedIds.join(',')})`);
    }
    const { data, error } = await query.limit(50);
    if (error) {
        console.error(error);
        return;
    }
    return (data.sort(() => Math.random() - 0.5)).slice(0,10);
}

export const getClothingById = async (itemId: string) => {
  const numericId = Number(itemId);

  const queries = Number.isFinite(numericId)
    ? [
        supabase.from('Clothing').select('*').eq('item_id', numericId).limit(1).maybeSingle(),
        supabase.from('Clothing').select('*').eq('item_id', itemId).limit(1).maybeSingle(),
      ]
    : [supabase.from('Clothing').select('*').eq('item_id', itemId).limit(1).maybeSingle()];

  for (const query of queries) {
    const { data, error } = await query;
    if (error || !data) {
      continue;
    }

    return data;
  }

  return null;
}

export const saveLikedItem = async (clothesId: string) => {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
        console.error('No user found');
        return;
    }

    const userId = userData.user.id;

    const { error } = await supabase
        .from('Likes')
        .insert([
        {
            user_id: userId,
            clothes_id: clothesId,
        },
        ]);

    if (error) {
        console.error('Error saving liked item:', error.message);
    }
};

export const getLikedItems = async () => {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    console.error('No user found');
    return;
  }

  const userId = userData.user.id;

  const { data, error } = await supabase
    .from('Likes')
    .select(`
      clothes_id,
      Clothing (*)
    `)
    .eq('user_id', userId);

  if (error) {
    console.error('Error fetching liked items:', error.message);
    return;
  }

  return data;
};

export const deleteLikedItem = async (clothesId: string) => {
  const { data: userData, error: userError } = await supabase.auth.getUser();

  if (userError || !userData.user) {
    console.error('No user found');
    return;
  }

  const userId = userData.user.id;

  const { error } = await supabase
    .from('Likes')
    .delete()
    .eq('user_id', userId)
    .eq('clothes_id', clothesId);

  if (error) {
    console.error('Error deleting liked item:', error.message);
  }
};