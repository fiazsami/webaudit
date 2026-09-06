/**
 * SHA-256 as core's `hashInlineScript` port expects it (docs/02).
 *
 * core cannot do this itself — SubtleCrypto is a host API — so the content
 * script passes this in. The format matches a CSP `script-src` hash entry, so a
 * snapshot's inline hashes can be compared against a policy directly.
 */
export async function sha256Base64(source: string): Promise<string> {
  const bytes = new TextEncoder().encode(source);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let binary = "";
  for (const byte of new Uint8Array(digest)) {
    binary += String.fromCharCode(byte);
  }
  return `sha256-${btoa(binary)}`;
}
