# Workspace review fixture

Generated with pnpm 10.11.1 using `pnpm install --lockfile-only --ignore-scripts`.
Three importers resolve the same real registry package: app/lib use is-number 7.0.0,
svc uses 6.0.0. No packages are installed or scripts executed. The committed lockfile
contains pnpm's actual resolutions and integrity strings. Tests copy this tree and
make explicit offline lockfile/package changes; they do not contact a registry.
