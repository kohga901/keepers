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