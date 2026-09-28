import sanitizeHtml from "sanitize-html"

/**
 * Extracts and sanitizes the text content from the actual page DOM
 * Uses chrome.scripting to execute in the page context, not sidepanel
 * @param maxLength Maximum length of content to extract (default: 10000 characters)
 * @returns Promise with plain text content of the page
 */
export async function extractPageContent(maxLength: number = 10000): Promise<string> {
  try {
    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (!tab?.id) {
      console.error("No active tab found")
      return ""
    }

    // Execute script in the actual page context
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: (maxLen: number) => {
        // This function runs in the actual page context
        try {
          // Get the main content from the body
          const bodyContent = document.body?.innerText || document.body?.textContent || ""

          // Remove extra whitespace and newlines
          let cleanedContent = bodyContent
            .replace(/\s+/g, " ") // Replace multiple spaces with single space
            .replace(/\n+/g, " ") // Replace newlines with space
            .trim()

          // Truncate to max length if needed
          if (cleanedContent.length > maxLen) {
            cleanedContent = cleanedContent.substring(0, maxLen) + "..."
          }

          return cleanedContent
        } catch (error) {
          console.error("Error extracting page content", error)
          return ""
        }
      },
      args: [maxLength],
    })

    // Return the result from the injected script
    return results[0]?.result || ""
  } catch (error) {
    console.error("Error executing page content extraction", error)
    return ""
  }
}

/**
 * Extracts text content from a specific HTML string
 * Strips all HTML tags and returns plain text
 * @param html HTML string to extract text from
 * @returns Plain text content
 */
export function stripHtmlTags(html: string): string {
  return sanitizeHtml(html, {
    allowedTags: [], // No tags allowed - strip all HTML
    allowedAttributes: {}, // No attributes allowed
  }).trim()
}

/**
 * Extracts user name and email from Chrome Web Store page
 * @returns Promise with user name and email
 */
export async function extractChromeStoreUserInfo(): Promise<{ name: string; email: string } | null> {
  try {
    // Get the current active tab
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })

    if (!tab?.id) {
      console.error("No active tab found")
      return null
    }

    // Execute script in the actual page context
    const results = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        // This function runs in the actual page context
        try {
          // Get the name from .gb_g element
          const nameElement = document.querySelector(".gb_g")
          const name = nameElement?.textContent?.trim() || ""

          // Get the email from the next sibling of .gb_g
          const emailElement = nameElement?.nextElementSibling
          const email = emailElement?.textContent?.trim() || ""

          return { name, email }
        } catch (error) {
          console.error("Error extracting user info", error)
          return { name: "", email: "" }
        }
      },
    })

    const result = results[0]?.result

    // Only return if both name and email are present
    if (result && result.name && result.email) {
      return result
    }

    return null
  } catch (error) {
    console.error("Error executing user info extraction", error)
    return null
  }
}

/**
 * Active-tab page context (url + title + readable content) for the Arc
 * create-first flow. Sourced DIRECTLY from the active tab via chrome.tabs so it
 * never depends on the side panel's currentUrl store — which defaults to the
 * extension's OWN url (chrome-extension://…) until persistence catches up, and
 * would otherwise be sent to the market endpoint and rejected as ineligible.
 */
export async function extractPageContext(
  maxLength: number = 10000,
): Promise<{ url: string; title: string; content: string }> {
  let url = ""
  let title = ""
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    url = tab?.url || ""
    title = tab?.title || ""
  } catch (error) {
    console.error("Failed to read active tab for page context", error)
  }
  const content = await extractPageContent(maxLength)
  return { url, title, content }
}
