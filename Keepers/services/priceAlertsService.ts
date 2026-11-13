import { supabase } from '../utils/supabase';

type AlertItem = { item_name: string; item_price: string | null };
export type PriceAlert = {
  clothes_id: number;
  target_price: number;
  direction: 'increase' | 'decrease';
  Clothing: AlertItem | null;
};
export type PriceNotification = {
  id: string;
  clothes_id: number;
  item_name: string;
  price: number;
  target_price: number;
  direction: 'increase' | 'decrease' | null;
  created_at: string;
  read_at: string | null;
};

function checkError(error: { code?: string; message: string } | null) {
  if (!error) return;
  if (['42P01', 'PGRST202', 'PGRST205'].includes(error.code ?? '')) {
    throw new Error('Price alerts are not available yet. Please contact the Keepers team.');
  }
  throw new Error(error.code === 'P0001' ? error.message : 'Price alerts could not be updated. Check your connection and try again.');
}

export async function getPriceAlertState(userId: string, signal: AbortSignal) {
  const alerts: PriceAlert[] = [];
  // A user's saved alerts can exceed the database's single-response limit.
  for (let offset = 0; ; offset += 500) {
    const { data, error } = await supabase.from('Price_Alerts')
      .select('clothes_id, target_price, direction, Clothing(item_name, item_price)')
      .eq('user_id', userId).eq('active', true).order('clothes_id')
      .range(offset, offset + 499).abortSignal(signal);
    checkError(error);
    alerts.push(...(data ?? []) as unknown as PriceAlert[]);
    if ((data ?? []).length < 500) break;
  }
  const [notifications, unread] = await Promise.all([
    supabase.from('Price_Notifications')
      .select('id, clothes_id, item_name, price, target_price, direction, created_at, read_at')
      .eq('user_id', userId).is('dismissed_at', null).order('created_at', { ascending: false }).order('id')
      .limit(50).abortSignal(signal),
    supabase.from('Price_Notifications').select('id', { count: 'exact', head: true })
      .eq('user_id', userId).is('read_at', null).is('dismissed_at', null).abortSignal(signal),
  ]);
  checkError(notifications.error);
  checkError(unread.error);
  return { alerts, notifications: (notifications.data ?? []) as PriceNotification[], unreadCount: unread.count ?? 0 };
}

export async function savePriceAlert(itemId: string, target: number) {
  const { error } = await supabase.rpc('set_price_alert', { p_clothes_id: itemId, p_target_price: target });
  checkError(error);
}

export async function deletePriceAlert(userId: string, itemId: string) {
  const { error } = await supabase.from('Price_Alerts').delete()
    .eq('user_id', userId).eq('clothes_id', itemId);
  checkError(error);
}

export async function markPriceNotificationsRead(userId: string, id?: string) {
  let query = supabase.from('Price_Notifications').update({ read_at: new Date().toISOString() })
    .eq('user_id', userId).is('read_at', null).is('dismissed_at', null);
  if (id) query = query.eq('id', id);
  const { error } = await query;
  checkError(error);
}

export async function clearPriceNotifications(userId: string, id?: string) {
  let query = supabase.from('Price_Notifications').update({ dismissed_at: new Date().toISOString() })
    .eq('user_id', userId).is('dismissed_at', null);
  if (id) query = query.eq('id', id);
  const { error } = await query;
  checkError(error);
}
