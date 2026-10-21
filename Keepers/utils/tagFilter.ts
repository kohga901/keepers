/**
 * File: tagFilter.ts
 * Description: Pure functions for the swiper's tag filter. Nothing here touches state, the network or
 *              the UI, so every function returns the same output for the same input and never mutates
 *              its arguments.
 * Author: Derek Tinoco
 * Date: 2026-10-19
 */

export type Tag = {
  Tag: string;
  Category: string;
};

export type TagGroup = {
  category: string;
  tags: readonly Tag[];
};

// Adds the tag to the selection if it is missing, removes it if it is there.
export const toggleTag = (selected: readonly string[], tag: string): readonly string[] =>
  selected.includes(tag) ? selected.filter((t) => t !== tag) : [...selected, tag];

// Orders tags by category, then by name, so each category's tags sit together in the list.
const byCategoryThenName = (a: Tag, b: Tag): number =>
  a.Category.localeCompare(b.Category) || a.Tag.localeCompare(b.Tag);

// Groups tags by category. Groups and the tags inside them are sorted by name.
// Sorts once, then a tag that starts a new category starts a new group, so no group is copied per tag.
export const groupByCategory = (tags: readonly Tag[]): readonly TagGroup[] => {
  const sorted = [...tags].sort(byCategoryThenName);
  return sorted
    .filter((tag, i) => i === 0 || tag.Category !== sorted[i - 1].Category)
    .map((first) => ({
      category: first.Category,
      tags: sorted.filter((tag) => tag.Category === first.Category),
    }));
};

// Two selections are the same filter if they hold the same tags, in any order.
export const sameSelection = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((tag) => b.includes(tag));

// What the deck should say when it has no cards left.
export const emptyDeckMessage = (filterActive: boolean, loadFailed: boolean): string =>
  loadFailed
    ? "We still couldn't load more items. Check your connection and try again."
    : filterActive
      ? 'No more items match these filters. Try removing some, or tap refresh.'
      : "You're swiping faster than we can keep up! Tap refresh to load more items.";
