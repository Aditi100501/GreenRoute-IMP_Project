import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = 'https://semamvssguucejabdafl.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_VwUchHG4YiNN7P8mdqz1Sg_X-vg_86t';

export const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});