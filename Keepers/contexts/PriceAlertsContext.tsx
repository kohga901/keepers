import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { AppState } from 'react-native';
import { getPriceAlertState, type PriceAlert, type PriceNotification } from '../services/priceAlertsService';

type PriceAlertsState = {
  userId: string;
  alerts: PriceAlert[];
  notifications: PriceNotification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  banner: PriceNotification | null;
  dismissBanner: (id: string) => void;
  refresh: () => Promise<void>;
};
const PriceAlertsContext = createContext<PriceAlertsState | null>(null);

export function PriceAlertsProvider({ userId, children }: { userId: string; children: ReactNode }) {
  const [data, setData] = useState({ alerts: [] as PriceAlert[], notifications: [] as PriceNotification[], unreadCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [banners, setBanners] = useState<PriceNotification[]>([]);
  const seen = useRef<Set<string> | null>(null);
  const newestDate = useRef(0);
  const request = useRef<AbortController | null>(null);
  const mounted = useRef(false);

  const refresh = useCallback(async () => {
    if (!mounted.current) return;
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    try {
      const next = await getPriceAlertState(userId, controller.signal);
      if (controller.signal.aborted) return;
      const known = seen.current;
      const fresh = known === null ? [] : next.notifications.filter(notification =>
        !notification.read_at && !known.has(notification.id) && Date.parse(notification.created_at) >= newestDate.current);
      seen.current ??= new Set();
      for (const notification of next.notifications) {
        seen.current.add(notification.id);
        newestDate.current = Math.max(newestDate.current, Date.parse(notification.created_at) || 0);
      }
      // Keep the first successful load quiet; older inbox rows revealed by deletion stay quiet too.
      const unreadIds = new Set(next.notifications.filter(notification => !notification.read_at).map(notification => notification.id));
      setBanners(current => [...current.filter(notification => unreadIds.has(notification.id)), ...fresh.reverse()]);
      setData(next);
      setError(null);
    } catch (failure) {
      if (!controller.signal.aborted) setError(failure instanceof Error ? failure.message : 'Price alerts could not be loaded.');
    } finally {
      if (!controller.signal.aborted) setLoading(false);
    }
  }, [userId]);

  const dismissBanner = useCallback((id: string) => setBanners(current => current.filter(notification => notification.id !== id)), []);

  useEffect(() => {
    mounted.current = true;
    void refresh();
    const interval = setInterval(() => {
      if (AppState.currentState === 'active') void refresh();
    }, 60000);
    const subscription = AppState.addEventListener('change', state => {
      if (state === 'active') void refresh();
      else { request.current?.abort(); setBanners([]); }
    });
    return () => {
      mounted.current = false;
      clearInterval(interval);
      subscription.remove();
      request.current?.abort();
    };
  }, [refresh]);

  return <PriceAlertsContext.Provider value={{ userId, ...data, loading, error, refresh, banner: banners[0] ?? null, dismissBanner }}>{children}</PriceAlertsContext.Provider>;
}

export function usePriceAlerts() {
  const value = useContext(PriceAlertsContext);
  if (!value) throw new Error('PriceAlertsProvider is missing.');
  return value;
}
