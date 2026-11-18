# Agent lab

A real AI agent in a shared textbit document, editing alongside you. Private to this
repository; not published.

- `src/server.ts` is the shared document: a Hocuspocus server on `ws://localhost:1234`, with
  the document `lab`. It starts as the demo's article and keeps its state while it runs.
- `src/mcp.ts` is an MCP server over stdio. Your MCP client starts it. It joins the document
  as a peer of its own, like a browser, and gives the agent the tools of
  `@dotvoid/textbit-agent`: `document_read`, `document_search`, `document_types` and
  `document_edit`. Its presence shows on the blocks it works on.
- The demo's "With an agent" section joins the same document, so you watch the agent work
  and can type while it does.

Both run the built packages, as a host would.

## Running it

1. From the repository root, build the packages and start the document server:

   ```bash
   npm run lab
   ```

2. In another terminal, start the demo with `npm run dev`, open it and press **Join the lab
   document** under "With an agent".

3. Connect an MCP client to `src/mcp.ts`. For Claude Code, from any directory:

   ```bash
   claude mcp add textbit-lab -- "$(which node)" /absolute/path/to/textbit/apps/agent-lab/src/mcp.ts
   ```

   Give node's full path, as `$(which node)` does in a shell where it is found: MCP clients
   start servers without your shell's profile, so with nvm a bare `node` is not on their PATH
   and the server never starts. `npm run lab` must be running first, or the server stops
   after 8 seconds saying so.

   Start a new Claude Code session and check `/mcp` lists `textbit-lab`. Any MCP client that
   starts stdio servers works the same way, e.g. Claude Desktop with this in its config:

   ```json
   { "mcpServers": { "textbit-lab": { "command": "/full/path/to/node", "args": ["/absolute/path/to/textbit/apps/agent-lab/src/mcp.ts"] } } }
   ```

   `node` must be version 24 or later, which runs the TypeScript sources as they are.

4. Ask the agent to change the document, and watch it in the browser. For example:
   - "Read the lab document and tighten the lead-in."
   - "Add a short section about the lighthouse after the list, with a heading."
   - "Make the table's second column say what each boat catches in winter."
   - "Fix the spelling mistakes." Type in a paragraph at the same time.

## Starting over

`npm run lab:reset` (with the server stopped) throws the document away; the next `npm run lab`
starts again from the article. Each start-over is a document of its own, with a name the
server hands out: a browser tab or MCP server still holding the old one is turned away
rather than merging its copy back in, which would give every element twice. The demo then
asks you to join again; reconnect the MCP server with `/mcp` in Claude Code.

## Edit or suggest

**The agent suggests**, above the lab document, switches the agent between editing and
suggesting; the MCP server follows the switch, and tells its client the edit tool changed.
Suggestions show in the text and in the list under the editor, for you to accept or reject.
`LAB_REVIEW=suggest` makes suggesting the default.

## What to watch

- The marker on the blocks the agent changes, with its name, while it writes.
- Edits arriving while you type elsewhere, and a `stale` refusal when you change the block
  it is about to change: it should read again and retry.
- Error messages the agent gets, in its tool results, and whether it recovers from them.
- **Undo the agent's last run** reverts everything it did in the run, keeping what you typed.
  A run ends after 20 seconds without a tool call.

## Settings

Environment variables for `src/mcp.ts`, e.g. in the `env` of the client's configuration:

| Variable | Default | |
|----------|---------|---|
| `LAB_URL` | `ws://localhost:1234` | The document server |
| `LAB_AGENT_NAME` | `Agent` | The name on its markers |
| `LAB_AGENT_COLOR` | `#7c3aed` | Their colour |
| `LAB_RUN_IDLE_MS` | `20000` | A pause that ends a run |
| `LAB_REVIEW` | `apply` | `suggest` to start out suggesting |

`LAB_PORT` sets the document server's port. `npm run check -w textbit-agent-lab` type-checks
the lab against the built packages.

The MCP server writes its log to stderr: what it joined, each tool call and whether it worked.

## The demo movie

```bash
npm run film
```

Makes `film/out/textbit-agents.mp4`, about a minute at 1080p: Alice and Bob in the lab
document side by side, the writing assistant's tool calls beside them, and captions. The
assistant edits while Bob keeps typing, its changes show and fade, Alice undoes its run, then
it suggests and they accept, reject and undo.

`film/film.ts` plays the storyboard in headless Chrome against a fresh lab document, the
demo's film stage (`/?film`) and the real MCP server, so every take is the same. Pointers and
typing are simulated, the agent's calls are real. The screen is recorded at three times the
resolution and encoded with `ffmpeg`, which must be installed. Edit the storyboard in
`film.ts` and run it again; `FILM_DEBUG=1` logs what the page shows after the agent's edit, and
a failed take leaves `film/out/failure.png`. `CHROME` points at another Chrome.
