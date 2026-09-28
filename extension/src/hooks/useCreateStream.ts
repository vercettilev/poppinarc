import { useMutation } from "@tanstack/react-query"
import { StreamService } from "~/services/StreamService"

export function useCreateStream() {
  return useMutation({
    mutationFn: StreamService.create,
  })
}
