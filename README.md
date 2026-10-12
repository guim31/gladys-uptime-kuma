# Uptime Kuma for Gladys Assistant

An external integration for [Gladys Assistant](https://gladysassistant.com) that
brings the monitors of [Uptime Kuma](https://uptime.kuma.pet/), the
self-hosted monitoring tool, into Gladys: one device per monitor, scenes that
react when any service goes down or comes back, and a dashboard widget. It
reads the `/metrics` endpoint of Uptime Kuma 1.23 and 2.x with an API key,
over the local network. No cloud, no account.

> Tested against real Uptime Kuma 1.23.17 and 2.5.6 servers (Docker), not yet
> in a real Gladys: feedback welcome in the
> [issues](https://github.com/guim31/gladys-uptime-kuma/issues).

## Features

- **One device per monitor**, proposed in the Discover tab (the user adds the
  ones to follow): **Up** (on/off, a Yes/No condition in scenes), **Response
  time** (ms) and, for an HTTPS site, **Days until certificate expiry**.
  Feature names in French by default (English, German and Spanish available).
- **Scene triggers**, for every monitor, added to Gladys or not — no need for
  one scene per device: _A service goes down_ and _A service is back up_ (with
  the monitor name, type, URL and the outage length), _Certificate expires
  soon_ (threshold in days, once per certificate) and _Uptime Kuma no longer
  answers_.
- **Scene actions**: _State of a service_ (up, the state in words, the
  response time…) and _Count the services down_ (counts and names, for a
  message).
- **Dashboard widget** "Uptime Kuma": services down and up, the next
  certificate to expire, one row per monitor (problems first, response
  times), every monitor or the chosen ones, and a **Refresh** button.
- Up to **two Uptime Kuma instances** (for example one at home and one outside
  watching the home), a **Test the connection** button, a connection status
  naming the instance and the problem, a **transport badge** per device.
- Every text in English, French, German and Spanish.

## Requirements

- Gladys Assistant **5.1.0** or later (widgets, scene triggers and actions).
- **Uptime Kuma 1.23 or 2.x**, reachable from the Gladys machine.
- An **API key** of Uptime Kuma (Settings → API Keys), or its authentication
  disabled.

## Installation

1. In Gladys, open **Integrations** → **Install from GitHub** and enter the
   address of this repository: `https://github.com/guim31/gladys-uptime-kuma`
   (or install **Uptime Kuma** from the catalog once it is listed).
2. In **Configuration**, enter the address of Uptime Kuma
   (`http://192.168.1.2:3001`, `https://status.example.com`…), the API key and
   a name; a second instance below if you have one. Save, then click **Test
   the connection**.
3. Open the **Discover** tab and add the monitors to follow.

The user guide is in [`docs/en.md`](docs/en.md) (also in
[French](docs/fr.md), [German](docs/de.md) and [Spanish](docs/es.md)); Gladys
links it from the Configuration screen.

## How it works

- Every refresh interval (15 s to 5 min, 30 s by default), the integration
  reads `GET /metrics`, the Prometheus endpoint of Uptime Kuma, with the API
  key as HTTP Basic password (empty user name) — the stable, documented read
  API, the one Home Assistant uses. Per monitor: `monitor_status` (0 down,
  1 up, 2 pending, 3 maintenance), `monitor_response_time`,
  `monitor_cert_days_remaining`, and the name, type, URL, host and port
  labels; `app_version` gives the version.
- **Identity**: the configuration slot of the instance and the monitor id
  (`monitor_id`, Uptime Kuma 2.x). Uptime Kuma 1.x publishes no id: there, a
  monitor is keyed on its name (a hash of it). A device added under 1.x keeps
  its identity after the upgrade to 2.x (the alias is kept in `/data`).
- **Transitions** are computed on the settled state (up, down, maintenance):
  _pending_ (a failed check being retried) changes nothing, so the triggers
  follow the retries configured in Uptime Kuma. The last state of each monitor
  and since when are kept in `/data/uptime-kuma-state.json`: an outage that
  starts or ends while Gladys or the integration restarts is still announced,
  once, with its real length. The first read after installation only records
  the states.
- Only the values that changed are sent to Gladys, only for the devices added,
  all of them again when a device is added or Gladys reconnects; a response
  time is sent at most once a minute per monitor (it changes at every check).
- An instance counts as unreachable after two failed reads in a row (the
  second 15 s after the first), counting only silence: a refused key is a
  configuration problem, shown in the connection status.
- The devices are published with `should_poll: false`: the interval goes
  beyond the list of the Gladys scheduler, and the scene events must fire for
  monitors whose device was not added.
- **Read only, on purpose**: pausing or resuming a monitor goes through the
  Socket.IO API of the Uptime Kuma web interface, which needs the
  administrator's user name, password and 2FA code — not something to store
  in Gladys for a convenience.
- HTTP(S) runs on `node:http` / `node:https`, so a self-signed certificate can
  be accepted for this instance only, when the user ticks the option.

## Checked on a real Uptime Kuma, and what was not

See the section of the same name in [`CLAUDE.md`](CLAUDE.md#vérifié-sur-un-vrai-uptime-kuma)
for the details. In short, on 12/10/2026 the Docker image of the integration
ran with the Gladys sandbox constraints (read-only root, all capabilities
dropped, 256 MB, bridge network) against real `louislam/uptime-kuma:1`
(1.23.17) and `:2` (2.5.6) containers, with HTTP, keyword, TCP, group and
self-signed HTTPS monitors. Not checked: a real Gladys (the widget, the scene
editor), a reverse proxy in front of Uptime Kuma, Uptime Kuma with MariaDB.

## Limitations

- Read only (no pause, resume or edit of monitors).
- An outage shorter than the refresh interval may go unseen; its length is
  known to the interval.
- Under Uptime Kuma 1.x, a renamed monitor becomes a new device.
- Tags, uptime percentages and status pages are not used.
- Uptime Kuma answers 60 API requests per minute at most, shared by every
  tool reading `/metrics`.

## Development

```bash
npm ci
npm run format:check
npm run lint
npm test
npx -y github:GladysAssistant/integration-store --skip-image-check .
```

The tests use the fake Gladys of the SDK (`@gladysassistant/integration-sdk/testing`)
and an in-memory Uptime Kuma (`test/helpers/fakeKuma.js`) whose `/metrics` is
checked against real answers of Uptime Kuma 1.23.17 and 2.5.6
(`test/fixtures/kuma/`). See [`CLAUDE.md`](CLAUDE.md) for the project rules.

## Credits

- [Uptime Kuma](https://github.com/louislam/uptime-kuma) by Louis Lam and
  contributors (MIT): the metrics read here (`server/prometheus.js`) and the
  API key authentication (`server/auth.js`). The logo on the cover comes from
  its repository (`public/icon.svg`, MIT).
- [pythonkuma](https://github.com/tr4nt0r/pythonkuma) by Manfred Dennerlein
  Rodelo (MIT), the library of Home Assistant's
  [`uptime_kuma`](https://github.com/home-assistant/core/tree/dev/homeassistant/components/uptime_kuma)
  integration (Apache-2.0): the choice of `/metrics` and of the sensors; its
  test fixture is reused in `test/fixtures/kuma/pythonkuma-metrics.txt`.
- The architecture and the conformity tests follow
  [gladys-pihole](https://github.com/guim31/gladys-pihole) and
  [gladys-wled](https://github.com/guim31/gladys-wled).

## Disclaimer

This project is not affiliated with, endorsed or sponsored by Uptime Kuma or
its authors.

## License

Apache-2.0
