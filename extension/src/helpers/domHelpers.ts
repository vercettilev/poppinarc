// utils/domHelpers.ts
export function openToolbar() {
  const toolbarButton = document.querySelector(".cke_toolbar_last a") as HTMLElement | null;
  if (toolbarButton && !toolbarButton.classList.contains("cke_button_on")) {
    toolbarButton.click();
  } else {
    console.error("Open: Toolbar button not found");
  }
}
export function observeAndCloseToolbar(renderOverlay: (() => void) | undefined) {
  const observer = new MutationObserver((mutationsList) => {
    mutationsList.forEach(() => {
      const toolbarButton = document.querySelector(".cke_toolbar_last a") as HTMLElement | null;
      if (toolbarButton && toolbarButton.classList.contains("cke_button_on")) {
        toolbarButton.click();
        observer.disconnect(); // Stop observing after the button is clicked
        if (renderOverlay) {
          renderOverlay();
        }
      }
    });
  });

  // Start observing the document body for any changes
  observer.observe(document.body, {
    childList: true, // Observe direct children changes (nodes added or removed)
    subtree: true, // Observe changes within the subtree (descendants of nodes)
    attributes: true, // Observe changes to attributes
  });
}

export function extractFirstCbIdFromDocument() {
  // Get the entire document content as HTML
  const documentContent = document.body.innerHTML;

  // Regex to match "CB_ID%3A%20" (encoded form of "CB_ID: ") followed by digits
  const regex = /CB_ID%3A%20(\d+)/i;

  // Match the first occurrence
  const match = documentContent.match(regex);

  // Extract the ID or set it to null if no match is found
  const firstCbId = match ? match[1] : null;

  // Return the first CB_ID
  return firstCbId;
}
