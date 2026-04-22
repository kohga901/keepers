/**
 * File: Items.ts
 * Description: Defines the Item interface representing clothing items in the app.
 * Author: Kai Markley
 * Date: 2026-04-18
 */

export interface Item {
  gender: string;
  id: string;
  imageUrl: string;
  name: string;
  price: string;
  itemUrl: string;
  liked: boolean;
  
  
}

export type ClothingRow = {
  item_id: string;
  item_name: string;
  item_price: string;
  item_img: string;
  item_web_listing: string;
  item_gender: string;
};