import { useEffect, useState } from 'react'

export function ThemeToggle() {
  const [theme, setTheme] = useState<'dark' | 'light'>(() => {
    return (localStorage.getItem('or_theme') as 'dark' | 'light') || 'dark'
  })

  useEffect(() => {
    const root = document.documentElement
    if (theme === 'light') {
      root.setAttribute('data-theme', 'light')
    } else {
      root.removeAttribute('data-theme')
    }
    localStorage.setItem('or_theme', theme)
  }, [theme])

  return (
    <button
      className="theme-btn"
      onClick={() => setTheme(t => t === 'dark' ? 'light' : 'dark')}
      title="Toggle theme"
      aria-label="Toggle light/dark mode"
    >
      {theme === 'dark' ? '☀' : '☾'}
    </button>
  )
}
