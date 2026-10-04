import { supabase } from '../utils/supabase';
import type { WrapData, WrapItem, WrapTag } from '../utils/styleWrap';

type ReactionRow = {
  clothes_id: string | number;
  Clothing: { item_name: string | null; item_img: string | null; item_web_listing: string | null } | null;
};
type TagRow = { Tag: string; Category: string };
type ItemTagRow = { clothes_id: string | number; Tag: string };

// Stay below the default API row limit and page until exhausted. A recap must
// not silently stop counting at the first 1,000 reactions or tag assignments.
const PAGE_SIZE = 500;

export async function getStyleWrap(signal: AbortSignal): Promise<WrapData> {
  const { data: { user }, error } = await supabase.auth.getUser();
  if (error || !user) throw new Error('Please sign in again to load your style recap.');

  async function readReactions(table: 'Likes' | 'Dislikes'): Promise<ReactionRow[]> {
    const rows: ReactionRow[] = [];
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error: queryError } = await supabase.from(table)
        .select('clothes_id, Clothing(item_name, item_img, item_web_listing)')
        .eq('user_id', user!.id)
        .order('clothes_id')
        .range(offset, offset + PAGE_SIZE - 1)
        .abortSignal(signal);
      if (queryError) throw new Error('Your recap could not be loaded. Please try again.');
      const page = data as unknown as ReactionRow[];
      rows.push(...page);
      if (page.length < PAGE_SIZE) return rows;
    }
  }

  const [likedRows, dislikedRows] = await Promise.all([readReactions('Likes'), readReactions('Dislikes')]);
  const likes: WrapItem[] = likedRows.map((row) => ({
    id: String(row.clothes_id), name: row.Clothing?.item_name ?? null,
    imageUrl: row.Clothing?.item_img ?? null,
    itemUrl: row.Clothing?.item_web_listing ?? null,
  }));
  const result: WrapData = { likes, dislikeIds: dislikedRows.map((row) => String(row.clothes_id)), tags: [], tagsUnavailable: false };
  if (!likes.length) return result;

  try {
    const categories = new Map<string, string>();
    for (let offset = 0; ; offset += PAGE_SIZE) {
      const { data, error: tagError } = await supabase.from('Tags').select('Tag, Category')
        .order('Tag').range(offset, offset + PAGE_SIZE - 1).abortSignal(signal);
      if (tagError) throw tagError;
      const page = data as TagRow[];
      page.forEach((tag) => categories.set(tag.Tag, tag.Category));
      if (page.length < PAGE_SIZE) break;
    }
    const tags: WrapTag[] = [];
    const ids = [...new Set(likes.map((item) => item.id))];
    for (let start = 0; start < ids.length; start += 100) {
      for (let offset = 0; ; offset += PAGE_SIZE) {
        const { data, error: tagError } = await supabase.from('Tagged_Clothing')
          .select('clothes_id, Tag').in('clothes_id', ids.slice(start, start + 100))
          .order('clothes_id').order('Tag').range(offset, offset + PAGE_SIZE - 1).abortSignal(signal);
        if (tagError) throw tagError;
        const page = data as ItemTagRow[];
        page.forEach((tag) => {
          const category = categories.get(tag.Tag);
          if (category) tags.push({ itemId: String(tag.clothes_id), name: tag.Tag, category });
        });
        if (page.length < PAGE_SIZE) break;
      }
    }
    result.tags = tags;
  } catch {
    if (signal.aborted) throw new Error('Recap request cancelled.');
    // A missing tag relationship must not hide otherwise valid reaction counts.
    result.tagsUnavailable = true;
  }
  return result;
}
