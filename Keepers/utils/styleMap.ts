export type MapPoint = { clothesId: number; x: number; y: number };
export type Position = { x: number; y: number };
export type Camera = Position & { scale: number };
export type MapMode = 'focus' | 'whole';
export type MapLayout = { width: number; height: number; top: number; bottom: number };
export type PreviewPoint = Position & { clothesId: number };
export type MapFrame = {
  type: 'frame'; mode: MapMode; count: number; nearTaste: boolean;
  previews: PreviewPoint[]; taste: Position | null;
};

export function validMapPosition(value: unknown): value is Position {
    if (!value || typeof value !== 'object') return false;
    const p = value as Position;
    return typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y);
  }

export function normalizeMapPoints(raw: unknown): MapPoint[] {
    const result: MapPoint[] = [];
    if (!Array.isArray(raw)) return result;
    const seen = new Set<number>();
    for (let i = 0; i < raw.length; i++) {
      const p = raw[i] as MapPoint;
      if (!validMapPosition(p) || !Number.isSafeInteger(p.clothesId) || p.clothesId <= 0 || seen.has(p.clothesId)) continue;
      seen.add(p.clothesId);
      result.push({ clothesId: p.clothesId, x: p.x, y: p.y });
    }
    return result;
  }

// Hermes discards function bodies; the WebView must receive literal script text.
export const MAP_GEOMETRY_SOURCE = String.raw`function createMapGeometry() {
    function validPosition(value) {
        if (!value || typeof value !== 'object')
            return false;
        const p = value;
        return typeof p.x === 'number' && Number.isFinite(p.x) && typeof p.y === 'number' && Number.isFinite(p.y);
    }
    function normalize(raw) {
        const result = [];
        if (!Array.isArray(raw))
            return result;
        const seen = new Set();
        for (let i = 0; i < raw.length; i++) {
            const p = raw[i];
            if (!validPosition(p) || !Number.isSafeInteger(p.clothesId) || p.clothesId <= 0 || seen.has(p.clothesId))
                continue;
            seen.add(p.clothesId);
            result.push({ clothesId: p.clothesId, x: p.x, y: p.y });
        }
        return result;
    }
    function origin(layout, mode) {
        return { x: mode === 'focus' ? (layout.width - 38) / 2 : layout.width / 2,
            y: mode === 'focus' ? layout.height / 2 : (layout.top + layout.height - layout.bottom) / 2 };
    }
    function radius(layout) {
        // Dock and notice insets only exclude previews; they must not move or resize the lens.
        return Math.max(12, Math.min(118, (layout.width - 70) / 2, (layout.height - 16) / 2));
    }
    function project(p, camera, layout, mode) {
        const o = origin(layout, mode);
        return { x: (p.x - camera.x) * camera.scale + o.x, y: (camera.y - p.y) * camera.scale + o.y };
    }
    function unproject(p, camera, layout, mode) {
        const o = origin(layout, mode);
        return { x: (p.x - o.x) / camera.scale + camera.x, y: camera.y - (p.y - o.y) / camera.scale };
    }
    function fit(points, layout) {
        let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
        for (let i = 0; i < points.length; i++) {
            minX = Math.min(minX, points[i].x);
            maxX = Math.max(maxX, points[i].x);
            minY = Math.min(minY, points[i].y);
            maxY = Math.max(maxY, points[i].y);
        }
        if (!points.length)
            return { x: 0, y: 0, scale: 1 };
        return { x: (minX + maxX) / 2, y: (minY + maxY) / 2,
            scale: Math.max(.001, Math.min(Math.max(1, layout.width - 56) / Math.max(.001, maxX - minX), Math.max(1, layout.height - layout.top - layout.bottom - 40) / Math.max(.001, maxY - minY))) };
    }
    function zoom(camera, layout, mode, factor, anchor, min, max) {
        const p = unproject(anchor, camera, layout, mode), o = origin(layout, mode);
        const scale = Math.max(min, Math.min(max, camera.scale * factor));
        return { x: p.x - (anchor.x - o.x) / scale, y: p.y + (anchor.y - o.y) / scale, scale: scale };
    }
    function inFocus(p, camera, layout, mode) {
        return mode === 'whole' || Math.hypot(p.x - camera.x, p.y - camera.y) <= radius(layout) / camera.scale;
    }
    function tasteAnchor(preference, camera, layout, mode) {
        if (!preference)
            return null;
        const p = project(preference, camera, layout, mode);
        return p.x > 16 && p.x < layout.width - 100 && p.y > layout.top + 24 && p.y < layout.height - layout.bottom - 24 ? p : null;
    }
    function safePreview(p, layout, taste) {
        if (p.x < 28 || p.x > layout.width - 28 || p.y < layout.top + 28 || p.y > layout.height - layout.bottom - 28)
            return false;
        if (p.x > layout.width - 80 && p.y < layout.top + 126)
            return false;
        if (taste && p.x + 24 > taste.x - 18 && p.x - 24 < taste.x + 100 && p.y + 28 > taste.y - 25 && p.y - 28 < taste.y + 28)
            return false;
        return true;
    }
    function previews(points, camera, layout, mode, selectedId, preference) {
        const candidates = [], chosen = [];
        const taste = tasteAnchor(preference, camera, layout, mode);
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            if (!inFocus(p, camera, layout, mode))
                continue;
            const q = project(p, camera, layout, mode);
            if (safePreview(q, layout, taste))
                candidates.push({ clothesId: p.clothesId, x: q.x, y: q.y });
        }
        candidates.sort(function (a, b) {
            if (a.clothesId === selectedId)
                return -1;
            if (b.clothesId === selectedId)
                return 1;
            return ((a.clothesId * 2654435761) >>> 0) - ((b.clothesId * 2654435761) >>> 0);
        });
        for (let i = 0; i < candidates.length; i++) {
            const q = candidates[i];
            let collision = false;
            for (let j = 0; j < chosen.length; j++)
                if (Math.hypot(q.x - chosen[j].x, q.y - chosen[j].y) < 60)
                    collision = true;
            if (!collision)
                chosen.push(q);
            if (chosen.length >= (mode === 'focus' ? 7 : 11))
                break;
        }
        return chosen;
    }
    return { validPosition, normalize, origin, radius, project, unproject, fit, zoom, inFocus, tasteAnchor, safePreview, previews };
}`;

export function parseMapFrame(value: unknown, ids: Set<number>, layout: MapLayout): MapFrame | null {
  if (!value || typeof value !== 'object') return null;
  const f = value as MapFrame;
  if (f.type !== 'frame' || (f.mode !== 'focus' && f.mode !== 'whole') || typeof f.nearTaste !== 'boolean' ||
    !Number.isInteger(f.count) || f.count < 0 || f.count > ids.size || !Array.isArray(f.previews) ||
    f.previews.length > (f.mode === 'focus' ? 7 : 11)) return null;
  const seen = new Set<number>();
  for (const p of f.previews) {
    if (!validMapPosition(p) || !ids.has(p.clothesId) || seen.has(p.clothesId) || p.x < 0 || p.x > layout.width || p.y < 0 || p.y > layout.height) return null;
    seen.add(p.clothesId);
  }
  if (f.taste !== null && (!validMapPosition(f.taste) || f.taste.x < 0 || f.taste.x > layout.width || f.taste.y < 0 || f.taste.y > layout.height)) return null;
  return f;
}
