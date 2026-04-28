import { useEffect, useRef } from 'react'

import hljs from '../utils/hljs'

import {CodeJar} from 'codejar'

export const Editor = (props) => {
  const {code, onUpdate, style, className} = props

  const editorRef = useRef<HTMLElement | null>(null)
  const jarRef = useRef<ReturnType<typeof CodeJar> | null>(null)
  const latestCodeRef = useRef(code || '')
  const suppressUpdateRef = useRef(false)

  useEffect(() => {
    if (!editorRef.current) return undefined
    jarRef.current = CodeJar(editorRef.current, hljs.highlightElement)

    suppressUpdateRef.current = true
    jarRef.current.updateCode(latestCodeRef.current)
    suppressUpdateRef.current = false

    jarRef.current.onUpdate(txt => {
      if (suppressUpdateRef.current) return
      latestCodeRef.current = txt
      // Need to debounce this
      onUpdate(txt)
    });

    return () => {
      jarRef.current?.destroy?.()
      jarRef.current = null
    }
  }, []);

  useEffect(() => {
    const nextCode = code || ''
    if (!jarRef.current || nextCode === latestCodeRef.current) return

    latestCodeRef.current = nextCode
    suppressUpdateRef.current = true
    jarRef.current.updateCode(nextCode)
    suppressUpdateRef.current = false
  }, [code]);

  return <code ref={editorRef} className={`block ${className}`} style={style}></code>
}

export default Editor
