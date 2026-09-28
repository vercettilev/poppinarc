import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { sendApiRequest } from "~/lib/fetchService"
import { UserService } from "~/services/UserService"

// Local wrapper for InvitationCodeService (avoids @repo/common resolution issues)
const InvitationCodeService = {
  createMany: (numberOfCodes: number) =>
    sendApiRequest({ url: "/invitation-codes/create-many", method: "POST", data: { number_of_codes: numberOfCodes } }),
  assignToUsers: (usernames: string[], count: number, minPoints?: number) =>
    sendApiRequest({ url: "/admin/invitation-codes", method: "POST", data: { usernames, count, minPoints } }),
}

interface UseInvitationCodesProps {
  limit?: number
  enabled?: boolean
}

export function useRedeemedInvitationCodes({
  limit = 10,
  enabled = true,
}: UseInvitationCodesProps = {}) {
  return useQuery({
    queryKey: ["invitationCodes", "redeemed"],
    queryFn: () => UserService.getRedeemedInvitationCodes(limit),
    enabled,
  })
}

export function useUnusedInvitationCodes({
  limit = 10,
  enabled = true,
}: UseInvitationCodesProps = {}) {
  return useQuery({
    queryKey: ["invitationCodes", "unused"],
    queryFn: () => UserService.getUnusedInvitationCodes(limit),
    enabled,
  })
}

export function useCreateInvitationCodes() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: (numberOfCodes: number) => InvitationCodeService.createMany(numberOfCodes),
    onSuccess: () => {
      // Invalidate the unused invitation codes query to refetch
      queryClient.invalidateQueries({ queryKey: ["invitationCodes", "unused"] })
    },
  })
}

export function useAssignInvitationCodes() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ usernames, count, minPoints }: { usernames: string[]; count: number; minPoints?: number }) =>
      InvitationCodeService.assignToUsers(usernames, count, minPoints),
    onSuccess: () => {
      // Invalidate the unused invitation codes query to refetch
      queryClient.invalidateQueries({ queryKey: ["invitationCodes", "unused"] })
    },
  })
}
