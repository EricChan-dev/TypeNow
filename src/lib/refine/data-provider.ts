import type { DataProvider } from "@refinedev/core"

const API_BASE = "/api/admin"

function resourceUrl(resource: string, id?: string | number) {
  return id != null ? `${API_BASE}/${resource}/${id}` : `${API_BASE}/${resource}`
}

async function request<T>(url: string, options?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options?.headers ?? {}) },
  })
  const json = await res.json()
  if (!res.ok) throw new Error(json?.error ?? "Request failed")
  return json
}

export const dataProvider: DataProvider = {
  getList: async ({ resource, pagination, filters, sorters }) => {
    const page = pagination?.currentPage ?? 1
    const pageSize = pagination?.pageSize ?? 20
    const params = new URLSearchParams({
      current: String(page),
      pageSize: String(pageSize),
    })
    if (filters?.length) {
      for (const f of filters) {
        if ("field" in f && f.value != null && f.value !== "") {
          params.set(f.field, String(f.value))
        }
      }
    }
    if (sorters?.length) {
      params.set("sort", sorters[0].field)
      params.set("order", sorters[0].order)
    }
    const json = await request<{ data: unknown[]; total: number }>(
      `${resourceUrl(resource)}?${params}`
    )
    return { data: json.data as never[], total: json.total ?? json.data.length }
  },

  getOne: async ({ resource, id }) => {
    const json = await request<{ data: unknown }>(`${resourceUrl(resource, id)}`)
    return { data: json.data as never }
  },

  create: async ({ resource, variables }) => {
    const json = await request<{ data: unknown }>(resourceUrl(resource), {
      method: "POST",
      body: JSON.stringify(variables),
    })
    return { data: json.data as never }
  },

  update: async ({ resource, id, variables }) => {
    const json = await request<{ data: unknown }>(resourceUrl(resource, id), {
      method: "PUT",
      body: JSON.stringify(variables),
    })
    return { data: json.data as never }
  },

  deleteOne: async ({ resource, id }) => {
    const json = await request<{ data: unknown }>(resourceUrl(resource, id), {
      method: "DELETE",
    })
    return { data: json.data as never }
  },

  getApiUrl: () => API_BASE,
}
