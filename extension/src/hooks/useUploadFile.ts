import { useMutation } from "@tanstack/react-query"
import { UserService } from "~/services/UserService"

interface UploadFileOptions {
  width?: number
  height?: number
  quality?: number
  /**
   * Which region survives when an off-aspect image is cropped to fit.
   * 'attention' weighs skin tones and saturation, so a portrait keeps the
   * face; the default keeps the busiest region, which for a person is
   * often the background.
   */
  crop?: "entropy" | "attention"
}

export function useUploadFile() {
  return useMutation({
    mutationFn: ({ file, options }: { file: File; options?: UploadFileOptions }) => 
      UserService.uploadFile(file, options),
  })
}
