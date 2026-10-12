# Security policy

## Reporting a vulnerability

Please do **not** report a security problem in a public issue, pull request or
forum post.

Report it privately through GitHub instead: open the **Security** tab of this
repository, then **Report a vulnerability**.

No such button? Private reporting is not enabled yet: open an issue that only
asks the maintainers for a private contact, without any detail of the problem,
and send the report there.

Include, when you can:

- the version of the integration and of Gladys;
- what an attacker can do, and the steps to reproduce it;
- the log lines that help (remove tokens, passwords and addresses first).

The fix ships as a new version of the integration, and the advisory is
published once users can update.

## Supported versions

Only the latest release receives security fixes: update the integration from
Gladys before reporting a problem.

## Scope

In scope: the code of this repository and the Docker image it publishes.

What the integration handles:

- **Secrets**: the Uptime Kuma API keys are `secret` fields of the Gladys
  configuration. The integration reads them from Gladys at startup, keeps them
  in memory, sends them only to the Uptime Kuma they belong to (HTTP Basic
  password of `GET /metrics`), and never writes them to `/data` nor to the
  logs. A key of Uptime Kuma can only read its metrics; the integration never
  asks for the administrator password.
- **Stored in `/data`**: `uptime-kuma-state.json`, the last state of each
  monitor (up, down or maintenance) and since when, the certificates already
  announced, and the identities of the devices added under Uptime Kuma 1.x —
  monitor keys and timestamps, no names, addresses or secrets.
- **Network**: requests go only to the Uptime Kuma addresses typed in the
  configuration, in HTTP or HTTPS. HTTPS certificates are verified unless the
  user ticks "Accept self-signed certificates"; the integration opens no port
  and calls no cloud service.

Out of scope: Gladys Assistant itself (see its
[security policy](https://github.com/GladysAssistant/Gladys/security/policy)),
Uptime Kuma itself (see its
[security policy](https://github.com/louislam/uptime-kuma/security/policy)),
and the services it monitors.
