# Project Management

## Goals

Project management for Lunchbench should keep the project easy to steer while it is still greenfield.

The goals are:
- keep durable decisions in markdown docs
- keep GitHub issues small and actionable
- avoid hidden requirements that only exist in chat
- keep implementation work tied to a clear behavior, API, schema, or UI outcome

## Source Of Truth

Use this order:

1. Repo docs in `docs/`
2. GitHub issues and pull requests
3. Chat context

If chat changes a durable project decision, update the relevant doc before or during implementation.

## When To Update Docs

Update docs when a change affects:

- product behavior
- API routes or payloads
- database schema or migration procedure
- Cloudflare resource configuration
- deployment behavior
- validation policy
- UI direction

Use existing docs when possible. Add a new doc only when the topic is broad enough to stay useful.

## Issue Style

Issues should be small and concrete.

Good issue bodies include:
- why the work exists
- what should change
- non-goals
- acceptance criteria
- required validation

Use human-owned issues for external account, billing, dashboard, DNS, or secret-provisioning work. Use agent-owned issues for repo changes.

## Branch And PR Style

Use short branch names:

```bash
codex/<short-description>
```

PR descriptions should cover:
- what changed
- why it changed
- how it was validated
- any follow-up work

Do not merge documentation, behavior, schema, and deployment changes together unless they are tightly connected.

## Greenfield Bias

Lunchbench is young. Prefer clear docs and simple code over compatibility machinery.

Do not add process for a future team size that does not exist yet.
