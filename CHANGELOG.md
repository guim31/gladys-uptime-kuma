# Changelog

All notable changes to this integration are documented in this file. The format
follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project
uses [semantic versioning](https://semver.org/).

Describe each change under `## [Unreleased]` as you make it. The Release
workflow moves that section under the version it ships, and the section becomes
the notes of the version's GitHub Release.

## [Unreleased]

## [1.0.2] - 2026-10-22

### Security

- Rebuilt on Node.js 24.22.1, the October 2026 security release (remote code
  execution in the Brotli decoder, CVE-2026-111497; TLS hostname and DNS
  fixes).

## [1.0.1] - 2026-10-13

### Changed

- Quieter logs: when Gladys refuses the monitors' states, their badges, the
  connection status or the device list, or when the data folder cannot be
  written, the integration logs one line when the problem starts and one when
  it is over, instead of one line at every refresh. The same goes for an
  unexpected error of the refresh loop.

## [1.0.0] - 2026-10-12

### Added

- One Gladys device per Uptime Kuma monitor, proposed in the Discover tab:
  up (on/off), response time in milliseconds and, for an HTTPS site, the days
  until the certificate expires. Feature names are in French by default
  (English, German and Spanish available).
- Uptime Kuma 1.23 and 2.x, read through their `/metrics` endpoint with an API
  key; up to two instances. A device added under Uptime Kuma 1.x keeps its
  identity after the upgrade to 2.x.
- Scene triggers for every monitor, added to Gladys or not: a service goes
  down, a service is back up (with the length of the outage), certificate
  expires soon (threshold chosen in the configuration, once per certificate)
  and Uptime Kuma no longer answers. Transitions that happen while Gladys or
  the integration restarts are still announced, once.
- Scene actions: the state of a service (up, the state in words, the response
  time, the days left on the certificate) and the count of the services down
  with their names, for a message.
- An "Uptime Kuma" dashboard widget: services down and up, the next
  certificate to expire, one row per monitor (problems first), every monitor
  or the chosen ones, and a Refresh button.
- A "Test the connection" button, a connection status naming the instance and
  the problem (key refused, no Uptime Kuma at this address, certificate…), and
  a transport badge per device.
- Interface texts and documentation in English, French, German and Spanish.
- Apache-2.0 `LICENSE` file.

[Unreleased]: https://github.com/guim31/gladys-uptime-kuma/compare/v1.0.2...HEAD
[1.0.2]: https://github.com/guim31/gladys-uptime-kuma/compare/v1.0.1...v1.0.2
[1.0.1]: https://github.com/guim31/gladys-uptime-kuma/compare/v1.0.0...v1.0.1
[1.0.0]: https://github.com/guim31/gladys-uptime-kuma/releases/tag/v1.0.0
