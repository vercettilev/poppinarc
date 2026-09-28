import { useInfiniteQuery, useQuery } from "@tanstack/react-query"
import { sendApiRequest } from "~/lib/fetchService"

interface GifCategory {
  searchterm: string
  path: string
  image: string
  name: string
}

interface GifResponse {
  results: Array<{
    id: string
    title: string
    media_formats: {
      tinygif: {
        url: string
      }
    }
  }>
  next: string | null
}

interface UseGifsParams {
  query: string
  limit?: number
}

// Mock API calls for now - replace with actual API implementation
const fetchGifs = async ({
  query,
  limit = 10,
  pageParam = "",
}: UseGifsParams & { pageParam?: any }): Promise<GifResponse> => {
  // Replace with actual API call
  return sendApiRequest<GifResponse>({
    url: "/tenor/search",
    method: "GET",
    params: {
      query,
      limit,
      pos: pageParam,
    },
  })
}

const fetchGifCategories = async (): Promise<{ tags: GifCategory[] }> => {
  // Replace with actual API call
  return sendApiRequest<{ tags: GifCategory[] }>({
    url: "/tenor/categories",
    method: "GET",
  })
}

export const useGetGifs = ({ query, limit = 10 }: UseGifsParams) => {
  return useInfiniteQuery<GifResponse, Error>({
    queryKey: ["gifs", query],
    queryFn: ({ pageParam }) => {
      return fetchGifs({
        query,
        limit,
        pageParam,
      })
    },
    getNextPageParam: (lastPage) => {
      if (!lastPage.next) return undefined
      return lastPage.next
    },
    enabled: query.length > 0,
    initialPageParam: "",
  })
}

export const useGetGifCategories = () => {
  return useQuery<{ tags: GifCategory[] }, Error>({
    queryKey: ["gifCategories"],
    queryFn: fetchGifCategories,
  })
}
