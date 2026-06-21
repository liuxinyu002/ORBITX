---
name: openspec-test-reinforce
description: Test hardening for an OpenSpec change — Review → Plan → Execute → Report. Use when the user wants to reinforce an implemented change with tests, calls /opsx:harden, or asks to harden/test a change.
license: MIT
compatibility: Requires openspec CLI.
metadata:
  author: openspec
  version: "1.0"
  generatedBy: "1.3.1"
---

Test hardening for an OpenSpec change. This skill is triggered by `/opsx:harden [change-name]`.

All execution logic, phase definitions, output templates, and guardrails are defined in the command Prompt at `.claude/commands/opsx/harden.md`. This file only serves as a skill registration entry point.
