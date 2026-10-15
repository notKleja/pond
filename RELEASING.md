# Releasing Pond

This fork ships through **GitHub Releases** under `notKleja/pond`: signed and
notarized macOS `.dmg` and `.zip` files (arm64 + x64), an unsigned Windows x64
NSIS installer, updater metadata for both platforms, and a browser extension
`.zip`.

## Version bump

The desktop app, browser extension, and website release metadata ship in lockstep with the `vX.Y.Z` GitHub tag. The release workflow rejects a tag when any value below differs. `@pond/cli` is published independently to npm from `packages/cli/package.json`; a desktop release does not require a CLI bump, and a CLI release does not change the desktop, extension, or website version. Other private workspace package versions are not Pond release inputs.

Update the version string in all of these before tagging:

| File | Field |
|------|-------|
| [`apps/desktop/package.json`](apps/desktop/package.json) | `"version"` |
| [`apps/extension/package.json`](apps/extension/package.json) | `"version"` |
| [`apps/extension/wxt.config.ts`](apps/extension/wxt.config.ts) | `manifest.version` |
| [`apps/website/lib/release.ts`](apps/website/lib/release.ts) | `POND_VERSION` |

Hero and footer read the version from `POND_VERSION`, so they update with that file.

Then refresh the SBOM, which carries the root `package.json` version:

```bash
pnpm sbom:generate && pnpm lint:fix
```

`pnpm sbom` writes JSON that the formatter rewrites, so `pnpm check` fails without the second step.

Commit the bump on `main`.

## Tag and publish

```bash
git tag v1.0.1
git push origin v1.0.1
```

Pushing a tag matching `v*` triggers [`.github/workflows/release.yml`](.github/workflows/release.yml), which:

1. Runs lint, typecheck, tests, build, and the desktop smoke test
2. Creates a draft release for the tag, unless one exists, and uploads the extension zip
3. Independently packages Windows x64 and signed, notarized macOS builds
4. Stops the macOS job if any Apple signing secret is missing without blocking the parallel Windows job
5. Publishes the draft only after both platform jobs succeed, which makes it visible to the updater

To write release notes before it goes live, edit the draft while the workflow runs.

Release tag format must be `vX.Y.Z` (e.g. `v1.0.1`). Notarization usually adds 10 to 15 minutes to the packaging step.

Artifact names (used by the website download links and the updater):

- `Pond-<version>-arm64.dmg`
- `Pond-<version>-x64.dmg`
- `Pond-<version>-arm64.zip`
- `Pond-<version>-x64.zip`
- `latest-mac.yml`
- `Pond-<version>-x64.exe`
- `Pond-<version>-x64.exe.blockmap`
- `latest.yml`
- `pond-extension-<version>.zip`

## Signing

The release workflow reads five repository secrets:

| Secret | Value |
|------|-------|
| `CSC_LINK` | Base64 of the Developer ID Application `.p12` |
| `CSC_KEY_PASSWORD` | Password for that `.p12` |
| `APPLE_ID` | Apple Account email for notarization |
| `APPLE_APP_SPECIFIC_PASSWORD` | App-specific password for that account |
| `APPLE_TEAM_ID` | Developer team ID |

The Developer ID certificate expires on November 14, 2027. Create a new one before then and replace `CSC_LINK` and `CSC_KEY_PASSWORD`.

## Upstream Homebrew

The repository contains a tap-compatible cask at
[`Casks/pond.rb`](Casks/pond.rb). Install it with:

```bash
brew tap raphaelsalaja/pond https://github.com/raphaelsalaja/pond
brew install --cask raphaelsalaja/pond/pond
```

This cask follows the upstream `raphaelsalaja/pond` release. The fork release
workflow does not rewrite it with fork checksums, and the installed upstream
application does not include this fork's Windows port or Library replication.

## Local packaging (without publish)

```bash
pnpm install
pnpm dist:mac
pnpm dist:win
```

Artifacts land in `apps/desktop/dist/`.

The `Package desktop` verification workflow builds each Mac architecture on a
native runner: `macos-latest` for arm64 and `macos-15-intel` for x64. Use
`pnpm dist:mac:arm64` or `pnpm dist:mac:x64` for the matching local
architecture; this keeps native modules and FFmpeg aligned with the app.

The root command builds the desktop once, then packages `out/**`. Desktop
`dist:*` scripts consume an existing build and do not run Electron/Vite again.

Extension zip:

```bash
pnpm --filter @pond/extension zip
```

## CLI publishing

The `@pond/cli` npm package has an independent release policy from the desktop
app. Before publishing it, run:

```bash
pnpm --filter @pond/cli build
pnpm --filter @pond/cli test
pnpm --filter @pond/cli pack:check
```

Confirm the tarball contains `dist`, `README.md`, and `skill`, and that the
published `pond --version` matches `packages/cli/package.json`.

## Smoke test checklist

Run these before announcing a release:

- [ ] GitHub Release contains versioned arm64 + x64 `.dmg` and `.zip`, `latest-mac.yml`, Windows x64 `.exe` + blockmap, `latest.yml`, and `pond-extension-X.Y.Z.zip`
- [ ] `spctl -a -vv /Volumes/Pond/Pond.app` reports `Notarized Developer ID`
- [ ] Fresh Mac: download arm64 DMG → open Pond → it launches without a Gatekeeper prompt
- [ ] Website Download buttons hit the new artifacts
- [ ] Open Pond once so it registers the native host
- [ ] Load the extension unpacked → click the Pond icon or right-click a page → save appears in Pond
- [ ] Settings → **Check for Updates** → shows "You're on the latest version"
- [ ] Optional: tag a patch on a fork and confirm auto-update downloads the new build

## Notes

- **Local packaging**: `pnpm dist:mac` signs with a Developer ID identity in your login keychain and skips notarization unless the Apple variables are set.
- **Auto-update**: Requires the published `latest-mac.yml` from the release workflow. Dev builds skip the updater.
- **Windows**: The x64 NSIS build is enabled. Windows arm64 remains disabled until its native dependency set is verified on an arm64 runner.
- **Linux**: Builds remain disabled.
