const CONSENT_STORAGE_KEY = 'pos_legal_consent';
const LEGACY_CONSENT_KEY = '__legacy__';

export type ConsentMap = Record<string, boolean>;

export function getLegalConsentMap(): ConsentMap {
  try {
    const raw = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return {};
    if (raw === '1') return { [LEGACY_CONSENT_KEY]: true };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return Object.fromEntries(
      Object.entries(parsed).filter(([, value]) => value === true),
    );
  } catch {
    return {};
  }
}

export function hasLegalConsent(userId?: string): boolean {
  const map = getLegalConsentMap();
  return Boolean(map[LEGACY_CONSENT_KEY] || (userId && map[userId.trim().toLowerCase()]));
}

export function recordLegalConsent(userId: string): void {
  try {
    // Keep the original device-level marker for compatibility with existing
    // terminals and persisted sessions. The server remains the source of truth
    // for the account-specific acceptance record.
    localStorage.setItem(CONSENT_STORAGE_KEY, '1');
  } catch {
    // Consent enforcement remains server-side when local storage is unavailable.
  }
}
