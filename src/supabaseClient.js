import { createClient } from "@supabase/supabase-js";

// Guarda o trecho da URL logo na largada: links de convite e de redefinição de senha
// chegam com "type=invite" ou "type=recovery", e a biblioteca limpa isso da URL em seguida.
export const HASH_INICIAL = typeof window !== "undefined" ? window.location.hash : "";

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL;
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY;

export const supabase = createClient(supabaseUrl, supabaseAnonKey);
