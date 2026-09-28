// The signup wizard hands its one-time API key to the dashboard through
// sessionStorage; the dashboard reads it once and deletes it, so the
// plaintext key (stored only as a hash on the server) is shown exactly once.
const KEY = 'kgtSignupHandoff';

export function putSignupHandoff(data) {
  try {
    window.sessionStorage.setItem(KEY, JSON.stringify(data));
    return true;
  } catch {
    return false; // storage blocked — the dashboard can issue a new key instead
  }
}

export function takeSignupHandoff() {
  try {
    const raw = window.sessionStorage.getItem(KEY);
    window.sessionStorage.removeItem(KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
