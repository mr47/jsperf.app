import React from 'react'
import DocHead from './DocHead'
import Header from './Header'
import Footer from './Footer'
import Head from 'next/head'
import { useTheme } from 'next-themes'

const Layout = (props) => {
  const {children, navState} = props
  const { resolvedTheme } = useTheme()
  
  return (
    <>
      <DocHead {...props} />
      <Head>
        <link 
          rel="stylesheet" 
          href={`https://cdnjs.cloudflare.com/ajax/libs/highlight.js/11.2.0/styles/${resolvedTheme === 'dark' ? 'github-dark' : 'github'}.min.css`} 
        />
      </Head>
      <div className="font-sans antialiased min-h-full flex flex-col bg-background text-foreground">
        <div className="flex-auto">
          <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 bg-background min-h-screen">
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
