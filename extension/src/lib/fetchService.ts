// fetchService.ts

/**
 * The one code every surface can test for: this page's bridge to the
 * extension is gone and a reload is the only cure.
 */
export const STALE_CONTEXT = "poppin/stale-context"

interface ApiRequestParams {
  url: string
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH"
  data?: any
  params?: any
  apiType?: "backend" | "next"
  headers?: Record<string, string>
}

export const sendApiRequest = async <T>({
  url,
  method,
  data,
  params,
  apiType,
  headers,
}: ApiRequestParams): Promise<T> => {
  /**
   * THE PAGE CAN OUTLIVE THE EXTENSION.
   *
   * Every request here leaves through the background. When the extension
   * is updated or reloaded, tabs that were already open keep running the
   * OLD content script against a context that no longer exists:
   * sendMessage throws "Extension context invalidated" (or resolves
   * undefined), and until this branch existed the failure arrived as a
   * shapeless TypeError that every caller reported as a generic build
   * failure. It is not one — nothing this page sends will ever reach the
   * network again, and the only fix is a reload. Say so, in a shape the
   * money surfaces can recognise and translate.
   */
  let response: { error?: unknown; data?: T } | undefined
  try {
    response = await chrome.runtime.sendMessage({
      type: "API_REQUEST",
      payload: { url, method, data, params, apiType, headers },
    })
  } catch {
    throw { code: STALE_CONTEXT, message: "Poppin updated · Reload the page" }
  }
  if (!response) {
    throw { code: STALE_CONTEXT, message: "Poppin updated · Reload the page" }
  }

  if (response.error) {
    throw response.error
  }

  return response.data as T
}
