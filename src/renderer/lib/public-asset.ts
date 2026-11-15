/**
 * The address of a file in `public/`. The app's own addresses are paths such as
 * `/r/<repository>/file/src/app.ts`, so a relative address would point under them;
 * the website demo serves the same files from its own folder.
 */
export function publicAsset(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}
