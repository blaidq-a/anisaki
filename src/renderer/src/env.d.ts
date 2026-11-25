/// <reference types="vite/client" />
/// <reference types="@webgpu/types" />
import type { api } from './desktop/api'

declare global {
  interface Window {
    api: typeof api
  }
}
