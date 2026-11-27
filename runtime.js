/**
 * StudyMesh Browser Runtime
 * Open Agentic Web implementation (MVP Profile 0.3)
 * Runs multi-agent coordination, consent-bounded delegation, and fallback execution in vanilla ES modules.
 */

export class StudyMeshRuntime {
  constructor(options = {}) {
    this.manifestUrl = options.manifestUrl || 'agent-manifest.json';
    this.manifest = null;
    this.network = null;
    this.tools = new Map();
    this.importedPeers = new Map();
    this.onTrace = options.onTrace || (() => {});
    this.requestConsent = options.requestConsent || this.defaultConsentHandler.bind(this);
    this.isInitialized = false;
  }

  /**
   * Initializes runtime by loading manifest and network JSON specifications.
   */
  async init() {
    try {
      this.emitTrace('system', 'System', 'Loading agent-manifest.json...', 'RUNNING');
      const manifestRes = await fetch(this.manifestUrl, { mode: 'cors' });
      if (!manifestRes.ok) {
        throw new Error(`Failed to load manifest (${manifestRes.status} ${manifestRes.statusText})`);
      }
      this.manifest = await manifestRes.json();
      this.emitTrace('system', 'System', `Loaded manifest: ${this.manifest.brand || 'Agentic Site'}`, 'COMPLETED');

      // Resolve primary network from manifest (supporting 'hocon', 'network', or 'path')
      const primaryNet = this.manifest.networks && this.manifest.networks[0];
      const networkPath = primaryNet?.hocon || primaryNet?.network || primaryNet?.path || 'studymesh.network.json';

      this.emitTrace('system', 'System', `Loading network graph from ${networkPath}...`, 'RUNNING');
      const netRes = await fetch(networkPath, { mode: 'cors' });
      if (!netRes.ok) {
        throw new Error(`Failed to load network graph (${netRes.status} ${netRes.statusText})`);
      }
      this.network = await netRes.json();

      // Register all tools from the declarative agent graph
      if (Array.isArray(this.network.tools)) {
        for (const tool of this.network.tools) {
          this.tools.set(tool.name, tool);
        }
      }

      this.isInitialized = true;
      this.emitTrace('system', 'System', `Registered ${this.tools.size} local agents: ${Array.from(this.tools.keys()).join(', ')}`, 'COMPLETED');
      return { manifest: this.manifest, network: this.network };
    } catch (err) {
      this.emitTrace('system', 'System', `Initialization failed: ${err.message}`, 'FAILED');
      throw err;
    }
  }

  /**
   * Dispatches trace events to UI listener.
   */
  emitTrace(id, agent, message, status, details = null) {
    this.onTrace({
      id: id || 'trace-' + Math.random().toString(36).substring(2, 9),
      agent,
      message,
      status, // 'RUNNING', 'WAITING_CONSENT', 'APPROVED', 'DECLINED', 'COMPLETED', 'OFFLINE_FALLBACK', 'FAILED'
      timestamp: new Date().toLocaleTimeString(),
      details
    });
  }

  /**
   * Default fallback consent handler if no UI handler attached.
   */
  async defaultConsentHandler({ agent, action, contextNote }) {
    if (typeof window !== 'undefined' && window.confirm) {
      return window.confirm(`Authorize Delegation to Specialist Agent?\nAgent: ${agent}\nAction: ${action}\nContext: ${contextNote}`);
    }
    return true;
  }

  /**
   * Retrieves active LLM credentials stored strictly in browser sessionStorage.
   * Never exposed to external network payloads or manifests.
   */
  getLLMConfig() {
    let apiKey = '';
    let endpoint = 'https://api.otari.ai/api/v1';
    let model = 'meta-llama/Llama-3.3-70B-Instruct';

    if (typeof window !== 'undefined' && window.sessionStorage) {
      apiKey = window.sessionStorage.getItem('studymesh_api_key') || '';
      endpoint = window.sessionStorage.getItem('studymesh_llm_endpoint') || endpoint;
      model = window.sessionStorage.getItem('studymesh_llm_model') || model;
    }

    if (this.manifest?.llm_router) {
      if (typeof this.manifest.llm_router === 'string') {
        endpoint = this.manifest.llm_router;
      } else if (this.manifest.llm_router.endpoint) {
        endpoint = this.manifest.llm_router.endpoint;
        if (this.manifest.llm_router.default_model && !window?.sessionStorage?.getItem('studymesh_llm_model')) {
          model = this.manifest.llm_router.default_model;
        }
      }
    }

    return { apiKey: apiKey.trim(), endpoint: endpoint.trim(), model: model.trim() };
  }

