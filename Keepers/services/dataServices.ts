/**
 * File: dataServices.ts
 * Description: This file will contain all the fuctions that interact
 *  with the database, such as fetching clothing items and saving liked 
 * items.
 * Author: Kai Markley
 */
import { supabase } from '../utils/supabase';


export const getClothing = async () => {
  // const { count } = await supabase
  //   .from('recipes')
  //   .select('*', { count: 'exact', head: true })
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
        console.error('No user found');
        return;
    }
    const userId = userData.user.id;

  //const count = 4732 //Only use if know exact row count

  //const randomOffset = Math.floor(Math.random() * count)

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
        .limit(10);

    if (likedIds.length > 0) {
        query = query.not('item_id', 'in', `(${likedIds.join(',')})`);
    }
    const { data, error } = await query;
    if (error) {
        console.error(error);
        return;
    }
    return data.sort(() => Math.random() - 0.5);
}

export const saveLikedItem = async (clothesId: string) => {
    const { data: userData, error: userError } = await supabase.auth.getUser();

    if (userError || !userData.user) {
        console.error('No user found');
        return;
    }

    const userId = userData.user.id;

    const { error } = await supabase
        .from('LikedItems')
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