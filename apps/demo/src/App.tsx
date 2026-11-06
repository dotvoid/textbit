import { useEffect, useState } from 'react'
import { ArticleEditor, PlainTextField, Together } from './components'

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
        <h2>Together</h2>
        <p>Two editors sharing one document over Yjs, as two people would.</p>
        <Together />
      </section>

      <section>
        <h2>A plain text field</h2>
        <p>Textbit with no plugins: paragraphs and nothing else, and the value is a string.</p>
        <PlainTextField />
      </section>
    </main>
  )
}
