// Firebase is optional: with no VITE_FIREBASE_* values the app runs exactly as before (no sign-in,
// browser-only history). Values come from frontend/.env.local in dev and from the host's env at build time.
import { initializeApp } from "firebase/app";
import { getAuth, GoogleAuthProvider, type Auth } from "firebase/auth";
import { initializeFirestore, type Firestore } from "firebase/firestore";

const env = import.meta.env;
const config = {
  apiKey: env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const firebaseEnabled = !!(config.apiKey && config.authDomain && config.projectId && config.appId);

const app = firebaseEnabled ? initializeApp(config) : null;
export const auth: Auth | null = app && getAuth(app);
export const google = new GoogleAuthProvider();
// Optional fields (thumb, updated) may be undefined; Firestore rejects undefined unless told to drop it.
export const db: Firestore | null = app && initializeFirestore(app, { ignoreUndefinedProperties: true });
