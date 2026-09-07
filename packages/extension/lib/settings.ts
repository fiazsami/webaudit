import { z } from "zod";

/**
 * Settings (docs/09).
 *
 * `chrome.storage.local`, plain JSON. There are no secrets: with hosted
 * providers cut there is no API key, which removes the whole `safeStorage`
 * problem the desktop design existed partly to solve (docs/12 T5).
 */

export const SettingsSchema = z.object({
  modelId: z.string(),
  /** Model calls one audit may make. Everything else derives from the model. */
  maxSteps: z.number().int().positive().max(50),
  maxNetworkFetches: z.number().int().nonnegative().max(50),
  /** Beyond the audited page's own host. Each entry widens what a run can reach. */
  extraAllowedDomains: z.array(z.string()),
  /** IndexedDB has no size guarantee, so history is capped (docs/09). */
  historyCap: z.number().int().positive().max(5000),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  modelId: "Qwen2.5-1.5B-Instruct-q4f16_1-MLC",
  maxSteps: 12,
  maxNetworkFetches: 6,
  extraAllowedDomains: [],
  historyCap: 200,
};

const KEY = "settings";

export async function loadSettings(): Promise<Settings> {
  const stored = await browser.storage.local.get(KEY);
  const parsed = SettingsSchema.safeParse(stored[KEY]);
  // Settings written by an older build count as absent, not as an error: a
  // stale preference should never stop the tool starting.
  return parsed.success ? parsed.data : DEFAULT_SETTINGS;
}

export async function saveSettings(settings: Settings): Promise<void> {
  await browser.storage.local.set({ [KEY]: SettingsSchema.parse(settings) });
}
