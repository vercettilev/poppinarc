import { useQuery } from "@tanstack/react-query"

interface GeoLocationResult {
  countryCode: string
  countryName: string
  city?: string
  region?: string
}

/**
 * Fetches geo-location data from multiple providers with fallback
 * Returns null if all providers fail (fail-open approach)
 */
async function fetchGeoLocation(): Promise<GeoLocationResult | null> {
  // Try ipapi.co first
  try {
    const response = await fetch("https://ipapi.co/json/", {
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) {
      const data = await response.json()
      if (!data.error) {
        return {
          countryCode: data.country_code || data.country,
          countryName: data.country_name,
          city: data.city,
          region: data.region,
        }
      }
    }
  } catch {
    // Fall through to next provider
  }

  // Try ip-api.com as fallback
  try {
    const response = await fetch("http://ip-api.com/json/", {
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) {
      const data = await response.json()
      if (data.status !== "fail") {
        return {
          countryCode: data.countryCode,
          countryName: data.country,
          city: data.city,
          region: data.regionName,
        }
      }
    }
  } catch {
    // Fall through to next provider
  }

  // Try ipinfo.io as last fallback
  try {
    const response = await fetch("https://ipinfo.io/json", {
      signal: AbortSignal.timeout(5000),
    })
    if (response.ok) {
      const data = await response.json()
      if (!data.bogon) {
        return {
          countryCode: data.country,
          countryName: data.country, // ipinfo only returns code
          city: data.city,
          region: data.region,
        }
      }
    }
  } catch {
    // All providers failed
  }

  // Return null if all providers fail - we'll treat this as "not US" (fail-open)
  return null
}

/**
 * Hook to get the user's geo-location
 */
export function useGeoLocation() {
  return useQuery({
    queryKey: ["geo-location"],
    queryFn: fetchGeoLocation,
    staleTime: 1000 * 60 * 60, // 1 hour - location doesn't change often
    gcTime: 1000 * 60 * 60 * 24, // 24 hours cache
    retry: 1,
    // Don't throw on error - we want fail-open behavior
    throwOnError: false,
  })
}

/**
 * Hook to check if the user is from the US
 * Returns { isUS, isLoading, error }
 *
 * IMPORTANT: Uses fail-open approach - if geo-location fails,
 * we assume user is NOT in the US to avoid blocking legitimate users
 */
export function useIsUSUser() {
  const { data, isLoading, error } = useGeoLocation()

  // DEBUG: Force US for testing geo-blocking
  const DEBUG_FORCE_US = false

  // Fail-open: if there's an error or no data, assume NOT US
  const isUS = DEBUG_FORCE_US || (!error && data?.countryCode === "US")

  return {
    isUS,
    isLoading: DEBUG_FORCE_US ? false : isLoading,
    error,
    countryCode: DEBUG_FORCE_US ? "US" : (data?.countryCode ?? null),
  }
}
