import React from "react"
import { Box } from "@mui/material"

interface ContentWithMentionsProps {
  content: string
}

export const ContentWithMentions = ({ content }: ContentWithMentionsProps) => {
  // Regex to match @username patterns
  const mentionRegex = /@(\w+)/g

  // Split content by mentions
  const parts = content.split(mentionRegex)

  if (parts.length <= 1) {
    return <span>{content}</span>
  }

  const result: React.ReactElement[] = []
  let i = 0

  // Rebuild the content with styled mentions
  content.replace(mentionRegex, (match, username) => {
    // Add text before the mention
    if (parts[i]) {
      result.push(<span key={`text-${i}`}>{parts[i]}</span>)
    }

    // Add the mention with blue styling
    result.push(
      <span key={`mention-${username}-${i}`} style={{ color: "#67C6FE" }}>
        @{username}
      </span>
    )

    i += 2
    return match
  })

  // Add any remaining text
  if (i < parts.length) {
    result.push(<span key={`text-${i}`}>{parts[i]}</span>)
  }

  return <>{result}</>
}

export const ContentWithMentionsPreview = ({
  content,
  fontSize = "12px",
}: {
  content: string
  fontSize?: string
}) => {
  if (!content) return null

  return (
    <Box
      sx={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        padding: "0 0 0 4px",
        pointerEvents: "none",
        fontSize,
        fontFamily: "inherit",
        marginTop: "2px",
        color: "transparent",
        "& span": {
          whiteSpace: "pre-wrap",
        },
      }}
    >
      <ContentWithMentions content={content} />
    </Box>
  )
}
