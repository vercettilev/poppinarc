# CAvatar Component

A custom avatar component that extends MUI's Avatar with consistent sizing and clickable behavior.

## Usage

```tsx
import { CAvatar } from "~/components/CAvatar";

// Basic usage - will use default avatar if no src provided
<CAvatar alt="User Avatar" />

// With custom image
<CAvatar src="/path/to/image.jpg" alt="User Avatar" />

// With size variants
<CAvatar size="small" />
<CAvatar size="medium" />
<CAvatar size="large" />
<CAvatar size="xlarge" />

// Clickable avatar
<CAvatar 
  clickable={true} 
  onClick={handleClick}
/>

// With fallback text (will still show default image if no src)
<CAvatar>JD</CAvatar>
```

## Props

- `size`: "small" | "medium" | "large" | "xlarge" (default: "medium")
- `clickable`: boolean (default: false) - Adds hover effects and pointer cursor
- `src`: string (optional) - Image source. If not provided, uses default avatar image
- All standard MUI Avatar props are supported

## Default Behavior

- If no `src` is provided, the component automatically uses a default avatar image from `~/assets/avatar.png`
- This ensures consistent appearance across your app even when user profile images are missing

## Size Mapping

- `small`: 24px × 24px
- `medium`: 32px × 32px  
- `large`: 40px × 40px
- `xlarge`: 56px × 56px 