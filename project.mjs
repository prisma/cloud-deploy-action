// Finds the project a single-app deploy targets. A Composer deploy names its
// project through the module; a single app has no module to name it.

const TIMEOUT_MS = 15_000;

/**
 * Returns the project id or name to pass to `prisma deploy --project`.
 *
 * The `project` input wins. Without it, the credential decides: the token a
 * connected repository gets through GitHub OIDC can read exactly one project,
 * the one the repository is linked to. A token that can read several projects
 * (a workspace-wide PRISMA_SERVICE_TOKEN) needs the input.
 *
 * @param {string} explicit - The trimmed project input ("" when unset).
 * @returns {Promise<string>}
 */
export async function resolveSingleAppProject(explicit, { apiUrl, token, fetchImpl = fetch }) {
  if (explicit) return explicit;

  let response;
  try {
    response = await fetchImpl(`${apiUrl.replace(/\/$/, "")}/v1/projects?limit=2`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (error) {
    throw new Error(`could not list the projects this credential can read (${error.message}); set the project input`);
  }
  if (!response.ok) {
    throw new Error(`could not list the projects this credential can read (HTTP ${response.status}); set the project input`);
  }
  const projects = (await response.json()).data ?? [];
  if (projects.length === 1 && typeof projects[0]?.id === "string") return projects[0].id;
  throw new Error(
    projects.length === 0
      ? "this credential can read no project; connect the repository to a project in the Prisma Console, or set the project input"
      : "this credential can read more than one project; set the project input to the project id or name",
  );
}
