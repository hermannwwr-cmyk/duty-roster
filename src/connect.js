// Picks the data store: Supabase when config.js has project details, otherwise browser-only demo mode.
import { SUPABASE_URL, SUPABASE_ANON_KEY } from '../config.js';
import { SupabaseStore, DemoStore } from './store.js';

export async function createStore() {
  if (SUPABASE_URL && SUPABASE_ANON_KEY) {
    const { createClient } = await import('https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.45.4/+esm');
    return new SupabaseStore(createClient, SUPABASE_URL, SUPABASE_ANON_KEY);
  }
  return new DemoStore();
}
