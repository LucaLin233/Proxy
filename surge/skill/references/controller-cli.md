# Minis Surge CLI

A Python reimplementation of the transport and command-line surface used by Surge's `surge-cli --remote` mode, designed for iSH/Minis on iOS.

## Protocol

The External Controller transport is a CRLF-delimited command/result stream:

1. Client sends password plus CRLF.
2. Server returns a welcome JSON object plus CRLF.
3. Client sends one textual command line plus CRLF. The command verb is bare and every following argv item is double-quoted, for example `rule "match" "example.com"`.
4. Server returns one result JSON object, or a stream of JSON event objects.

Surge iOS Protocol 25 still accepts the legacy `{"argv":[...]}` JSON request discovered in older official remote-mode clients, but the formal Surge Mac 6.9.0 build 12250 CLI emits the textual command line above (documented conclusion from that build, not a re-measurement of the current runtime). The Minis client follows that documented textual encoding. Arguments containing CR/LF are rejected locally; ordinary quotes and backslashes are sent verbatim inside the quoted field, matching the official client. Per-build evidence and dates live only in the single table at [platform-compatibility.md](platform-compatibility.md), which is the execution criterion.

No HTTP API translation is used. The Surge Controller parses most command arguments, so ordinary commands track the connected Surge build. The client also reproduces the official CLI's known local conversions for `summary`, `profile diff`, `rule temp`, `watch speed`, and `script evaluate <file>` (including mock-type name to numeric ID conversion). Online `plugin` operations are ordinary Controller commands on macOS; the official CLI's offline `plugin validate` and `plugin pack` depend on local macOS tooling and are intentionally unavailable in iSH. `--raw` returns the resulting Controller JSON unchanged apart from compact serialization.

## Installation

`/usr/local/bin/surge-cli` is a symlink to `scripts/surge_cli.py`.

Default controller: `127.0.0.1:6170` (override with `SURGE_CLI_REMOTE` or `--remote`).

Credential precedence:

1. `--password-stdin`
2. `SURGE_API_KEY` — recommended for Minis; store it in Settings → Environment Variables

The client is non-interactive: it does not create or read password files and does not prompt for a password on a TTY. When `SURGE_API_KEY` is missing, offer the Minis environment-variable settings link rather than asking the user to disclose the password in chat. Calling-safety rules, re-confirmation of dangerous operations and data minimization live in [../SKILL.md](../SKILL.md) §3; this file only covers CLI credential precedence and transport.

## Remote management: Surge-specific behavior

Official guide: [Surge Remote Management](https://kb.nssurge.com/surge-knowledge-base/guidelines/remote-management) (reviewed 2026-09-26). Append `.md` to read its Markdown source. It documents official controllers; do not assume every UI/transport feature exists in this Minis implementation.

- **Ponte and remote loopback:** with a working, user-authorized Ponte route, `--remote <name>.sgponte:6170` reaches the remote Mac's loopback interface. Its External Controller can remain bound to `127.0.0.1`; do not widen the listener just to enable this access. Native Ponte device discovery/password-free management in Surge's UI is distinct from this CLI's host/port/password connection; keep Minis credential handling unchanged.
- **iOS reachability:** Surge iOS cannot act as a Ponte server. Remote cellular-network External Controller connections are rejected; Wi-Fi access requires Allow Access From Wi-Fi. These remote inbound restrictions do not by themselves establish whether same-device Minis loopback access works. Check the actual target and connection path.
- **USB:** the official Mac Surge Dashboard can manage a USB-connected iPhone/iPad, including while it uses cellular data. This Python CLI does not implement that USB connection method. Do not infer USB support from the generic External Controller capability table.
- **Authentication bans:** 10 failed password attempts within 30 seconds temporarily ban the source IP or local process. Stop repeated authentication attempts and consider a ban before diagnosing a dead service. Consult the command reference for `security ban` inspection/clear syntax; clearing a ban is not an automatic test-recovery step.
- **Ponte versus HTTP API:** the guide's comparison table marks HTTP API/Web Dashboard as not supporting Ponte. Distinguish native remote-management integration from reaching an HTTP port through an existing `.sgponte` tunnel; the table alone does not invalidate such a route. Verify the specific endpoint rather than silently changing instances.
- **Official versus Minis CLI:** the Mac CLI enters interactive mode without a command; Minis prints help. The guide's Mac-only capabilities (Gateway devices, plugins, unattended app upgrades) are not a command specification or permission to upgrade/restart. Check the exact platform, command and impact when needed.
- **Version mismatch:** missing remote features can reflect a controller/instance version mismatch or Mac-only capability, not a transport failure. The official guide recommends aligned current versions, including beta on both ends when applicable; diagnose first, do not automatically upgrade either device.

## Compatibility

Most commands are transparently passed to Surge. Human-readable formatting is implemented for common commands such as status, version, mode, features, policy groups, rule match/explain, DNS lookup/trace, modules, GeoIP, performance, and macOS VMNET diagnostics. Other commands print pretty JSON; use `--raw` for scripting and exact Controller data.

Protocol 23 added `vmnet status|arp|ndp|ra` (official release-note statement). The local client passes these through and can render their response, but the VMNET backend is macOS-only, so on iOS the command answers `Unsupported command` — as recorded for the historical iOS builds listed in [platform-compatibility.md](platform-compatibility.md), which is the execution criterion for protocol thresholds and platform limits.

Protocol 24 introduced `restart-engine`; the formal Surge iOS 5.22.0 release retained that documented behavior. Unlike `reload`, it completely restarts the engine, closes active connections, and clears caches and temporary rules. It uses the ordinary Controller command transport and returns `{"result":"success"}` before or during the restart. Capabilities beyond the release notes are not inferred from the protocol number alone. Verified builds, per-item conclusions and dates are maintained only in the single historical table at [platform-compatibility.md](platform-compatibility.md), which is the execution criterion — including the 2026-09-15 authentication/read-only retest on Controller build 3842; `restart-engine` was not retested on that build and its conclusion stays with the earlier build records.

- `--check <path>` / `-c <path>` uses Surge's official beta HTTPS validation service (`https://services.nssurge.com/v1/config/validate`) because the bundled macOS local parser is unavailable in iSH. It reads only the explicitly named UTF-8 file, POSTs a JSON `profile` field, prints `OK` or `Failed: ...`, and exits 0/1 like the official CLI. This is an upload: never substitute or upload the active profile implicitly, and warn/redact when a profile may contain server addresses, subscription URLs, usernames, passwords, PSKs, or other secrets.
