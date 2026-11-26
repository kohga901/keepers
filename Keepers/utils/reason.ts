/**
 * File: reason.ts
 * Description: Turns the server's "Why am I seeing this?" reason into what the feed card shows.
 *   The server only attaches a reason to a share of the feed (see server/services/explanation_service.py),
 *   so most cards have none and show no button.
 */

import type { Reason, ReasonRow } from '../models/Items';

// Ionicons glyph per reason kind. Unknown kinds get the generic help icon.
const REASON_ICONS: Record<string, string> = {
  similar_to_like: 'heart',
  liked_tags: 'pricetags',
  close_to_taste: 'sparkles',
  filter: 'funnel',
  adjacent: 'compass',
  explore: 'shuffle',
  cold_start: 'shuffle',
};

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value.trim().length > 0;

// Images are loaded straight from the URL, so only secure links are used.
const httpsOnly = (value: unknown): string | undefined => {
  if (!nonEmpty(value)) return undefined;
  try {
    return new URL(value).protocol === 'https:' ? value : undefined;
  } catch {
    return undefined;
  }
};

/** The reason to show, or undefined when there is none or it has no text to show. */
export function toReason(row: ReasonRow | null | undefined): Reason | undefined {
  if (!row || !nonEmpty(row.text)) return undefined;
  return {
    kind: nonEmpty(row.kind) ? row.kind : 'unknown',
    text: row.text.trim(),
    likedItemName: nonEmpty(row.liked_item_name) ? row.liked_item_name : undefined,
    likedItemImageUrl: httpsOnly(row.liked_item_img),
    tags: Array.isArray(row.tags) ? row.tags.filter(nonEmpty) : [],
  };
}

export function reasonIcon(kind: string): string {
  return REASON_ICONS[kind] ?? 'help-circle';
}
