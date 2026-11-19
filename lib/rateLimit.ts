interface RateLimitEntry {
  attempts: number;
  firstAttemptAt: number;
  lastAttemptAt: number;
}

const loginAttempts = new Map<string, RateLimitEntry>();

// Clean up stale entries every 5 minutes
if (typeof setInterval !== 'undefined') {
  setInterval(() => {
    const now = Date.now();
    const WINDOW_MS = 10 * 60 * 1000;
    for (const [key, entry] of Array.from(loginAttempts.entries())) {
      if (now - entry.lastAttemptAt > WINDOW_MS) {
        loginAttempts.delete(key);
      }
    }
  }, 5 * 60 * 1000);
}

export function checkLoginRateLimit(key: string, maxAttempts = 5, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (!entry) {
    return { allowed: true, remaining: maxAttempts, retryAfterSec: 0 };
  }

  // If outside window, reset
  if (now - entry.firstAttemptAt > windowMs) {
    loginAttempts.delete(key);
    return { allowed: true, remaining: maxAttempts, retryAfterSec: 0 };
  }

  if (entry.attempts >= maxAttempts) {
    const retryAfterSec = Math.ceil((entry.firstAttemptAt + windowMs - now) / 1000);
    return { allowed: false, remaining: 0, retryAfterSec };
  }

  return { allowed: true, remaining: maxAttempts - entry.attempts, retryAfterSec: 0 };
}

export function recordFailedLogin(key: string, windowMs = 10 * 60 * 1000) {
  const now = Date.now();
  const entry = loginAttempts.get(key);

  if (!entry || now - entry.firstAttemptAt > windowMs) {
    loginAttempts.set(key, { attempts: 1, firstAttemptAt: now, lastAttemptAt: now });
  } else {
    entry.attempts += 1;
    entry.lastAttemptAt = now;
  }
}

export function resetFailedLogin(key: string) {
  loginAttempts.delete(key);
}