  /**
   * Imports a remote peer network using strict CORS and consent checking.
   */
  async importPeerNetwork(peerManifestUrl) {
    const traceId = 'peer-import-' + Date.now();
    try {
      this.emitTrace(traceId, 'Peer Discovery', `Peer import requested: ${peerManifestUrl}`, 'WAITING_CONSENT');

      // Request user consent before cross-origin peer binding
      const approved = await this.requestConsent({
        agent: 'Peer Discovery Linker',
        action: `Fetch and link external peer agent manifest from: ${peerManifestUrl}`,
        contextNote: 'Private context shared: NONE'
      });

      if (!approved) {
        this.emitTrace(traceId, 'Peer Discovery', `User declined peer network link from ${peerManifestUrl}`, 'DECLINED');
        return { success: false, reason: 'Declined by user' };
      }

      this.emitTrace(traceId, 'Peer Discovery', `Fetching peer manifest from ${peerManifestUrl} via CORS...`, 'RUNNING');
      
      const response = await fetch(peerManifestUrl, { mode: 'cors' });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status} ${response.statusText}`);
      }

      const peerManifest = await response.json();
      const peerBrand = peerManifest.brand || 'Remote Peer';
      const peerNet = peerManifest.networks && peerManifest.networks[0];
      
      if (!peerNet) {
        throw new Error('Peer manifest does not declare any active networks.');
      }

      // Resolve relative path against peer manifest URL
      const networkUrl = new URL(peerNet.hocon || peerNet.network || peerNet.path, peerManifestUrl).toString();
      const netRes = await fetch(networkUrl, { mode: 'cors' });
      if (!netRes.ok) {
        throw new Error(`Failed to load peer network graph: ${netRes.status} ${netRes.statusText}`);
      }

      const peerNetworkData = await netRes.json();
      const addedAgents = [];

      if (Array.isArray(peerNetworkData.tools)) {
        for (const tool of peerNetworkData.tools) {
          const namespacedName = `peer:${peerBrand.toLowerCase().replace(/\s+/g, '_')}:${tool.name}`;
          const proxyTool = {
            ...tool,
            name: namespacedName,
            isPeer: true,
            peerOrigin: peerManifestUrl
          };
          this.tools.set(namespacedName, proxyTool);
          addedAgents.push(namespacedName);
        }
      }

      this.importedPeers.set(peerManifestUrl, {
        brand: peerBrand,
        agents: addedAgents
      });

      this.emitTrace(traceId, 'Peer Discovery', `Successfully imported ${addedAgents.length} agents from ${peerBrand}: ${addedAgents.join(', ')}`, 'COMPLETED');
      return { success: true, brand: peerBrand, agents: addedAgents };
    } catch (err) {
      const errMsg = `Fail-closed remote fetch error: ${err.message || 'CORS restriction or network unreachable'}`;
      this.emitTrace(traceId, 'Peer Discovery', errMsg, 'FAILED');
      return { success: false, error: errMsg };
    }
  }

  /**
   * Main entry point to process student query via coordinator and specialists.
   */
  async processRequest(userQuery) {
    if (!this.isInitialized) {
      await this.init();
    }

    const query = (userQuery || '').trim();
    if (!query) {
      throw new Error('Please enter a query or study request.');
    }

    this.emitTrace('coord-start', 'study_coordinator', `Received inquiry: "${query.substring(0, 70)}${query.length > 70 ? '...' : ''}"`, 'RUNNING');

    // Step 1: Coordinator analyzes intent to select specialist agents
    const plan = this.decomposeQuery(query);
    this.emitTrace('coord-plan', 'study_coordinator', `Selected specialist agents: [${plan.selectedAgents.join(', ')}]`, 'COMPLETED');

    const specialistResults = {};

    // Step 2: Sequentially invoke specialists with trust gate consent
    for (const agentName of plan.selectedAgents) {
      const toolDef = this.tools.get(agentName);
      if (!toolDef) {
        this.emitTrace(`spec-${agentName}`, agentName, `Agent not found in registry. Skipping.`, 'FAILED');
        continue;
      }

      const agentDesc = toolDef.function?.description || toolDef.name;
      const delegationAction = `Execute specialist task for query: "${query.substring(0, 60)}..."`;

      // Trust rule: Show consent dialog before each delegation
      this.emitTrace(`consent-${agentName}`, agentName, `Requesting user authorization for delegation...`, 'WAITING_CONSENT');

      const consentGranted = await this.requestConsent({
        agent: agentName,
        action: delegationAction,
        contextNote: 'Private context shared: NONE'
      });

      if (!consentGranted) {
        this.emitTrace(`consent-${agentName}`, agentName, `Delegation declined by user. Step cancelled cleanly.`, 'DECLINED');
        specialistResults[agentName] = {
          agent: agentName,
          status: 'DECLINED',
          output: null,
          note: 'Step cancelled by user request.'
        };
        continue;
      }

      this.emitTrace(`run-${agentName}`, agentName, `Delegation authorized. Executing specialist...`, 'RUNNING');

      // Attempt LLM inference if key exists, otherwise gracefully run offline specialist
      const result = await this.executeSpecialist(toolDef, query);
      specialistResults[agentName] = result;

      if (result.status === 'OFFLINE_FALLBACK') {
        this.emitTrace(`run-${agentName}`, agentName, `Executed via local offline engine (${result.reason}).`, 'OFFLINE_FALLBACK');
      } else if (result.status === 'COMPLETED') {
        this.emitTrace(`run-${agentName}`, agentName, `Successfully generated specialist response.`, 'COMPLETED');
      } else {
        this.emitTrace(`run-${agentName}`, agentName, `Specialist encountered issue: ${result.error || 'Unknown'}`, 'FAILED');
      }
    }

    // Step 3: Coordinator synthesizes specialist contributions into final output
    this.emitTrace('coord-synth', 'study_coordinator', `Synthesizing final response from completed specialist outputs...`, 'RUNNING');
    const finalAnswer = await this.synthesizeResponse(query, specialistResults);
    this.emitTrace('coord-end', 'study_coordinator', `Completed unified answer generation.`, 'COMPLETED');

    return {
      query,
      answer: finalAnswer,
      specialistResults
    };
  }

  /**
   * Router heuristic for determining which specialists to invoke.
   */
  decomposeQuery(query) {
    const q = query.toLowerCase();
    const selected = [];

    // Heuristics for deadline_planner
    const plannerKeywords = ['plan', 'schedule', 'deadline', 'due', 'exam', 'hours', 'finals', 'week', 'calendar', 'time', 'assignment', 'milestone', 'study plan'];
    if (plannerKeywords.some(kw => q.includes(kw))) {
      selected.push('deadline_planner');
    }

    // Heuristics for dsa_coach
    const dsaKeywords = ['leetcode', 'dsa', 'algorithm', 'data structure', 'array', 'string', 'pointer', 'sliding window', 'binary search', 'two sum', 'tree', 'graph', 'linked list', 'complexity', 'big-o', 'hint ladder', 'stack', 'queue'];
    if (dsaKeywords.some(kw => q.includes(kw))) {
      selected.push('dsa_coach');
    }

    // Heuristics for concept_explainer
    const conceptKeywords = ['explain', 'analogy', 'what is', 'how does', 'concept', 'virtual memory', 'paging', 'deadlock', 'concurrency', 'recursion', 'b-tree', 'cap theorem', 'tcp', 'udp', 'polymorphism', 'difference between', 'intuition'];
    if (conceptKeywords.some(kw => q.includes(kw))) {
      selected.push('concept_explainer');
    }

    // If query is broad or unmatched, activate coordinator recommendation
    if (selected.length === 0) {
      selected.push('concept_explainer');
      selected.push('deadline_planner');
    }

    return { selectedAgents: selected };
  }

  /**
   * Executes a specialist agent through LLM router or deterministic local offline engine.
   */
  async executeSpecialist(toolDef, userQuery) {
    const { apiKey, endpoint, model } = this.getLLMConfig();
    const agentName = toolDef.name;

    // Check if BYOK API key is configured
    if (apiKey) {
      try {
        const prompt = `System Instructions:\n${toolDef.instructions}\n\nStudent Query:\n${userQuery}\n\nPlease generate your response strictly following your role instructions.`;
        
        const response = await fetch(`${endpoint.replace(/\/+$/, '')}/chat/completions`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify({
            model: model,
            messages: [
              { role: 'system', content: toolDef.instructions },
              { role: 'user', content: userQuery }
            ],
            temperature: 0.3
          })
        });

        if (!response.ok) {
          const errText = await response.text().catch(() => '');
          throw new Error(`LLM API returned ${response.status}: ${errText.substring(0, 100)}`);
        }

        const data = await response.json();
        const text = data.choices?.[0]?.message?.content;
        if (!text) {
          throw new Error('LLM returned an empty response.');
        }

        return {
          agent: agentName,
          status: 'COMPLETED',
          mode: 'online_llm',
          output: text
        };
      } catch (err) {
        // Fail closed for LLM call, seamlessly fall back to local offline engine
        const fallbackResult = this.runOfflineSpecialist(agentName, userQuery);
        return {
          agent: agentName,
          status: 'OFFLINE_FALLBACK',
          mode: 'offline_engine',
          reason: `Remote LLM error (${err.message})`,
          output: fallbackResult
        };
      }
    }

    // No API key configured: execute offline engine immediately
    const offlineText = this.runOfflineSpecialist(agentName, userQuery);
    return {
      agent: agentName,
      status: 'OFFLINE_FALLBACK',
      mode: 'offline_engine',
      reason: 'No API Key set in sessionStorage',
      output: offlineText
    };
  }

  /**
   * Deterministic offline engine producing high-quality pedagogical outputs without network dependencies.
   */
  runOfflineSpecialist(agentName, userQuery) {
    const q = userQuery.toLowerCase();

    if (agentName === 'deadline_planner') {
      const hoursMatch = q.match(/(\d+)\s*(?:[a-z\s]{0,12})?(?:hrs?|hours?)/i);
      const totalHours = hoursMatch ? parseInt(hoursMatch[1], 10) : 12;
      const dailyBlock = Math.max(1.5, (totalHours / 4).toFixed(1));

      return `### 📅 Deadline Planner: Study Breakdown
**Target Budget:** ${totalHours} Total Study Hours

| Day | Target Focus & Milestones | Time Allocation | Technique |
| :--- | :--- | :--- | :--- |
| **Day 1** | Foundation & Core Concepts Deconstruction | ${dailyBlock} hrs | 25m Pomodoro Blocks |
| **Day 2** | Problem Solving & Active Recall Exercises | ${dailyBlock} hrs | Spaced Practice |
| **Day 3** | Difficult Problem Drills & Mock Exam Questions | ${dailyBlock} hrs | Timed Interval |
| **Day 4** | Buffer Review & Formula / Invariant Summary | ${(totalHours - dailyBlock * 3).toFixed(1)} hrs | Final Polish |

> 💡 **Buffer Strategy:** Keep 20% of your remaining study window reserved for unexpected blockers. Avoid late-night cramming prior to deadline.`;
    }

    if (agentName === 'dsa_coach') {
      let problem = 'Two Sum / Array Problem';
      let pattern = 'Hash Map / Two Pointers';
      let approach = 'Map complementary value (target - current) while scanning the array in a single pass.';
      let complexity = 'Time: O(N) | Space: O(N) single-pass hash lookup';

      if (q.includes('two sum')) {
        problem = 'Two Sum (LeetCode 1)';
        pattern = 'Complement Hash Map (Single Pass)';
        approach = 'Store each visited number alongside its index in a hash map. For each element `x`, check if `target - x` exists in the map before inserting `x`.';
        complexity = 'Time: O(N) | Space: O(N)';
      } else if (q.includes('window') || q.includes('substring')) {
        problem = 'Sliding Window Pattern';
        pattern = 'Dynamic-size Sliding Window';
        approach = 'Expand right pointer to satisfy window invariant; contract left pointer as soon as constraint is violated.';
        complexity = 'Time: O(N) amortized | Space: O(min(M, N))';
      } else if (q.includes('binary search') || q.includes('sorted')) {
        problem = 'Binary Search Pattern';
        pattern = 'Monotonic Halving Search Space';
        approach = 'Identify sorted monotonic property. Calculate `mid = left + (right - left) // 2` to eliminate half the search space at each iteration.';
        complexity = 'Time: O(log N) | Space: O(1)';
      } else if (q.includes('linked list') || q.includes('cycle')) {
        problem = 'Fast & Slow Pointer (Floyd’s Cycle Finding)';
        pattern = 'Two Pointers with Differential Speed';
        approach = 'Advance slow pointer by 1 step and fast pointer by 2 steps. If pointers coincide, a cycle exists.';
        complexity = 'Time: O(N) | Space: O(1)';
      }

