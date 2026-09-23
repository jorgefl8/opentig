export function releaseApi(repository, token) {
  if (!/^[\w-]+\/[\w.-]+$/.test(repository) || !token) throw new Error('Release repository and token are required.');
  return async (method, route, body, allowMissing = false) => {
    const response = await fetch(`https://api.github.com/repos/${repository}${route}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json',
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(30000),
    });
    if (allowMissing && response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub ${method} ${route}: HTTP ${response.status}`);
    return response.json();
  };
}

export async function listReleases(api) {
  const releases = [];
  for (let page = 1; ; page += 1) {
    const batch = await api('GET', `/releases?per_page=100&page=${page}`);
    releases.push(...batch);
    if (batch.length < 100) return releases;
  }
}
