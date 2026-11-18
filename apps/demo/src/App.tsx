import { useEffect, useState } from 'react'
import { AgentLab, ArticleEditor, FewerPluginsEditor, PlainTextField, Together } from './components'

export const App = () => {
  const [dark, setDark] = useState(false)
  const [readOnly, setReadOnly] = useState(false)

  // On the page, not on <main>: the special characters pane opens in <body>
  useEffect(() => {
    document.documentElement.style.colorScheme = dark ? 'dark' : 'light'
  }, [dark])

  return (
    <main className='demo'>
      <header>
        <h1>Textbit</h1>
        <div className='demo-switches'>
          <label><input type='checkbox' checked={readOnly} onChange={(e) => setReadOnly(e.target.checked)} /> Read only</label>
          <label><input type='checkbox' checked={dark} onChange={(e) => setDark(e.target.checked)} /> Dark</label>
        </div>
      </header>

      <ArticleEditor readOnly={readOnly} />

      <section>
        <h2>Fewer plugins</h2>
        <p>An editor with only text, formatting, lists and links, to copy and paste to and from the article.</p>
        <FewerPluginsEditor />
      </section>

      <section>
        <h2>Together</h2>
        <p>Two editors sharing one document over Yjs, as two people would.</p>
        <Together />
      </section>

      <section>
        <h2>With an agent</h2>
        <p>A document an AI agent edits with you, through MCP. Start <code>npm run lab</code>, connect an MCP client to the agent, see apps/agent-lab, and ask it to change the article. What it changes shows in the text for a moment, and you can keep writing.</p>
        <AgentLab />
      </section>

      <section>
        <h2>A plain text field</h2>
        <p>Textbit with no plugins: paragraphs and nothing else, and the value is a string.</p>
        <PlainTextField />
      </section>
    </main>
  )
}
