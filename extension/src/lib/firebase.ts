import { getApps, initializeApp } from "firebase/app"

import { getAuth } from "firebase/auth/web-extension"

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIRESTORE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIRESTORE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIRESTORE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIRESTORE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIRESTORE_MESSEGING_SENDER_FILE,
  appId: process.env.NEXT_PUBLIC_FIRESTORE_APP_ID,
  databaseURL: process.env.NEXT_PUBLIC_FIRESTORE_DATABASE_URL,
}

// Ensure Firebase is initialized only once
const app =
  getApps().length === 0 ? initializeApp(firebaseConfig) : getApps()[0]

export const auth = getAuth(app)

/**
 * `db` (Realtime Database) used to be exported here. Nothing imported it
 * once chat left — but the export alone kept `firebase/database` in the
 * bundle, because a module that hands out a handle must construct it. The
 * databaseURL stays in the config above: it is inert without the SDK, and
 * it is what a future RTDB feature would need back.
 */
