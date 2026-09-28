import { useEffect, useState } from "react"
import { useDebounceValue } from "usehooks-ts"
import { User } from "~/services/UserService"
import { useGetUsers } from "./useGetUsers"

export const useMentions = () => {
  const [mentionQuery, setMentionQuery] = useState<string | null>(null)
  const [debouncedMentionQuery] = useDebounceValue(mentionQuery, 500)
  const [mentionAnchorEl, setMentionAnchorEl] =
    useState<HTMLTextAreaElement | null>(null)
  const [cursorPosition, setCursorPosition] = useState<number | null>(null)
  const [selectedUserIndex, setSelectedUserIndex] = useState<number>(-1)

  const { data: userSuggestions, isLoading: isLoadingUsers } = useGetUsers(
    debouncedMentionQuery ? debouncedMentionQuery.substring(1) : "",
    {
      enabled:
        Boolean(debouncedMentionQuery) && debouncedMentionQuery!.length > 1,
      refetchOnWindowFocus: false,
    }
  )

  // Reset selected index when suggestions change
  useEffect(() => {
    setSelectedUserIndex(-1)
  }, [userSuggestions])

  // Set the first user suggestion as active by default
  useEffect(() => {
    if (userSuggestions && userSuggestions.length > 0) {
      setSelectedUserIndex(0)
    }
  }, [userSuggestions])

  const handleTextChange = (
    e: React.ChangeEvent<HTMLTextAreaElement>,
    setValue: (value: string) => void
  ) => {
    const cursorPos = e.target.selectionStart
    setCursorPosition(cursorPos)

    // Check if we're in a potential mention
    const textBeforeCursor = e.target.value.substring(0, cursorPos)
    const mentionMatch = textBeforeCursor.match(/@(\w*)$/)

    if (mentionMatch && mentionMatch[1].length >= 1) {
      // We have a potential mention with at least 1 character after @
      const newMentionQuery = "@" + mentionMatch[1]
      setMentionQuery(newMentionQuery)
      setMentionAnchorEl(e.target)
    } else {
      // Close the mention suggestions
      setMentionQuery(null)
      setMentionAnchorEl(null)
      setSelectedUserIndex(-1)
    }

    setValue(e.target.value)
  }

  const handleKeyDown = (
    e: React.KeyboardEvent<HTMLTextAreaElement>,
    content: string,
    setValue: (value: string) => void,
    onSubmit: () => void
  ) => {
    const isSuggestionsOpen =
      userSuggestions && userSuggestions.length > 0 && mentionAnchorEl

    if (e.key === "Enter" && !e.shiftKey && !isSuggestionsOpen) {
      e.preventDefault()
      onSubmit()
      return
    }

    if (!isSuggestionsOpen) {
      return
    }

    switch (e.key) {
      case "ArrowDown":
        e.preventDefault()
        setSelectedUserIndex((prevIndex) =>
          prevIndex < userSuggestions.length - 1 ? prevIndex + 1 : 0
        )
        break
      case "ArrowUp":
        e.preventDefault()
        setSelectedUserIndex((prevIndex) =>
          prevIndex > 0 ? prevIndex - 1 : userSuggestions.length - 1
        )
        break
      case "Enter":
        if (
          selectedUserIndex >= 0 &&
          selectedUserIndex < userSuggestions.length
        ) {
          e.preventDefault()
          handleSelectUser(
            userSuggestions[selectedUserIndex],
            content,
            setValue
          )
        }
        break
      case "Escape":
        e.preventDefault()
        setMentionQuery(null)
        setMentionAnchorEl(null)
        setSelectedUserIndex(-1)
        break
    }
  }

  const handleSelectUser = (
    user: User,
    content: string,
    setValue: (value: string) => void
  ) => {
    if (cursorPosition !== null && mentionQuery !== null) {
      const beforeMention = content.substring(
        0,
        cursorPosition - mentionQuery.length
      )
      const afterMention = content.substring(cursorPosition)

      // Replace the mention query with the selected username
      const newContent = `${beforeMention}@${user.username} ${afterMention}`

      setValue(newContent)

      // Close the mention suggestions
      setMentionQuery(null)
      setMentionAnchorEl(null)
      setSelectedUserIndex(-1)
    }
  }

  return {
    mentionQuery,
    mentionAnchorEl,
    selectedUserIndex,
    userSuggestions,
    isLoadingUsers,
    handleTextChange,
    handleKeyDown,
    handleSelectUser,
  }
}
