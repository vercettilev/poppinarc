export type Action = keyof ActionMap

export interface ActionMap {
  API_REQUEST: {
    payload: {
      url: string
      method: string
      data?: any
      params?: any
    }
    response: any
  }
  /*
   * NAVIGATE and GO_BACK ARE GONE, and this note is here so nobody adds them
   * back by reading the background for a pattern.
   *
   * They were the wire half of helpers/navigation.ts, which exported a
   * `navigate()` that could never navigate: it called a function pointer that
   * `setNavigateFunction` was supposed to fill, and that setter had exactly one
   * occurrence in the entire repo — its own declaration. So the pointer was
   * permanently null, every call fell through to the chrome message, and the
   * background answered NAVIGATE by broadcasting a store update for
   * "route-store", a key store/index.ts does not have. It threw. Two live
   * profile-tap handlers were dead buttons on top of a thrown error.
   *
   * The helper is deleted and both call sites use react-router's useNavigate.
   * A typed verb with no sender and no handler is an invitation to wire up the
   * broken path again, so the entries go too.
   */
  FIREBASE_AUTH: {
    payload: {
      access_token: string
    }
    response: {
      success: boolean
      user?: any
      error?: string
    }
  }
  TOGGLE_SIDE_PANEL: {
    payload: {}
    response: void
  }
  LOGOUT: {
    payload: {}
    response: void
  }
}
