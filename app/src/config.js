// In production the frontend is served by the same Express server,
// so API calls go to the same origin (empty string = relative URLs).
// Override via VITE_API_URL for local dev if needed.
// Override VITE_KVSTORE_URL if your kvstore is on a different domain.
const config = {
  apiServerAddress: import.meta.env.VITE_API_URL     || '',
  kvstoreUrl:       import.meta.env.VITE_KVSTORE_URL || 'https://kvstore.mooc.ca',
};

export default config;