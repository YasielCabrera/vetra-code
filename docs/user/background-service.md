# Background service status

The Linux background-service implementation remains in the codebase, but installing it is not a
supported Vetra Code bootstrap workflow because `@vetra-code/server` is private and unpublished.

For development, keep `pnpm dev --home-dir <isolated-directory>` running in a terminal or in a
process supervisor that you configure explicitly. The package-based `npx vetra service ...` path remains
unavailable until Vetra publishes and validates its own server package.

Vetra service distribution becomes supported after the server package is published from a
Vetra-owned registry and the install/update path is tested against `vetra-code.service` and
`~/.vetra-code`.
