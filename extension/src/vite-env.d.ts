/// <reference types="vite/client" />
/// <reference types="@ugurkellecioglu/vite-plugin-web-extension/client" />

declare module "@ugurkellecioglu/vite-plugin-web-extension/client" {
  export function addViteStyleTarget(element: Node): Promise<void>;
}
