import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useCurrentUser } from "./useCurrentUser"
import { UserService } from "~/services/UserService"

interface UpdateProfileData {
  username: string
  /**
   * OPTIONAL, and it matters: UpdateUserSchema marks display_name
   * .optional() but ALSO .min(3), so sending "" for an account that has
   * none is a 400 — the field is legal to omit and illegal to leave
   * empty. Typing it as required made every caller invent a value, and
   * the only value there is to invent is the empty string.
   */
  display_name?: string
  profile_photo_url?: string | null
}

export const useUpdateProfile = () => {
  const queryClient = useQueryClient()
  const { data: currentUser } = useCurrentUser()

  return useMutation({
    mutationFn: (data: UpdateProfileData) => {
      // If user doesn't have a username yet, use register endpoint
      if (!currentUser?.username) {
        return UserService.registerProfile({
          username: data.username,
          // /users/me/register requires one; the username is the only
          // honest stand-in, and it already passes the same length rule.
          display_name: data.display_name || data.username,
          profile_photo_url: data.profile_photo_url,
        })
      }
      // Otherwise use update endpoint
      return UserService.updateProfile(data)
    },
    onSuccess: () => {
      // Invalidate the current user query to refetch with updated data
      /**
       * The key here has to be the key the query actually uses. It read
       * ["currentUser"] while useCurrentUser registers ["current-user"], so
       * this invalidated NOTHING: saving a new profile photo left every
       * surface serving the cached old user for the whole staleTime, which
       * is exactly "I upload this and it still shows the old one".
       */
      queryClient.invalidateQueries({ queryKey: ["current-user"] })
    },
  })
}
