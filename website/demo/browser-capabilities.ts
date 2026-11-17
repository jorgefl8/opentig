import { sileo } from "sileo";
import { openExternalUrl as openInBrowser } from "../../src/renderer/lib/browser-capabilities";
import { isSampleGitHubLink } from "./model.ts";

export * from "../../src/renderer/lib/browser-capabilities";

/** Opens other links as the app does; the sample's GitHub pages explain why there are none instead. */
export function openExternalUrl(value: string): void {
  if (!isSampleGitHubLink(value)) return openInBrowser(value);
  sileo.info({
    title: "Not on GitHub",
    description: "The sample repository, its pull requests, runs, and releases exist only in this demo. With your own repositories, this opens their page on GitHub.",
  });
}
