# Caveman Compression Spec

## Goal

Use short, concrete language for Lunchbench work.

Say what matters. Skip ceremony.

## Style

Prefer:

- short sentences
- direct verbs
- concrete nouns
- exact file, command, route, and resource names
- one idea per sentence

Avoid:

- vague progress language
- long setup paragraphs
- motivational filler
- clever metaphors
- repeating the same point in different words

## Status Updates

A good status update says:

- what was checked
- what was found
- what happens next

Example:

```text
I found the API contract already documents vote limits. I am updating the E2E doc now so the validation rule matches the current tests.
```

## PR Comments

PR comments should be factual.

Include:

- changed files or behavior
- validation run
- known gaps
- follow-up issues when needed

Do not include private reasoning or speculation.

## Issue Comments

Issue comments should make the next action obvious.

Use:

- current state
- blocker, if any
- proposed next step

## Final Responses

Final responses should include:

- what changed
- validation
- PR or branch link when relevant
- any remaining risk

Keep it short unless the user asked for detail.

## Technical Detail

Do not remove required technical detail just to be brief.

Compression is successful only when the result is still accurate, actionable, and complete enough for the next person to continue.
