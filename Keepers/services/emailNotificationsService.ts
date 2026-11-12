import { supabase } from '../utils/supabase';

const failureMessage = 'Email notification settings could not be updated. Check your connection and try again.';

export async function getEmailNotificationsEnabled(): Promise<boolean> {
  const { data, error } = await supabase.rpc('get_price_alert_email_enabled');
  if (error || typeof data !== 'boolean') throw new Error(failureMessage);
  return data;
}

export async function setEmailNotificationsEnabled(enabled: boolean): Promise<void> {
  const { error } = await supabase.rpc('set_price_alert_email_enabled', { p_enabled: enabled });
  if (error) throw new Error(failureMessage);
}
