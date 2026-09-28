/**
 * Converts a hex color to RGB values
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } {
  // Remove the # if present
  const cleanHex = hex.replace('#', '')
  
  // Handle both 3-digit and 6-digit hex
  const r = parseInt(cleanHex.length === 3 ? cleanHex[0] + cleanHex[0] : cleanHex.substring(0, 2), 16)
  const g = parseInt(cleanHex.length === 3 ? cleanHex[1] + cleanHex[1] : cleanHex.substring(2, 4), 16)
  const b = parseInt(cleanHex.length === 3 ? cleanHex[2] + cleanHex[2] : cleanHex.substring(4, 6), 16)
  
  return { r, g, b }
}

/**
 * Calculates the relative luminance of a color
 * Based on WCAG 2.1 guidelines
 */
function getLuminance(r: number, g: number, b: number): number {
  // Convert to sRGB
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
  })
  
  // Calculate luminance
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs
}

/**
 * Gets a contrasting text color (black or white) for a given background color
 * @param backgroundColor - Hex color string (e.g., "#FF0000" or "#F00")
 * @returns Contrasting color as hex string ("#000000" for black or "#FFFFFF" for white)
 */
export function getContrastText(backgroundColor: string): string {
  try {
    // Convert hex to RGB
    const { r, g, b } = hexToRgb(backgroundColor)
    
    // Calculate luminance
    const luminance = getLuminance(r, g, b)
    
    // Return black for light backgrounds, white for dark backgrounds
    // Using a threshold of 0.5 (standard for contrast calculations)
    return luminance > 0.5 ? '#000000' : '#FFFFFF'
  } catch {
    // Fallback to white if there's an error parsing the color
    console.warn('Invalid hex color provided to getContrastText:', backgroundColor)
    return '#FFFFFF'
  }
}

/**
 * Gets a contrasting text color with custom threshold
 * @param backgroundColor - Hex color string
 * @param threshold - Luminance threshold (default: 0.5)
 * @returns Contrasting color as hex string
 */
export function getContrastTextWithThreshold(backgroundColor: string, threshold: number = 0.5): string {
  try {
    const { r, g, b } = hexToRgb(backgroundColor)
    const luminance = getLuminance(r, g, b)
    return luminance > threshold ? '#000000' : '#FFFFFF'
  } catch {
    console.warn('Invalid hex color provided to getContrastTextWithThreshold:', backgroundColor)
    return '#FFFFFF'
  }
}

/**
 * Validates if a string is a valid hex color
 * @param hex - Hex color string to validate
 * @returns boolean indicating if the hex color is valid
 */
export function isValidHexColor(hex: string): boolean {
  const hexRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/
  return hexRegex.test(hex)
}
