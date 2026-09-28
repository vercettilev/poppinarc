// Function to generate a hash from a string
function hashString(str: string): number {
  let hash = 0
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i)
    hash = (hash << 5) - hash + char
    hash = hash & hash // Convert to 32bit integer
  }
  return hash
}

// Predefined color palette with 40 distinct colors
const colorPalette = [
  // Warm colors
  "#FF6B6B", // coral red
  "#FF8C42", // tangerine
  "#FFA07A", // light salmon
  "#FFB347", // pastel orange
  "#FFCC5C", // golden
  "#FFD93D", // yellow
  "#FFE156", // pastel yellow
  "#F4A261", // sandy brown
  "#E76F51", // burnt sienna
  "#E85D75", // dark coral

  // Cool colors
  "#4ECDC4", // turquoise
  "#45B7D1", // sky blue
  "#48CAE4", // bright blue
  "#00B4D8", // ocean blue
  "#0096C7", // strong blue
  "#0077B6", // deep blue
  "#023E8A", // navy blue
  "#6B48FF", // purple blue
  "#7400B8", // violet
  "#6930C3", // deep purple

  // Green tones
  "#2ECC71", // emerald
  "#52B788", // sea green
  "#95D5B2", // sage
  "#74C69D", // mint
  "#40916C", // forest green
  "#B7E4C7", // light green
  "#D8F3DC", // pale green
  "#98C1D9", // light blue green
  "#84A98C", // muted green
  "#52796F", // dark green

  // Mixed hues
  "#FF758F", // pink
  "#FF97B7", // light pink
  "#D4A5A5", // dusty rose
  "#E0B1CB", // mauve
  "#C77DFF", // bright purple
  "#9B5DE5", // medium purple
  "#F15BB5", // magenta
  "#FEE440", // bright yellow
  "#F72585", // hot pink
  "#B5179E", // deep magenta
]

export function getUserColor(uid: string): string {
  // Get current day as string (YYYY-MM-DD)
  const today = new Date().toISOString().split("T")[0]

  // Create a hash from uid + today
  const hash = hashString(`${uid}-${today}`)

  // Use the hash to select a color from the palette
  const colorIndex = Math.abs(hash) % colorPalette.length

  return colorPalette[colorIndex]
}
