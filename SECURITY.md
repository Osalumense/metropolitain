# Security Policy

This only covers genuine security vulnerabilities. Regular bugs, feature requests, and contributions are all welcome as normal public [GitHub Issues](../../issues) and PRs — see [README.md](README.md#contributing). Nothing below changes that.

This project runs a real, publicly-deployed service at [metropolitain.live](https://metropolitain.live). If you find an actual security vulnerability — something exploitable, like a way to bypass CORS/origin checks, leak secrets, or abuse the API/WebSocket beyond its intended use — report it privately (below) instead of as a public issue, so it isn't a working exploit for anyone reading issues before it's fixed.

## Reporting

Email **harkugbeosaz@gmail.com** with:
- A description of the issue and its potential impact
- Steps to reproduce, or a proof of concept
- Any relevant logs or requests (redact anything sensitive)

You should get a response within a few days. Please don't test in ways that could disrupt the live service for other users (e.g. load/DoS testing) — a description or a low-impact proof of concept is enough.

## Scope

In scope: this repository's code, its Docker/nginx deployment configuration, and the live site's behavior.

Out of scope: Île-de-France Mobilités' own API and infrastructure — report those directly to IDFM.
