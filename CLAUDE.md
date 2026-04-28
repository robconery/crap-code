# Instructions

This application is a fulfillment application for Big Machine, my business. I sell access to online courses and books, and have a premium subscription. This app works with Stripe payloads and processes things as described in @SPEC.md.

There is an existing database and you can see the structure of the data, as well as some of the real data, in @reference.

The goal of this project to **avoid crap code**, and to use reasonable architectural patterns and principles (including Gang of Four) to avoid technical debt and to make changing things a bit easier in the future.

## Rules

- ALWAYS work in a branch, never `main`. If we are in `main`, stop and recommend a branch and offer to create one and move on.
- Always add comments to code, which explain the WHY, not the what. Do not comment variables unless there's a solid reason. Always comment on logic and choices in code.
- Use emoji for readability in all markdown documents.
- The entire process pipeline should be idempotent, even for duplicate data.
- DO NOT ALLOW SILENT FAILURE. `console.error` if there's ever a problem.
