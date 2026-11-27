# StudyMesh: Decentralized Open Agentic Student Platform

StudyMesh is an open agentic website built for the Open Agentic Web Challenge (Cognizant AI Lab, MIT NANDA, Mozilla Otari). It implements a multi-agent system executing directly in the client browser without backends, compilers, or server runtimes.

## Key Features

1. **Client-Side Agent Network**:
   - `study_coordinator`: Front-man routing agent decomposing inquiries and synthesizing responses.
   - `deadline_planner`: Constructs day-by-day study calendars with time budgeting and buffer planning.
   - `dsa_coach`: Offers a three-tier hint ladder for algorithmic problems without disclosing full code by default.
   - `concept_explainer`: Clarifies engineering concepts using an intuitive analogy and a code walkthrough.

2. **Zero-Trust Delegation Consent**:
   - Every delegation requires confirmation via a native `<dialog closedby="any">`.
   - Explicit guarantee displayed: `Private context shared: NONE`.
   - Declining cancels the step cleanly without interrupting other tasks.

3. **BYOK & Offline Execution**:
   - Bring-Your-Own-Key configuration stored strictly in browser `sessionStorage`.
   - Automatic fallback to the deterministic offline engine if no key is present or if remote inference fails.

4. **Standards & Spec Conformance**:
   - Discovered through `agent-manifest.json` and `/.well-known/nsdeploy.json` (`nsdeploy-link/v1`).
   - GitHub Pages ready with `.nojekyll`.

## Local Verification

Run a static web server:
```bash
python -m http.server 8000
```
Open `http://localhost:8000` in any modern web browser.

## Automated Testing

Run the specification test suite:
```bash
node --test test/studymesh.test.js
```
