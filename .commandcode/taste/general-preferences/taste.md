# General Preferences
- Expects the agent to autonomously explore/inspect the whole project first (list files, read docs and source) before answering, rather than asking clarifying questions up front. Confidence: 0.55
- Wants review/improvement output framed from a role perspective (e.g. "as a tester and as a Flutter developer") and delivered as concrete, prioritized, actionable proposals — not just a description of the code. Confidence: 0.5
- Works primarily in Flutter/Dart and prefers suggestions that leverage ecosystem packages and idiomatic Dart/Flutter project structure (pub packages, proper lib/src layout, dev_dependencies). Confidence: 0.5
- For larger, multi-part changes, wants a structured written plan agreed on before any code is written, then execution against that plan (asked to "make a plan and start doing it"). Confidence: 0.5
- Prefers simple, memorable repo-root dev entry points: a convenience launcher script (e.g. `run.sh`) plus a top-level Makefile with a simple target (e.g. `make run`) to build/run the whole project, instead of remembering raw commands or relying on npm scripts alone. Confidence: 0.6
- When moving to a next phase/milestone, wants the agent to first restate what that phase entails and explicitly wait for a go-ahead before starting work, rather than proceeding autonomously. Confidence: 0.6
