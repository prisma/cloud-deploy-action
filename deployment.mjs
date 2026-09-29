const DEPLOYED_URL_RE = /https?:\/\/[a-z0-9.-]+\.prisma\.build(?:\/[^\s]*)?/i;

// Built from the escape byte so the source carries no literal control character.
const ANSI_SGR_RE = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");

/** The first `.prisma.build` address in the deploy output, or null when it carries none. */
export function deployedUrlFromOutput(output) {
  if (typeof output !== "string" || output.length === 0) return null;
  const match = output.replace(ANSI_SGR_RE, "").match(DEPLOYED_URL_RE);
  return match ? match[0] : null;
}

/**
 * Every deployed service's public URL, keyed by its Composer address, read
 * from the `deploy` result line the Prisma CLI prints to stdout
 * (`{"kind":"result","envelope":{"commandId":"deploy","result":{"summary":…}}}`).
 * `url` is the root module's service (an address without a dot, e.g. "app"),
 * falling back to the first service, then to the first `.prisma.build`
 * address in the text for CLIs that print no result line.
 */
export function deployedUrlsFromOutput(output) {
  const urls = {};
  for (const line of typeof output === "string" ? output.split("\n") : []) {
    let parsed;
    try {
      parsed = JSON.parse(line);
    } catch {
      continue;
    }
    if (parsed?.kind !== "result" || parsed.envelope?.commandId !== "deploy") continue;
    for (const node of parsed.envelope.result?.summary?.nodes ?? []) {
      const entity = (node.entities ?? []).find((e) => e.kind === "compute-service" && e.url);
      if (entity) urls[node.address] = entity.url;
    }
  }
  const addresses = Object.keys(urls);
  const root = addresses.find((a) => !a.includes(".")) ?? addresses[0];
  return { urls, url: root ? urls[root] : deployedUrlFromOutput(output) };
}
