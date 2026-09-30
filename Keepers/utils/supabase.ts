import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { PUBLIC_CONFIG } from '@/public-config'

export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL ?? PUBLIC_CONFIG.supabaseUrl,
  process.env.EXPO_PUBLIC_SUPABASE_KEY ?? PUBLIC_CONFIG.supabaseKey,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  })