# Pond for Raycast

Search your active Pond Library, save URLs, open Saves, and switch recent
Libraries from Raycast. Every request stays on your Mac and uses Pond's
authenticated loopback API.

## Install for development

You need macOS, [Raycast](https://www.raycast.com/) with a signed-in account,
Node.js 24, pnpm 11.27.0, and a local Pond build.

From a clean checkout:

```bash
pnpm install
pnpm --dir apps/raycast develop
```

Raycast opens and imports Pond into its Development section. Stop the command
with `Ctrl+C` after the first successful build if you do not need live reload;
the imported commands remain available in Raycast.

## Connect to Pond

1. Open Pond and keep it running. You can enable **Launch at Login** and
   **Launch in Background** if you want the commands available after restart.
2. Open **Pond Settings → General → Raycast**.
3. Select **Copy Token**.
4. Open Raycast, search for **Pond**, then open **Configure Extension**.
5. Paste the token into **Local API Token**.

The default API address is `http://127.0.0.1:41610/api/v2`. Update **Local API
URL** if you changed Pond's local API port.

## Commands

- **Search Library** finds Saves and opens them in Pond or at their original URL.
- **Save URL** saves a URL you enter.
- **Save Clipboard URL** saves an `http` or `https` URL from the clipboard.
- **Switch Library** lists available recent Libraries and reopens Pond in one.
- **Open Library** opens the active Library in Pond.

## Troubleshooting

| What you see | What to do |
| --- | --- |
| “Open Pond and check the Local API URL.” | Open Pond, then confirm **Local API URL** is `http://127.0.0.1:41610/api/v2` unless you changed Pond's port. |
| “Copy a fresh Local API Token from Pond Settings.” | Copy the current token from **Pond Settings → General → Raycast** and replace the saved Raycast preference. Rotating the token invalidates the previous value immediately. |
| “Enter an http or https URL.” | Enter or copy a complete URL beginning with `http://` or `https://`. |
| A Save or file is unavailable | Refresh the command. If the Save was deleted or its file is missing, reopen Pond to inspect or repair it. |

## Development

`develop` is the only watch command. Use the finite checks below for validation:

```bash
pnpm --dir apps/raycast typecheck
pnpm --dir apps/raycast lint
pnpm --dir apps/raycast build
```

The root `pnpm check` and `pnpm build` commands also include this workspace
package, so the normal repository CI covers its typecheck, lint, and production
build.

This is the one workspace package that does not use the `catalog:` protocol.
`@raycast/api` pins `@types/node` and `@types/react` to exact versions as peer
dependencies, and `ray build` validates against them, so `react` and both type
packages stay on the versions Raycast requires rather than the catalog's.

## Live validation

With Pond and the development extension open, check the integration before a
release-related change:

1. Run **Search Library**, search for a known Save, open it in Pond, open its
   source URL, and copy its first available file.
2. Run **Save URL** with a valid URL and confirm the Save appears in the active
   Library. Repeat with an invalid value and confirm Raycast explains the valid
   schemes.
3. Copy an `http` or `https` URL, run **Save Clipboard URL**, and confirm the
   Save appears. Repeat with non-URL clipboard text.
4. Run **Switch Library**, choose another recent Library, and confirm Pond
   reopens it.
5. Run **Open Library** and confirm Pond comes to the foreground with the active
   Library.
6. Quit Pond and confirm a command tells you to open it and check the Local API
   URL.
7. Reopen Pond, rotate the Local API token, and confirm the old token is
   rejected. Paste the new token into Raycast and confirm access returns.
8. Delete a test Save or remove its local file, then confirm Raycast reports the
   unavailable item instead of failing silently.

## Distribution

The supported distribution path today is local development installation from
this repository. `pnpm --dir apps/raycast build` validates the optimized bundle
but does not publish it, and Pond's `vX.Y.Z` GitHub release workflow does not
ship or update the Raycast extension.

A future public Raycast Store submission is a separate release. It must follow
Raycast's [publishing guide](https://developers.raycast.com/basics/publish-an-extension),
including Store review and any required changelog, media, and npm lockfile in
the submitted extension package. Do not run a Raycast publish command as part
of the Pond desktop release.
