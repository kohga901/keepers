export interface Item {
  gender?: string;
  id: string;
  imageUrl: string;
  name: string;
  price: string;
  itemUrl: string;
  liked: boolean;
  
  
}

export type LikedItemRow = {
  clothes_id: string;
  Clothing: {
    item_id: string;
    item_name: string;
    item_price: string;
    item_img: string;
    item_web_listing: string;
  } | null;
};