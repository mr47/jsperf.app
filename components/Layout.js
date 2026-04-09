import React, { useEffect } from 'react'
import DocHead from './DocHead'
import Header from './Header'
import Footer from './Footer'
import { useTheme } from 'next-themes'

const Layout = (props) => {
  const {children, navState} = props
  const { resolvedTheme } = useTheme()
  
  useEffect(() => {
    // Dynamically inject highlight.js theme to avoid Next.js head warnings
    if (!resolvedTheme) return
    
    const themeUrl = `https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.2.0/styles/${resolvedTheme === 'dark' ? 'github-dark' : 'github'}.min.css`
    
    let link = document.getElementById('hljs-theme')
    if (!link) {
      link = document.createElement('link')
      link.id = 'hljs-theme'
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    
    if (link.href !== themeUrl) {
      link.href = themeUrl
    }
  }, [resolvedTheme])
  
  return (
    <>
      <DocHead {...props} />
      <div className="font-sans antialiased min-h-full flex flex-col text-foreground">
        <div className="flex-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 min-h-screen relative z-0">
            <Header navState={navState} />
            { children }
            <Footer />
          </div>
        </div>
      </div>
    </>
  )
}

export default Layout
