import { dataProvider as supabaseDataProvider } from "@refinedev/supabase"
import type { DataProvider } from "@refinedev/core"
import { createClient } from "@supabase/supabase-js"

function getDataProvider(): DataProvider {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

  if (!url || !key || !url.startsWith("http")) {
    // Return a no-op data provider when Supabase isn't configured
    return {
      getList: async () => ({ data: [], total: 0 }),
      getOne: async () => ({ data: {} as never }),
      create: async () => ({ data: {} as never }),
      update: async () => ({ data: {} as never }),
      deleteOne: async () => ({ data: {} as never }),
      getApiUrl: () => "",
      custom: async () => ({ data: {} as never }),
    }
  }

  const supabaseClient = createClient(url, key)
  return supabaseDataProvider(supabaseClient)
}

export const dataProvider = getDataProvider()
