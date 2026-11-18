# Testing textbit

For working on textbit itself. Not part of the website.

## The suites

From the repository root:

```bash
npm test          # every package: Vitest, run once
npm run lint      # ESLint, no warnings allowed
npm run typecheck # TypeScript, every package and app
npm run build     # every package, with its build checks
```

- **Core** (`packages/textbit/tests`) runs in jsdom; tests marked `// @vitest-environment node`
  run without a DOM, as servers do. `headlessImports.test.ts` walks the headless entry's
  imports and fails if a React package or a component file gets in.
- **Plugins** (`packages/plugins/tests`) test against core's source, so nothing has to be built
  first. `schema.test.ts` validates a document using every plugin.
- **Agent** (`packages/agent/tests`) runs in Node only. It covers the line format, every
  operation and error, revisions, runs and undo, presence, suggestions, and agents and people
  in one Y.js document, with peers simulated by separate `Y.Doc`s synced by hand.
- **Styles** (`packages/styles/tests`) check that the CSS parses, styles nothing outside
  textbit, defines every token it uses, and styles every `data-tb` hook core renders.

The builds check more: the plugins' build bundles each plugin alone and fails if it pulls in
another, or if a definition loads React; the agent's build fails if it loads React. Every
package's declarations get their file extensions written in, so TypeScript projects resolving
modules as Node does see the types.

Node is managed with nvm; in a shell that does not load it, prefix commands with
`export PATH="$HOME/.nvm/versions/node/<version>/bin:$PATH"`.

## The agent lab, end to end

`apps/agent-lab` puts a real agent in a shared document, through MCP, with the demo as the
people's side. Its README has the details; in short:

1. `npm run lab` builds the packages and starts the document server on
   `ws://localhost:1234`.
2. `npm run dev` starts the demo. Under "With an agent", press **Join the lab document**.
3. Connect an MCP client to `apps/agent-lab/src/mcp.ts`. For Claude Code:

   ```bash
   claude mcp add textbit-lab -- "$(which node)" /absolute/path/to/textbit/apps/agent-lab/src/mcp.ts
   ```

   The full path to node matters: MCP clients do not load the shell's profile, so nvm's node
   is not on their path. Start a new session and check `/mcp`.
4. Ask the agent for changes, and type in the demo while it works.

**What to check:**

- the agent's changes show in the text, with its name, and fade after a few seconds;
- typing elsewhere while it edits is never blocked, and edits to the same element come back
  to the agent as `stale`, after which it should read again and retry;
- the errors it gets are ones it can act on, and it does;
- **Undo the agent's last run** takes back the run and keeps what you typed;
- with **The agent suggests** ticked: suggestions in the text and in the list, accepting,
  rejecting, Ctrl+Z after accepting, and a block changed after it was suggested showing as
  changed since;
- two browser tabs as two people: decisions on suggestions reach both.

**Starting over:** stop the server, `npm run lab:reset`, `npm run lab`, join again in the demo,
and reconnect the MCP server with `/mcp`. Each start-over is a document of its own, and clients
holding an older one are turned away, so old copies are not merged back in.

The MCP server logs each tool call to stderr; `/mcp` in Claude Code shows it.

## Testing without a model

For a repeatable end-to-end check, drive the MCP server from a script instead of a model, and
look at the result in a browser driven from a script too. Nothing of this is committed; write
the scripts in a scratch folder when needed.

- **The agent side:** a Node script with the MCP SDK's `Client` and `StdioClientTransport`
  starts `apps/agent-lab/src/mcp.ts`, lists the tools, and calls `document_search`,
  `document_read` and `document_edit` with known operations, printing each result's text.
- **A watching peer:** in the same script, a `HocuspocusProvider` with its own `Y.Doc`, joined
  to the current document (its name from `http://localhost:1234/lab`, token `lab`), records
  the content and the agent's awareness state (`textbitAgent`) as they change. This shows
  whether edits and presence reach other peers, without a browser.
- **The browser side:** headless Chrome, started with `--remote-debugging-port`, driven over the
  DevTools protocol: navigate to the demo, click **Join the lab document**, then after the
  agent's edit evaluate in the page what it shows (`.tb-agent-change`, `[data-tb="agent-tag"]`,
  `[data-tb="suggestion-bar"]`) and take a screenshot with `Page.captureScreenshot`. Clicks are
  `Input.dispatchMouseEvent` at an element's centre; scroll the element into view and measure it
  after the scroll, not before.

Two things that misled us while testing this way:

- A browser tab left open from an earlier run keeps reconnecting and pushes its old copy of
  the document into a fresh server. Close stray tabs, or start over as above.
- In React's development mode effects run twice: a provider made in a `useState` initialiser
  and destroyed in an effect's cleanup is gone after the first pass, and the editor is left on
  a dead connection. Make providers in the effect itself.
