import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';

import { supabase } from '../utils/supabase';

const VECTOR_DIMENSION = 512;
const ALPHA_LIKE = 0.08;
const ALPHA_DISLIKE = 0.06;
const GAMMA = 0.002;
const MAX_QUEUE_ITEMS = 200;

type SwipeAction = 'like' | 'dislike';
type QueueStatus = 'pending' | 'synced' | 'failed';

type Coordinates2D = {
  x: number;
  y: number;
};

export type GraphPoint = {
  id: string;
  x: number;
  y: number;
  name: string;
  price: string;
  imageUrl: string;
  itemUrl: string;
};

type ProjectionMetadata = {
  version: string;
  mean: Float32Array | null;
  components: [Float32Array, Float32Array] | null;
  centroid: Float32Array | null;
};

type SwipeQueueItem = {
  clientEventId: string;
  itemId: string;
  action: SwipeAction;
  createdAt: string;
  status: QueueStatus;
};

type EmbeddingGraphContextValue = {
  graphPoints: GraphPoint[];
  graphPointMap: Map<string, GraphPoint>;
  userPosition: Coordinates2D | null;
  userVector: Float32Array | null;
  projectionVersion: string;
  pendingEvents: SwipeQueueItem[];
  pendingSyncCount: number;
  isGraphLoading: boolean;
  graphError: string | null;
  refreshGraphData: () => Promise<void>;
  applySwipeFeedback: (itemId: string, action: SwipeAction) => Promise<void>;
};

const EmbeddingGraphContext = createContext<EmbeddingGraphContextValue | null>(null);

type EmbeddingGraphProviderProps = {
  children: React.ReactNode;
  userId: string | null;
};

type AnyRow = Record<string, unknown>;

function toFiniteNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === 'string') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function toStringSafe(value: unknown, fallback = ''): string {
  if (typeof value === 'string') {
    return value;
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return String(value);
  }

  return fallback;
}

function parseVector(
  value: unknown,
  expectedLength = VECTOR_DIMENSION,
  normalize = false,
): Float32Array | null {
  if (!Array.isArray(value) || value.length === 0) {
    return null;
  }

  const next = new Float32Array(expectedLength);
  const limit = Math.min(expectedLength, value.length);

  for (let index = 0; index < limit; index += 1) {
    const numericValue = toFiniteNumber(value[index]);
    if (numericValue === null) {
      return null;
    }

    next[index] = numericValue;
  }

  if (normalize) {
    return normalizeVector(next);
  }

  return next;
}

function parseComponents(value: unknown): [Float32Array, Float32Array] | null {
  if (!Array.isArray(value) || value.length !== 2) {
    return null;
  }

  const firstComponent = parseVector(value[0], VECTOR_DIMENSION, false);
  const secondComponent = parseVector(value[1], VECTOR_DIMENSION, false);

  if (!firstComponent || !secondComponent) {
    return null;
  }

  return [firstComponent, secondComponent];
}

function normalizeVector(vector: Float32Array): Float32Array {
  let normSquared = 0;

  for (let index = 0; index < vector.length; index += 1) {
    normSquared += vector[index] * vector[index];
  }

  const norm = Math.sqrt(normSquared);
  if (!Number.isFinite(norm) || norm <= 0) {
    return vector;
  }

  const normalized = new Float32Array(vector.length);
  for (let index = 0; index < vector.length; index += 1) {
    normalized[index] = vector[index] / norm;
  }

  return normalized;
}

function dotProduct(first: Float32Array, second: Float32Array): number {
  const limit = Math.min(first.length, second.length);
  let result = 0;

  for (let index = 0; index < limit; index += 1) {
    result += first[index] * second[index];
  }

  return result;
}

function hashToUnitRange(source: string): number {
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  const normalized = (hash >>> 0) / 4294967295;
  return normalized * 2 - 1;
}

function extractCoordinates(row: AnyRow): Coordinates2D | null {
  const keyPairs: [string, string][] = [
    ['x', 'y'],
    ['point_x', 'point_y'],
    ['proj_x', 'proj_y'],
    ['x_coord', 'y_coord'],
    ['coord_x', 'coord_y'],
  ];

  for (const [xKey, yKey] of keyPairs) {
    const x = toFiniteNumber(row[xKey]);
    const y = toFiniteNumber(row[yKey]);

    if (x !== null && y !== null) {
      return { x, y };
    }
  }

  return null;
}

