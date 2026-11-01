# Security Policy

## Supported versions

Wither is in early development. Security fixes are made on the main branch and shipped in the next release. Only the latest release receives fixes.

| Version | Supported |
| --- | --- |
| Latest release | Yes |
| Older releases | No |

## Reporting a vulnerability

Please do not report security vulnerabilities through public issues, discussions or pull requests.

Report them privately through GitHub instead:

1. Go to the [Security tab](https://github.com/SemihAkin685/Wither/security) of the repository.
2. Click "Report a vulnerability".
3. Describe the issue, the affected version and the steps to reproduce it. A proof of concept helps a lot.

You can also use [this direct link](https://github.com/SemihAkin685/Wither/security/advisories/new).

## What to expect

- We acknowledge your report within 7 days.
- We keep you updated while we investigate and work on a fix.
- Once a fix is released we publish a security advisory and credit you, unless you would rather stay anonymous.

Please give us a reasonable amount of time to release a fix before you disclose the issue publicly.

## Scope

Things we are especially interested in:

- Ways for web content, a workspace file or an addon to run code or call Tauri commands it shouldn't
- Escaping the IPC permissions in apps/desktop/src-tauri/capabilities
- Problems in how the terminal panel spawns or talks to shell processes
- Vulnerable dependencies that are actually reachable in Wither

Out of scope: issues that need an already compromised machine, and commands you type yourself in the terminal panel, since it runs your own shell with your own permissions by design.