      const requestedCode = q.includes('show code') || q.includes('full code') || q.includes('solution code');
      let response = `### 🧩 DSA Coach: Hint Ladder for ${problem}

* **Hint 1: Pattern Recognition**
  Identify the core structure: **${pattern}**. Avoid brute-force nested loops when memory trade-offs permit O(1) state lookups.

* **Hint 2: Approach & Invariant**
  ${approach}

* **Hint 3: Complexity Target**
  ${complexity}`;

      if (requestedCode) {
        response += `\n\n* **Requested Solution Code:**
\`\`\`javascript
// Minimal reference implementation
function solve(nums, target) {
  const seen = new Map();
  for (let i = 0; i < nums.length; i++) {
    const complement = target - nums[i];
    if (seen.has(complement)) {
      return [seen.get(complement), i];
    }
    seen.set(nums[i], i);
  }
  return [];
}
\`\`\``;
      } else {
        response += `\n\n*(Full code withheld by default to encourage active recall. Ask "show code" if you are completely stuck.)*`;
      }

      return response;
    }

    if (agentName === 'concept_explainer') {
      let concept = 'Virtual Memory & Paging';
      let def = 'Virtual memory creates an idealized, contiguous abstraction of storage, decoupling a process’s address space from physical RAM.';
      let analogy = 'Think of physical RAM as your small desk surface and secondary storage as a giant bookshelf in the next room. Virtual memory is your study assistant who swaps notebooks on and off your desk seamlessly as you need them.';
      let example = `// Address Translation Conceptual Walkthrough:
const PAGE_SIZE = 4096; // 4 KB Page
const virtualAddress = 8200;
const pageNumber = Math.floor(virtualAddress / PAGE_SIZE); // Page 2
const offset = virtualAddress % PAGE_SIZE;                 // Offset 8 bytes into Page`;

      if (q.includes('recursion')) {
        concept = 'Recursion & Call Stack';
        def = 'Recursion is an algorithm design technique where a function solves a smaller sub-problem by calling itself until it reaches a terminating base case.';
        analogy = 'Think of Russian nesting dolls (Matryoshka). You open each doll until you reach the smallest solid doll (the base case), then close them back up one by one.';
        example = `function factorial(n) {
  if (n <= 1) return 1;       // Base case
  return n * factorial(n - 1); // Recursive step
}`;
      } else if (q.includes('deadlock')) {
        concept = 'Deadlock in Concurrent Systems';
        def = 'A deadlock occurs when a set of concurrent processes are permanently blocked because each process holds a resource that another process needs.';
        analogy = 'Four cars arriving simultaneously at a four-way stop intersection, each waiting for the car to their right to proceed first; nobody can move.';
        example = `// Classic Coffman Circular Wait:
// Thread A locks Mutex 1, requests Mutex 2
// Thread B locks Mutex 2, requests Mutex 1`;
      } else if (q.includes('cap theorem')) {
        concept = 'CAP Theorem (Distributed Systems)';
        def = 'The CAP theorem states that a distributed data store can simultaneously guarantee at most two out of three properties: Consistency, Availability, and Partition Tolerance.';
        analogy = 'A group project chat during a network blackout: you can either pause messaging until internet returns (Consistency) or continue talking with whoever is reachable (Availability), but you cannot guarantee both while partitions exist.';
        example = `// Under Network Partition (P):
// Choice 1: CP (Consistency + Partition Tolerance) -> Reject writes to avoid split-brain
// Choice 2: AP (Availability + Partition Tolerance) -> Accept writes, resolve conflicts later`;
      }

      return `### 💡 Concept Explainer: ${concept}

1. **Definition:**
   ${def}

2. **The Analogy:**
   > ${analogy}

3. **Concrete Example:**
\`\`\`javascript
${example}
\`\`\``;
    }

    return `### 🤖 Specialist: ${agentName}
Analysis completed for student inquiry.`;
  }

  /**
   * Synthesizes specialist outputs into a unified student report.
   */
  async synthesizeResponse(userQuery, specialistResults) {
    const completed = [];
    const declined = [];

    for (const [name, res] of Object.entries(specialistResults)) {
      if (res.status === 'DECLINED') {
        declined.push(name);
      } else if (res.output) {
        completed.push({ name, output: res.output, mode: res.mode });
      }
    }

    let summary = `## 🎓 StudyMesh Learning Brief\n\n`;

    if (completed.length === 0 && declined.length > 0) {
      summary += `*All delegated specialist actions were declined by the user. No specialist analysis was executed.*\n\n`;
      summary += `To see an agent's advice, allow delegation when prompted by the consent dialog.`;
      return summary;
    }

    if (completed.length > 0) {
      for (const item of completed) {
        summary += `${item.output}\n\n---\n\n`;
      }
    }

    if (declined.length > 0) {
      summary += `> ⚠️ **Notice:** Delegation to \`${declined.join(', ')}\` was declined by user consent. Those specialist insights were omitted from this brief.\n\n`;
    }

    summary += `**Executive Coordinator Action Item:** Review your immediate milestone, apply the algorithmic invariant, and test understanding using active recall.`;
    return summary;
  }
}

// Global window registration for inter-site agent calling
if (typeof window !== 'undefined') {
  window.StudyMeshRuntime = StudyMeshRuntime;
}
