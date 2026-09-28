// Image preview script that will be injected into the page
const openImagePreview = (imageUrl: string) => {
  // Close any existing preview first. The page is the record of what is
  // open, so a second injection into the same document still finds it.
  const existing = document.querySelector('[data-image-preview-overlay]')
  if (existing) {
    existing.remove()
    document.body.style.overflow = ''
  }

  // Create overlay
  const overlay = document.createElement('div')
  overlay.setAttribute('data-image-preview-overlay', 'true')
  overlay.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(0, 0, 0, 0.6);
    backdrop-filter: blur(8px);
    -webkit-backdrop-filter: blur(8px);
    z-index: 999999;
    display: flex;
    align-items: center;
    justify-content: center;
    cursor: pointer;
  `

  // Create image container
  const imageContainer = document.createElement('div')
  imageContainer.style.cssText = `
    position: relative;
    max-width: 90vw;
    max-height: 90vh;
    display: flex;
    align-items: center;
    justify-content: center;
  `

  // Create close button
  const closeButton = document.createElement('button')
  closeButton.innerHTML = '×'
  closeButton.style.cssText = `
    position: absolute;
    top: 16px;
    right: 16px;
    background-color: rgba(0, 0, 0, 0.5);
    color: white;
    border: none;
    border-radius: 50%;
    width: 40px;
    height: 40px;
    font-size: 24px;
    cursor: pointer;
    z-index: 1000000;
    display: none;
    align-items: center;
    justify-content: center;
    transition: background-color 0.2s ease;
  `

  // Create image
  const image = document.createElement('img')
  image.src = imageUrl
  image.style.cssText = `
    max-width: 90vw;
    max-height: 90vh;
    width: auto;
    height: auto;
    object-fit: contain;
    border-radius: 8px;
  `

  // Show close button when image loads
  image.addEventListener('load', () => {
    closeButton.style.display = 'flex'
  })

  // Also show close button if image fails to load
  image.addEventListener('error', () => {
    closeButton.style.display = 'flex'
  })

  // Add hover effect to close button
  closeButton.addEventListener('mouseenter', () => {
    closeButton.style.backgroundColor = 'rgba(0, 0, 0, 0.7)'
  })
  closeButton.addEventListener('mouseleave', () => {
    closeButton.style.backgroundColor = 'rgba(0, 0, 0, 0.5)'
  })

  // Close function
  const closePreview = () => {
    document.body.style.overflow = ''
    if (overlay.parentNode) {
      overlay.parentNode.removeChild(overlay)
    }
    document.removeEventListener('keydown', handleKeyDown)
  }

  // Add event listeners
  closeButton.addEventListener('click', closePreview)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      closePreview()
    }
  })

  // Add keyboard support
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') closePreview()
  }
  document.addEventListener('keydown', handleKeyDown)

  // Assemble and show
  imageContainer.appendChild(closeButton)
  imageContainer.appendChild(image)
  overlay.appendChild(imageContainer)
  document.body.appendChild(overlay)

  // Prevent body scroll
  document.body.style.overflow = 'hidden'
}

// Attach function to window object so it can be checked for existence
(window as any).openImagePreview = openImagePreview

// Listen for messages from the extension
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === 'OPEN_IMAGE_PREVIEW') {
    openImagePreview(request.payload.imageUrl)
    sendResponse({ success: true })
  }
})
