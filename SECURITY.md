# Security Policy

## Reporting a vulnerability

Do not report security vulnerabilities through public issues, pull requests or discussions.

Report them privately through GitHub's private vulnerability reporting:

1. Open the [Security tab](https://github.com/hyperglass-community/hyperglass/security) of this repository.
2. Select **Report a vulnerability**.
3. Fill in the advisory form.

Include, where you can:

- the affected Hyperglass version and deployment method
- the affected component, such as the API, a device platform or the UI
- steps to reproduce, or a proof of concept
- the impact you expect, such as information disclosure or command execution on a device

Remove device passwords, private keys, tokens and unredacted internal addresses from the report.

## Supported versions

| Version | Supported |
| ------- | --------- |
| 3.x     | Yes       |
| < 3.0   | No        |

Security fixes are released for the 3.x series only. Until 3.0.0 is released, the 3.0.0 release candidates are the supported line: 2.0.4, the latest stable release, does not receive fixes. Upgrade to the latest release candidate to get them.

## Response targets

- We aim to acknowledge a report within 7 days.
- We keep the reporter informed in the private advisory while we assess and fix the issue.

## What happens next

1. The report stays in a private GitHub security advisory, visible only to the reporter and the maintainers.
2. The maintainers confirm the issue and prepare a fix, in a temporary private fork if needed.
3. When the issue warrants one, a CVE is requested through GitHub.
4. The fix is released and the advisory is published. Disclosure is coordinated with the reporter, who is credited unless they ask not to be.
