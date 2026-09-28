import { useMutation } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"

interface InvitationCodeResponse {
  success: boolean
  message?: string
}

export const useInvitationCode = () => {
  return useMutation<
    InvitationCodeResponse,
    { status: number; message: string },
    string
  >({
    mutationFn: async (code: string) => {
      try {
        await UserService.getInvitationCode(code)
        return { success: true }
      } catch (error: any) {
        throw error
      }
    },
  })
}
