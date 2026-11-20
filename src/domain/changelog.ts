/** Release as written in CHANGELOG.md: version plus the bullet points a user should see. */
export type ChangelogRelease = { version: string; notes: string[] };

/** Sections of a release that describe deployment steps for the maintainer, not changes for users. */
const MAINTAINER_SECTION = /^###\s*Для развёртывания/i;

/**
 * Releases of CHANGELOG.md with their user-facing bullet points, newest first.
 * The section «Для развёртывания» is skipped: it is for the maintainer and is not shown to users.
 */
export function parseChangelog(text: string): ChangelogRelease[] {
  const releases: ChangelogRelease[] = [];
  let skipping = false;
  for (const line of text.split("\n")) {
    const heading = /^## (\d+\.\d+\.\d+(?:-[0-9A-Za-z.]+)?)/.exec(line);
    if (heading) {
      releases.push({ version: heading[1], notes: [] });
      skipping = false;
    } else if (line.startsWith("### ")) {
      skipping = MAINTAINER_SECTION.test(line);
    } else if (line.startsWith("- ") && releases.length && !skipping) {
      releases[releases.length - 1].notes.push(line.slice(2).trim());
    }
  }
  return releases;
}
