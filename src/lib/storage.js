/**
 * Namespaced localStorage helper for tool settings.
 *
 * Every read and write is guarded: in private-browsing modes, or when a site
 * has storage disabled, `localStorage` access throws rather than returning
 * null. Tools should keep working there — they just won't remember settings.
 */

const PREFIX = "tool-hub:";

function storage() {
  try {
    const ls = window.localStorage;
    // Touching a key is the only reliable way to detect a blocked store.
    const probe = `${PREFIX}__probe__`;
    ls.setItem(probe, "1");
    ls.removeItem(probe);
    return ls;
  } catch {
    return null;
  }
}

/**
 * Load saved settings for a tool, merged over its defaults.
 *
 * Unknown keys in the stored object are dropped and missing keys fall back to
 * the default, so changing the defaults in a later version never leaves a
 * tool holding a stale or half-populated settings object.
 *
 * @template {Record<string, unknown>} T
 * @param {string} toolId
 * @param {T} defaults
 * @returns {T}
 */
export function loadSettings(toolId, defaults) {
  const ls = storage();
  if (!ls) return { ...defaults };

  try {
    const raw = ls.getItem(PREFIX + toolId);
    if (!raw) return { ...defaults };

    const saved = JSON.parse(raw);
    if (!saved || typeof saved !== "object") return { ...defaults };

    const merged = { ...defaults };
    for (const key of Object.keys(defaults)) {
      if (saved[key] !== undefined) merged[key] = saved[key];
    }
    return merged;
  } catch {
    return { ...defaults };
  }
}

/**
 * Persist a tool's settings. Silently does nothing if storage is unavailable.
 *
 * @param {string} toolId
 * @param {Record<string, unknown>} settings
 */
export function saveSettings(toolId, settings) {
  const ls = storage();
  if (!ls) return;

  try {
    ls.setItem(PREFIX + toolId, JSON.stringify(settings));
  } catch {
    /* quota exceeded or storage blocked — settings just won't persist */
  }
}

/**
 * Forget a tool's saved settings (used by "Reset to defaults").
 *
 * @param {string} toolId
 */
export function clearSettings(toolId) {
  const ls = storage();
  if (!ls) return;

  try {
    ls.removeItem(PREFIX + toolId);
  } catch {
    /* nothing to do */
  }
}
