import Browser from "webextension-polyfill"
import { StateStorage } from "zustand/middleware"

export interface CustomStateStorage extends StateStorage {
  updateItem: (name: string, value: string) => Promise<void>
  getField: (name: string, field: string) => Promise<string | null>
  setField: (name: string, field: string, value: any) => Promise<void>
  getFields: (stores: {
    [key: string]: string[]
  }) => Promise<{ [key: string]: any }>
  setState: (state: any) => void
}

let cachedStorage: { [key: string]: string } = {}

Browser.storage.local.get().then((store) => {
  cachedStorage = store
})

// Custom storage object
export const storage: CustomStateStorage = {
  getField: async (name: string, field: string): Promise<string | null> => {
    const store = await Browser.storage.local.get(name)
    const res = store[name]
    const parsed = JSON.parse(res || "{}")
    return parsed?.state?.[field] || null
  },
  setField: async (name: string, field: string, value: any): Promise<void> => {
    const store = await Browser.storage.local.get(name)
    const res = store[name]
    const parsed = JSON.parse(res || '{"state":{}}')

    // Ensure state object exists
    if (!parsed.state) {
      parsed.state = {}
    }

    // Set the field value
    parsed.state[field] = value

    // Save back to storage
    const serialized = JSON.stringify(parsed)
    await Browser.storage.local.set({ [name]: serialized })
    cachedStorage[name] = serialized
  },
  getItem: async (name: string): Promise<string | null> => {
    // console.debug(name, "has been retrieved")
    const res = await Browser.storage.local.get(name)
    // console.debug(name, "has been retrieved", res)
    return res[name] || null
  },
  setItem: async (name: string, value: string): Promise<void> => {
    if (cachedStorage[name] === value) {
      // console.debug(name, " is already saved")
      return
    }

    // console.debug(name, "with value", value, "has been saved")
    const obj = { [name]: value }
    await Browser.storage.local.set(obj)
    cachedStorage = { ...cachedStorage, ...obj }
  },
  removeItem: async (name: string): Promise<void> => {
    // console.debug(name, "has been deleted")
    await Browser.storage.local.remove(name)
    delete cachedStorage[name]
  },
  updateItem: async (name: string, value: string): Promise<void> => {
    // console.debug(name, "with value", value, "has been updated")
    const item = await storage.getItem(name) as any
    // update item's name with new value
    if (item && item[name]) {
      item[name] = value
      await storage.setItem(name, item as any)
      cachedStorage[name] = value
    }
  },
  getFields: async (stores: {
    [key: string]: string[]
  }): Promise<{ [key: string]: any }> => {
    const result: { [key: string]: any } = {}

    for (const [storeName, fields] of Object.entries(stores)) {
      const store = await Browser.storage.local.get(storeName)
      const storeData = store[storeName]

      if (storeData) {
        try {
          const parsed = JSON.parse(storeData)
          for (const field of fields) {
            if (parsed?.state?.[field] !== undefined) {
              result[field] = parsed.state[field]
            }
          }
        } catch (e) {
          // Skip invalid JSON
          continue
        }
      }
    }

    return result
  },
  setState: (_state: any) => {
    // No-op: setState is not used in background context
  },
}
