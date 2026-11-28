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
  // True when the user asked for this item and it was approved since they last saw it.
  requested?: boolean;
  // Why the item is in the feed. Only a share of the feed has one (see utils/reason.ts).
  reason?: Reason;
  // True for the one trending ("Most liked") item the server puts in a batch.
  trending?: boolean;
}

// A checked, ready-to-show "Why am I seeing this?" reason.
export interface Reason {
  kind: string;
  text: string;
  // The liked item a "Because you liked ..." reason points at, if any.
  likedItemName?: string;
  likedItemImageUrl?: string;
  tags: string[];
}

// The reason as the server sends it (see server/routers/clothes.py Reason).
export type ReasonRow = {
  kind: string;
  text: string;
  liked_item_id?: number | null;
  liked_item_name?: string | null;
  liked_item_img?: string | null;
  tags?: string[] | null;
};

export type ClothingRow = {
  item_id: string;
  item_name: string;
  item_price: string;
  item_img: string;
  item_web_listing: string;
  item_gender: string;
  requested_by_you?: boolean;
  reason?: ReasonRow | null;
  // The batch's trending item (see server/services/trending_service.py).
  is_trending?: boolean;
  // Trending item only: how many users liked it recently. Not shown in the app.
  like_count?: number | null;
};