function createClientEventId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function projectVectorTo2D(vector: Float32Array, projection: ProjectionMetadata): Coordinates2D {
  if (projection.mean && projection.components) {
    const [xComponent, yComponent] = projection.components;
    let x = 0;
    let y = 0;

    for (let index = 0; index < VECTOR_DIMENSION; index += 1) {
      const centered = vector[index] - projection.mean[index];
      x += centered * xComponent[index];
      y += centered * yComponent[index];
    }

    return { x, y };
  }

  return {
    x: vector[0] ?? 0,
    y: vector[1] ?? 0,
  };
}

function evolveUserVector(
  currentUserVector: Float32Array,
  itemVector: Float32Array,
  action: SwipeAction,
  centroid: Float32Array,
): Float32Array {
  const next = new Float32Array(VECTOR_DIMENSION);

  if (action === 'like') {
    for (let index = 0; index < VECTOR_DIMENSION; index += 1) {
      next[index] =
        (1 - GAMMA) * currentUserVector[index] +
        GAMMA * centroid[index] +
        ALPHA_LIKE * itemVector[index];
    }

    return normalizeVector(next);
  }

  const similarity = Math.max(0, dotProduct(currentUserVector, itemVector));

  for (let index = 0; index < VECTOR_DIMENSION; index += 1) {
    next[index] =
      (1 - GAMMA) * currentUserVector[index] +
      GAMMA * centroid[index] -
      ALPHA_DISLIKE * similarity * itemVector[index];
  }

  return normalizeVector(next);
}

function vectorToArray(vector: Float32Array): number[] {
  return Array.from(vector);
}

const FALLBACK_PROJECTION: ProjectionMetadata = {
  version: 'fallback-v1',
  mean: null,
  components: null,
  centroid: null,
};

