import { useQuery } from "@tanstack/react-query"
import { StreamService } from "~/services/StreamService"

export function useGetStreams() {
  return useQuery({
    queryKey: ["streams"],
    queryFn: async () => {
      const response = await StreamService.get()
      if (!response.success) {
        throw new Error("Failed to fetch streams")
      }
      return response.data.calls
    },
  })
}
