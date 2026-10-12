# Uptime Kuma `/metrics` answers used by the tests

- `v1-1.23.17.txt` and `v2-2.5.6.txt`: real answers of the Docker images
  `louislam/uptime-kuma:1` (1.23.17) and `louislam/uptime-kuma:2` (2.5.6),
  recorded on 12/10/2026 with an API key, after adding six monitors: an HTTP
  site, an HTTPS site with a self-signed certificate valid 10 days ("ignore
  TLS errors" ticked), an open TCP port, a closed TCP port, a keyword check
  whose name holds quotes, and an empty group. On 2.x, the HTTP monitor
  carries the tag `Home: lab` (a tag becomes a label after a restart of
  Uptime Kuma). The test web server's container name is replaced by
  `web.home.arpa`.
- `pythonkuma-metrics.txt`: the test fixture of
  [pythonkuma](https://github.com/tr4nt0r/pythonkuma) (MIT, © 2025 Manfred
  Dennerlein Rodelo), an Uptime Kuma 2.1.0 with tags, a JSON query and an
  unknown monitor type.