export function EmbeddingGraphProvider({ children, userId }: EmbeddingGraphProviderProps) {
  const [graphPoints, setGraphPoints] = useState<GraphPoint[]>([]);
  const [userPosition, setUserPosition] = useState<Coordinates2D | null>(null);
  const [userVector, setUserVector] = useState<Float32Array | null>(null);
  const [projectionVersion, setProjectionVersion] = useState(FALLBACK_PROJECTION.version);
  const [pendingEvents, setPendingEvents] = useState<SwipeQueueItem[]>([]);
  const [isGraphLoading, setIsGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);

  const projectionRef = useRef<ProjectionMetadata>(FALLBACK_PROJECTION);
  const userVectorRef = useRef<Float32Array | null>(null);
  const centroidRef = useRef<Float32Array>(new Float32Array(VECTOR_DIMENSION));
  const embeddingCacheRef = useRef<Map<string, Float32Array>>(new Map());

  const setUserState = useCallback((nextVector: Float32Array) => {
    userVectorRef.current = nextVector;
    setUserVector(nextVector);
    setUserPosition(projectVectorTo2D(nextVector, projectionRef.current));
  }, []);

  const markQueueItemStatus = useCallback((eventId: string, status: QueueStatus) => {
    setPendingEvents((previousItems) =>
      previousItems.map((item) => {
        if (item.clientEventId !== eventId) {
          return item;
        }

        return {
          ...item,
          status,
        };
      }),
    );
  }, []);

  const fetchProjectionMetadata = useCallback(async (): Promise<ProjectionMetadata> => {
    const selectOptions = [
      'projection_version,mean_512,components_2x512,catalog_centroid_512',
      'projection_version,pca_mean,pca_components,catalog_centroid',
      'version,pca_mean,pca_components,catalog_centroid',
    ];

    for (const selectClause of selectOptions) {
      const { data, error } = await supabase
        .from('ProjectionMetadata')
        .select(selectClause)
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        continue;
      }

      const row = data as AnyRow;
      const version =
        toStringSafe(row.projection_version) ||
        toStringSafe(row.version) ||
        FALLBACK_PROJECTION.version;

      const mean =
        parseVector(row.mean_512, VECTOR_DIMENSION, false) ||
        parseVector(row.pca_mean, VECTOR_DIMENSION, false);

      const components = parseComponents(row.components_2x512) || parseComponents(row.pca_components);

      const centroid =
        parseVector(row.catalog_centroid_512, VECTOR_DIMENSION, true) ||
        parseVector(row.catalog_centroid, VECTOR_DIMENSION, true);

      return {
        version,
        mean,
        components,
        centroid,
      };
    }

    return FALLBACK_PROJECTION;
  }, []);

  const fetchCoordinates = useCallback(async (): Promise<Map<string, Coordinates2D>> => {
    const coordinateMap = new Map<string, Coordinates2D>();

    const selectOptions = [
      'item_id,x,y',
      'item_id,point_x,point_y',
      'item_id,proj_x,proj_y',
      'item_id,x_coord,y_coord',
      'item_id,coord_x,coord_y',
    ];

    for (const selectClause of selectOptions) {
      const { data, error } = await supabase
        .from('Embeddings')
        .select(selectClause)
        .range(0, 5000);

      if (error || !data) {
        continue;
      }

      for (const item of data as AnyRow[]) {
        const itemId = toStringSafe(item.item_id);
        if (!itemId) {
          continue;
        }

        const coordinates = extractCoordinates(item);
        if (coordinates) {
          coordinateMap.set(itemId, coordinates);
        }
      }

      return coordinateMap;
    }

    return coordinateMap;
  }, []);

  const fetchUserVector = useCallback(async (): Promise<Float32Array | null> => {
    if (!userId) {
      return null;
    }

    const selectOptions = [
      'user_id,vector_512,vector_revision',
      'user_id,user_vec_512,vector_revision',
      'user_id,preference_vector,vector_revision',
    ];

    for (const selectClause of selectOptions) {
      const { data, error } = await supabase
        .from('UserProfiles')
        .select(selectClause)
        .eq('user_id', userId)
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        continue;
      }

      const row = data as AnyRow;
      const parsedVector =
        parseVector(row.vector_512, VECTOR_DIMENSION, true) ||
        parseVector(row.user_vec_512, VECTOR_DIMENSION, true) ||
        parseVector(row.preference_vector, VECTOR_DIMENSION, true);

      if (parsedVector) {
        return parsedVector;
      }
    }

    return null;
  }, [userId]);

  const fetchItemEmbedding = useCallback(async (itemId: string): Promise<Float32Array | null> => {
    const cachedEmbedding = embeddingCacheRef.current.get(itemId);
    if (cachedEmbedding) {
      return cachedEmbedding;
    }

    const numericItemId = Number(itemId);

    const queries = Number.isFinite(numericItemId)
      ? [
          supabase.from('Embeddings').select('item_id,embedding').eq('item_id', numericItemId).maybeSingle(),
          supabase.from('Embeddings').select('item_id,embedding').eq('item_id', itemId).maybeSingle(),
        ]
      : [supabase.from('Embeddings').select('item_id,embedding').eq('item_id', itemId).maybeSingle()];

    for (const query of queries) {
      const { data, error } = await query;

      if (error || !data) {
        continue;
      }

      const row = data as AnyRow;
      const parsed = parseVector(row.embedding, VECTOR_DIMENSION, true);
      if (!parsed) {
        continue;
      }

      embeddingCacheRef.current.set(itemId, parsed);
      return parsed;
    }

    return null;
  }, []);

  const persistSwipeEvent = useCallback(
    async (event: SwipeQueueItem, nextVector: Float32Array) => {
      if (!userId) {
        return;
      }

      let hasError = false;

      const { error: swipeError } = await supabase.from('SwipeEvents').insert({
        client_event_id: event.clientEventId,
        user_id: userId,
        item_id: event.itemId,
        action: event.action,
        projection_version: projectionRef.current.version,
        client_created_at: event.createdAt,
      });

      if (swipeError) {
        hasError = true;
      }

      const upsertPayloadOptions = [
        {
          user_id: userId,
          vector_512: vectorToArray(nextVector),
          vector_revision: Date.now(),
        },
        {
          user_id: userId,
          user_vec_512: vectorToArray(nextVector),
          vector_revision: Date.now(),
        },
      ];

      let userVectorSaved = false;
      for (const payload of upsertPayloadOptions) {
        const { error } = await supabase.from('UserProfiles').upsert(payload);
        if (!error) {
          userVectorSaved = true;
          break;
        }
      }

      if (!userVectorSaved) {
        hasError = true;
      }

      markQueueItemStatus(event.clientEventId, hasError ? 'failed' : 'synced');
    },
    [markQueueItemStatus, userId],
  );

  const applySwipeFeedback = useCallback(
    async (itemId: string, action: SwipeAction) => {
      if (!userId || !itemId) {
        return;
      }

      const itemEmbedding = await fetchItemEmbedding(itemId);
      if (!itemEmbedding) {
        return;
      }

      const centroid = centroidRef.current;
      const coldStartVector = normalizeVector(
        centroid.some((entry) => entry !== 0) ? new Float32Array(centroid) : new Float32Array(itemEmbedding),
      );

      const currentUserVector = userVectorRef.current ?? coldStartVector;
      const nextUserVector = evolveUserVector(currentUserVector, itemEmbedding, action, centroid);
      setUserState(nextUserVector);

      const event: SwipeQueueItem = {
        clientEventId: createClientEventId(),
        itemId,
        action,
        createdAt: new Date().toISOString(),
        status: 'pending',
      };

      setPendingEvents((previousEvents) => {
        const nextEvents = [...previousEvents, event];
        if (nextEvents.length <= MAX_QUEUE_ITEMS) {
          return nextEvents;
        }

        return nextEvents.slice(nextEvents.length - MAX_QUEUE_ITEMS);
      });

      void persistSwipeEvent(event, nextUserVector);
    },
    [fetchItemEmbedding, persistSwipeEvent, setUserState, userId],
  );

  const refreshGraphData = useCallback(async () => {
    if (!userId) {
      setGraphPoints([]);
      setUserVector(null);
      setUserPosition(null);
      setPendingEvents([]);
      setGraphError(null);
      embeddingCacheRef.current.clear();
      return;
    }

    setIsGraphLoading(true);
    setGraphError(null);

    try {
      const [projectionMetadata, coordinateMap, clothingResult, existingUserVector] = await Promise.all([
        fetchProjectionMetadata(),
        fetchCoordinates(),
        supabase
          .from('Clothing')
          .select('item_id,item_name,item_price,item_img,item_web_listing')
          .range(0, 5000),
        fetchUserVector(),
      ]);

      projectionRef.current = projectionMetadata;
      setProjectionVersion(projectionMetadata.version);

      if (projectionMetadata.centroid) {
        centroidRef.current = projectionMetadata.centroid;
      } else {
        centroidRef.current = new Float32Array(VECTOR_DIMENSION);
      }

      if (clothingResult.error || !clothingResult.data) {
        throw clothingResult.error ?? new Error('Could not load clothing dataset.');
      }

      const points = (clothingResult.data as AnyRow[]).map((row) => {
        const id = toStringSafe(row.item_id);
        const coordinates = coordinateMap.get(id) ?? {
          x: hashToUnitRange(`${id}-x`),
          y: hashToUnitRange(`${id}-y`),
        };

        return {
          id,
          x: coordinates.x,
          y: coordinates.y,
          name: toStringSafe(row.item_name, 'Unknown Item'),
          price: toStringSafe(row.item_price, 'Price unavailable'),
          imageUrl: toStringSafe(row.item_img),
          itemUrl: toStringSafe(row.item_web_listing),
        };
      });

      setGraphPoints(points);

      if (existingUserVector) {
        setUserState(existingUserVector);
      } else {
        setUserVector(null);
        setUserPosition(null);
        userVectorRef.current = null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load graph data.';
      setGraphError(message);
    } finally {
      setIsGraphLoading(false);
    }
  }, [fetchCoordinates, fetchProjectionMetadata, fetchUserVector, setUserState, userId]);

  useEffect(() => {
    void refreshGraphData();
  }, [refreshGraphData]);

  useEffect(() => {
    if (!userId) {
      return;
    }

    const syncInterval = setInterval(() => {
      void fetchUserVector().then((remoteVector) => {
        if (!remoteVector) {
          return;
        }

        setUserState(remoteVector);
      });
    }, 45000);

    return () => {
      clearInterval(syncInterval);
    };
  }, [fetchUserVector, setUserState, userId]);

  const graphPointMap = useMemo(() => {
    return new Map(graphPoints.map((point) => [point.id, point]));
  }, [graphPoints]);

  const pendingSyncCount = useMemo(() => {
    return pendingEvents.filter((item) => item.status !== 'synced').length;
  }, [pendingEvents]);

  const value = useMemo<EmbeddingGraphContextValue>(() => {
    return {
      graphPoints,
      graphPointMap,
      userPosition,
      userVector,
      projectionVersion,
      pendingEvents,
      pendingSyncCount,
      isGraphLoading,
      graphError,
      refreshGraphData,
      applySwipeFeedback,
    };
  }, [
    applySwipeFeedback,
    graphError,
    graphPointMap,
    graphPoints,
    isGraphLoading,
    pendingEvents,
    pendingSyncCount,
    projectionVersion,
    refreshGraphData,
    userPosition,
    userVector,
  ]);

  return <EmbeddingGraphContext.Provider value={value}>{children}</EmbeddingGraphContext.Provider>;
}

export function useEmbeddingGraph() {
  const context = useContext(EmbeddingGraphContext);

  if (!context) {
    throw new Error('useEmbeddingGraph must be used within an EmbeddingGraphProvider.');
  }

  return context;
}
