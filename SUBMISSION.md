# Project Submission: StudyMesh

## Overview
StudyMesh demonstrates decentralized multi-agent collaboration running in a static web environment. Designed for college students and self-learners, it addresses three core learning needs:
- Time budgeting for academic deadlines
- Step-by-step guidance for data structures and algorithms
- Intuitive explanations for engineering fundamentals

## Architecture Highlights
- **Decentralized Runtime**: Executes vanilla ES modules in the browser with zero npm runtime dependencies.
- **Declarative Graph**: The agent network topology is defined entirely in JSON (`studymesh.network.json`).
- **Discovery**: Exposes capabilities via `agent-manifest.json` and RFC 8615 well-known endpoints (`.well-known/nsdeploy.json`).
- **Trust Boundaries**: Utilizes native modal dialogs before any sub-agent delegation occurs, showing `Private context shared: NONE`.
- **Fail-Closed Resilience**: If remote LLM inference encounters CORS restrictions, rate limits, or network failures, the runtime switches to its built-in offline engine.
