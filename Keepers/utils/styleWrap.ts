export type WrapItem = {
  id: string;
  name: string | null;
  imageUrl: string | null;
};

export type WrapTag = { itemId: string; name: string; category: string };

export type WrapData = {
  likes: WrapItem[];
  dislikeIds: string[];
  tags: WrapTag[];
  tagsUnavailable: boolean;
};

export type RankedTag = { name: string; count: number; percent: number };

export function tagLabel(tag: string): string {
  if (tag.toLowerCase() === 'y2k') return 'Y2K';
  return tag.replace(/-/g, ' ').replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function rankTags(tags: WrapTag[], category: string): RankedTag[] {
  const matching = tags.filter((tag) => tag.category === category);
  const taggedItems = new Set(matching.map((tag) => tag.itemId)).size;
  const counts = new Map<string, Set<string>>();
  for (const tag of matching) {
    const items = counts.get(tag.name) ?? new Set<string>();
    items.add(tag.itemId);
    counts.set(tag.name, items);
  }
  return [...counts].map(([name, items]) => ({
    name,
    count: items.size,
    percent: Math.round((items.size / taggedItems) * 100),
  })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}

export function buildStyleWrap(data: WrapData) {
  const likes = [...new Map(data.likes.map((item) => [item.id, item])).values()];
  const likedIds = new Set(likes.map((item) => item.id));
  const dislikeCount = new Set(data.dislikeIds).size;
  // These are saved reactions, not a lifetime count of swipe events. An item
  // may exist in both tables; without timestamps neither reaction supersedes the other.
  const total = likes.length + dislikeCount;
  const likeRate = total ? Math.round((likes.length / total) * 100) : 0;
  const tags = data.tags.filter((tag) => likedIds.has(tag.itemId));
  const styles = rankTags(tags, 'style');
  const garments = rankTags(tags, 'garment-type');
  const colors = rankTags(tags, 'color');
  const fits = rankTags(tags, 'fit');
  const topStyles = styles.filter((style) => style.count === styles[0]?.count);
  const personality = likes.length < 5 || !styles.length
    ? { title: 'Style in the making', description: 'Every keeper adds another piece to your style story.' }
    : topStyles.length > 1
      ? { title: 'The Style Mixer', description: `${topStyles.slice(0, 3).map((style) => tagLabel(style.name)).join(', ')} share the lead in your likes.` }
      : { title: `The ${tagLabel(styles[0].name)} Edit`, description: `${tagLabel(styles[0].name)} appears on ${styles[0].percent}% of your likes with style tags. You have a favorite lane.` };
  const milestone = [10, 25, 50, 100, 250, 500, 1000].find((value) => value > likes.length)
    ?? (Math.floor(likes.length / 500) + 1) * 500;

  return {
    likes, dislikeCount, total, likeRate, dislikeRate: total ? 100 - likeRate : 0,
    styles, garments, colors, fits, personality, milestone,
    taggedLikeCount: new Set(tags.map((tag) => tag.itemId)).size,
    styleTaggedCount: new Set(tags.filter((tag) => tag.category === 'style').map((tag) => tag.itemId)).size,
  };
}

export const COLOR_SWATCHES: Record<string, string> = {
  black: '#242424', white: '#FFFFFF', navy: '#263654', blue: '#5689C5',
  pink: '#E8A4BC', gray: '#93989C', green: '#668B64', brown: '#896448',
  olive: '#80864D', red: '#BF493F', beige: '#D7C4A3', charcoal: '#4B4F52',
  'off-white': '#F5F0E4', orange: '#DD883D', burgundy: '#7E354C', cream: '#F4E8C9',
  gold: '#C5A24E', lavender: '#B5A0CF', yellow: '#E6C85F', purple: '#8662A4', tan: '#BD9875',
};
