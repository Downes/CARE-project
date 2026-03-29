// In production the frontend is served by the same Express server,
// so API calls go to the same origin (empty string = relative URLs).
// Override via VITE_API_URL for local dev if needed.
const config = {
  apiServerAddress: import.meta.env.VITE_API_URL || '',
};

export default config;