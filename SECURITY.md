# Security Policy

## Reporting a vulnerability

If you discover a security vulnerability, please report it responsibly.

**Do NOT open a public GitHub issue.**

Instead, email us at **security@skynul.com** with:

- Description of the vulnerability
- Steps to reproduce
- Potential impact
- Suggested fix (if any)

We will acknowledge your report within 48 hours and work with you to resolve it.

## Scope

The following are in scope:

- Authentication bypass
- Authorization issues
- Path traversal / file access outside sandbox
- SSRF via URL validation bypass
- Command injection via shell filter bypass
- Cross-site scripting (XSS) in API responses
- Secrets exposure

## Out of scope

- Denial of service attacks
- Social engineering
- Issues in third-party dependencies (report upstream)
- Issues requiring physical access

## Security measures

This project implements several security layers:

- **Bearer token auth** with constant-time comparison
- **CORS origin allowlist**
- **Path sandboxing** — file ops restricted to `$HOME`, `$CWD`, `/tmp`
- **SSRF protection** — private IPs, localhost, metadata endpoints blocked
- **Shell command filtering** — dangerous patterns blocked
- **Error sanitization** — stack traces hidden in production
