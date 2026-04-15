import { useState, useEffect, useCallback, useRef } from 'react'
import Router from 'next/router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import UUID from '../UUID'
import { Trash2, Loader2, RotateCcw } from 'lucide-react'
import Editor from '../Editor'

const STORAGE_KEY = 'jsperf-draft'

function loadDraft() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveDraft(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data))
  } catch {}
}

function clearDraft() {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {}
}

const TestCaseFieldset = ({index, remove, test, update}) => {
  return (
    <Card className="mb-6 overflow-hidden border-border/60 shadow-sm bg-card/40 backdrop-blur-sm group">
      
      <CardContent className="p-0 flex flex-col">
        {/* Top Row: IDE-style Tab Title Bar */}
        <div className="flex items-center justify-between px-4 py-2 bg-muted/10 border-b border-border/50">
          <div className="flex items-center gap-3 w-full max-w-lg">
            <div className="bg-background border border-border/50 text-muted-foreground font-mono font-bold w-6 h-6 rounded flex items-center justify-center text-xs shadow-sm shrink-0">
              {index + 1}
            </div>
            
            <input
              id={`testTitle-${test.id}`}
              type="text" 
              name="testTitle" 
              placeholder="Test Title (e.g. Using Array.map)"
              className="flex-1 bg-transparent px-2 py-1 text-sm font-semibold outline-none placeholder:text-muted-foreground/50 border-b border-transparent focus:border-primary/50 transition-colors"
              onChange={event => update({"title": event.target.value}, test.id)} 
              required 
              defaultValue={test && test.title} 
            />
          </div>

          {remove && (
            <Button variant="ghost" size="icon" type="button" onClick={() => remove(test.id)} className="h-7 w-7 shrink-0 text-muted-foreground hover:text-red-500 hover:bg-red-500/10 border border-transparent transition-all ml-2" aria-label="Remove test case">
              <Trash2 className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>

        {/* Editor Area */}
        <div className="w-full bg-background relative group/editor">
          <div className="absolute top-2 right-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground/30 group-hover/editor:text-muted-foreground/60 transition-colors pointer-events-none z-10">
            JavaScript
          </div>
          <Editor 
            code={test && test.code} 
            onUpdate={code => update({code}, test.id)} 
            className="javascript w-full p-4 pt-6 font-mono text-sm outline-none focus:bg-primary/[0.02] transition-colors" 
            style={{minHeight: "200px"}} 
          />
        </div>
      </CardContent>
    </Card>
  )
}

export default function EditForm({pageData}) {
  const uuid = UUID()
  const isEditing = !!pageData
  const formRef = useRef(null)

  function getInitialState() {
    if (isEditing) return null
    return loadDraft()
  }

  const draft = useRef(getInitialState()).current

  const [codeBlockInitHTML, setCodeBlockInitHTML] = useState(pageData?.initHTML ?? draft?.initHTML ?? '')
  const [codeBlockSetup, setCodeBlockSetup] = useState(pageData?.setup ?? draft?.setup ?? '')
  const [codeBlockTeardown, setCodeBlockTeardown] = useState(pageData?.teardown ?? draft?.teardown ?? '')

  let defaultTestsState = [
    {id: 0, title: '', code: ''},
    {id: 1, title: '', code: ''},
  ]

  if (pageData?.tests) {
    defaultTestsState = pageData.tests.map((test, index) => ({id: index, ...test}))
  } else if (draft?.tests?.length) {
    defaultTestsState = draft.tests
  }

  const [testsState, setTestsState] = useState(defaultTestsState)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  const persistDraft = useCallback(() => {
    if (isEditing) return
    const title = formRef.current?.title?.value ?? ''
    const info = formRef.current?.info?.value ?? ''
    saveDraft({
      title,
      info,
      initHTML: codeBlockInitHTML,
      setup: codeBlockSetup,
      teardown: codeBlockTeardown,
      tests: testsState,
    })
  }, [isEditing, codeBlockInitHTML, codeBlockSetup, codeBlockTeardown, testsState])

  useEffect(() => {
    if (isEditing) return
    const timer = setTimeout(persistDraft, 500)
    return () => clearTimeout(timer)
  }, [persistDraft, isEditing])

  const testsRemove = (id) => {
    const testIndex = testsState.findIndex(test => test.id === id)
    setTestsState(tests => {
      const newTests = [...tests]
      newTests.splice(testIndex, 1)
      return newTests
    })
  }

  const testsAdd = () => {
    const lastId = testsState.length > 0 ? testsState[testsState.length - 1].id : 0
    setTestsState(tests => [...tests, {id: lastId+1, title: '', code: ''}])
  }

  const testsUpdate = (test, id) => {
    const testIndex = testsState.findIndex(test => test.id === id)
    setTestsState(tests => {
      const newTests = [...tests]
      newTests[testIndex] = {...newTests[testIndex], ...test}
      return newTests
    })
  }

  const handleReset = () => {
    setCodeBlockInitHTML('')
    setCodeBlockSetup('')
    setCodeBlockTeardown('')
    setTestsState([
      {id: 0, title: '', code: ''},
      {id: 1, title: '', code: ''},
    ])
    if (formRef.current) {
      formRef.current.title.value = ''
      formRef.current.info.value = ''
    }
    clearDraft()
    setShowResetConfirm(false)
  }

  const formDefaults = Object.assign({}, {
    title: '',
    info: '',
    slug: '',
    visible: false
  }, pageData)

  if (!isEditing && draft) {
    formDefaults.title = draft.title ?? formDefaults.title
    formDefaults.info = draft.info ?? formDefaults.info
  }

  const submitFormHandler = async event => {
    event.preventDefault()
    setIsSaving(true)
    setSaveError(null)

    const formData = {
      title: event.target.title.value,
      info: event.target.info.value
    }

    formData.slug = formDefaults.slug
    formData.initHTML = codeBlockInitHTML
    formData.setup = codeBlockSetup
    formData.teardown = codeBlockTeardown

    formData.tests = testsState.map(test => ({...test}))
      .map(test => { delete test.id; return test })
      .filter(test => !!test.code)

    const isPublished = !!pageData?.visible

    if (pageData?.revision) {
      formData.revision = pageData.revision
    }

    formData.uuid = uuid

    try {
      const response = await fetch('/api/bench', {
        method: (isPublished || !pageData) ? 'POST' : 'PUT',
        body: JSON.stringify(formData),
      })

      if (response.status === 429) {
        setSaveError('Too many requests. Please wait a moment and try again.')
        setIsSaving(false)
        return
      }

      const {success, message, data} = await response.json()

      if (success) {
        clearDraft()
        Router.push(`/${data.slug}/${data.revision}/preview`)
      } else {
        setSaveError(message || 'Failed to save benchmark.')
        setIsSaving(false)
      }
    } catch (error) {
      console.error(error)
      setSaveError('Network error. Please check your connection and try again.')
      setIsSaving(false)
    }
  }

  return (
    <form ref={formRef} onSubmit={submitFormHandler} className="w-full max-w-5xl mx-auto space-y-10 pb-20">
      
      <div>
        <div className="mb-6">
          <h3 className="text-3xl font-extrabold tracking-tight">Benchmark Details</h3>
          <p className="text-muted-foreground mt-2 text-sm">Provide basic information about your performance test so others can understand what you are comparing.</p>
        </div>
        <Card className="border-border/60 shadow-sm bg-card/40 backdrop-blur-sm overflow-hidden">
          <CardContent className="space-y-6 p-6">
          <div className="grid gap-3">
            <Label htmlFor="title" className="text-sm font-semibold">
              Title <span className="text-destructive">*</span>
            </Label>
            <Input type="text" id="title" name="title" defaultValue={formDefaults.title} placeholder="e.g. Array iteration methods comparison" className="text-lg py-6 bg-background/50 transition-colors" required />
          </div>
          <div className="grid gap-3">
            <div className="flex justify-between items-baseline">
              <Label htmlFor="info" className="text-sm font-semibold">Description</Label>
              <span className="text-xs text-muted-foreground bg-muted px-2 py-1 rounded-md font-mono">Markdown supported</span>
            </div>
            <textarea 
              name="info" 
              id="info" 
              rows="4" 
              placeholder="Explain what you are benchmarking and why..."
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background/50 px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary/50 transition-all shadow-inner"
              maxLength="16777215" 
              defaultValue={formDefaults.info} 
            />
          </div>
        </CardContent>
      </Card>
    </div>

      <div className="pt-4">
        <div className="mb-6">
          <h3 className="text-3xl font-extrabold tracking-tight">Preparation & Teardown</h3>
          <p className="text-muted-foreground mt-2 text-sm">Code that runs before/after the tests. Useful for setting up the DOM or declaring shared variables.</p>
        </div>

        <Card className="overflow-hidden border-border/60 shadow-sm bg-card/40 backdrop-blur-sm">
          <CardContent className="p-0">
            <Tabs defaultValue="setup" className="w-full">
              <div className="flex items-center justify-between px-4 py-2 bg-muted/10 border-b border-border/50">
                <TabsList className="bg-muted/50 border border-border/50">
                  <TabsTrigger value="setup" className="text-xs uppercase tracking-wider font-semibold">Setup JS</TabsTrigger>
                  <TabsTrigger value="teardown" className="text-xs uppercase tracking-wider font-semibold">Teardown JS</TabsTrigger>
                  <TabsTrigger value="html" className="text-xs uppercase tracking-wider font-semibold">Prep HTML</TabsTrigger>
                </TabsList>
              </div>

              <TabsContent value="html" className="m-0 border-none outline-none">
                <div className="w-full bg-background relative group/editor">
                  <div className="absolute top-2 right-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground/30 group-hover/editor:text-muted-foreground/60 transition-colors pointer-events-none z-10">HTML</div>
                  <Editor 
                    code={codeBlockInitHTML} 
                    onUpdate={setCodeBlockInitHTML} 
                    className="html w-full p-4 pt-6 font-mono text-sm outline-none focus:bg-primary/[0.02] transition-colors" 
                    style={{minHeight: "200px"}} 
                  />
                </div>
              </TabsContent>

              <TabsContent value="setup" className="m-0 border-none outline-none">
                <div className="w-full bg-background relative group/editor">
                  <div className="absolute top-2 right-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground/30 group-hover/editor:text-muted-foreground/60 transition-colors pointer-events-none z-10">JavaScript</div>
                  <Editor 
                    code={codeBlockSetup} 
                    onUpdate={setCodeBlockSetup} 
                    className="javascript w-full p-4 pt-6 font-mono text-sm outline-none focus:bg-primary/[0.02] transition-colors" 
                    style={{minHeight: "200px"}} 
                  />
                </div>
              </TabsContent>

              <TabsContent value="teardown" className="m-0 border-none outline-none">
                <div className="w-full bg-background relative group/editor">
                  <div className="absolute top-2 right-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground/30 group-hover/editor:text-muted-foreground/60 transition-colors pointer-events-none z-10">JavaScript</div>
                  <Editor 
                    code={codeBlockTeardown} 
                    onUpdate={setCodeBlockTeardown} 
                    className="javascript w-full p-4 pt-6 font-mono text-sm outline-none focus:bg-primary/[0.02] transition-colors" 
                    style={{minHeight: "200px"}} 
                  />
                </div>
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      </div>

      <div className="pt-4">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 mb-6">
          <div>
            <h3 className="text-3xl font-extrabold tracking-tight">Test Snippets</h3>
            <p className="text-muted-foreground mt-2 text-sm">Write the JavaScript code you want to benchmark. Each snippet runs in isolation.</p>
          </div>
          <Button type="button" variant="outline" onClick={testsAdd} className="font-semibold shadow-sm hover:shadow transition-all bg-background border-border hover:bg-muted shrink-0">
            + Add Snippet
          </Button>
        </div>
        <div className="space-y-6">
          {testsState.map((test, index) => {
            const optionalProps = {}
            if (testsState.length > 2) {
              optionalProps.remove = testsRemove
            }
            return <TestCaseFieldset {...optionalProps} key={test.id} index={index} test={test} update={(e, id) => testsUpdate(e, id)} />
          })}
        </div>
      </div>

      {showResetConfirm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
          <Card className="w-full max-w-md mx-4 shadow-2xl border-border">
            <CardContent className="p-6 space-y-4">
              <h4 className="text-lg font-bold">Reset all test cases?</h4>
              <p className="text-sm text-muted-foreground">This will clear all titles, code snippets, setup/teardown, and the saved draft. This action cannot be undone.</p>
              <div className="flex justify-end gap-3 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowResetConfirm(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" onClick={handleReset}>
                  Reset Everything
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}

      <div className="sticky bottom-6 z-10 flex flex-col gap-3 p-4 rounded-2xl border border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl mt-16 ring-1 ring-white/10 dark:ring-white/5">
        {saveError && (
          <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-destructive/10 border border-destructive/20 text-destructive text-sm font-medium">
            <span className="flex-1">{saveError}</span>
            <button type="button" onClick={() => setSaveError(null)} className="shrink-0 hover:opacity-70 text-xs font-bold px-1">✕</button>
          </div>
        )}
        <div className="flex flex-col sm:flex-row items-center gap-4">
        <div className="flex-1 text-sm font-medium text-muted-foreground ml-2 text-center sm:text-left">
          Ready to run? Make sure all your snippets are correct.
        </div>
        <Button type="button" variant="ghost" onClick={() => setShowResetConfirm(true)} className="hidden sm:inline-flex w-full sm:w-auto text-muted-foreground hover:text-destructive">
          <RotateCcw className="w-4 h-4" />
          Reset
        </Button>
        <Button type="button" variant="secondary" onClick={testsAdd} className="hidden sm:inline-flex w-full sm:w-auto shadow-sm">
          Add Another Test
        </Button>
        <Button type="submit" size="lg" disabled={isSaving} className="w-full sm:w-auto font-bold px-8 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
          {isSaving ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Saving…
            </>
          ) : (
            'Save & Run Benchmark'
          )}
        </Button>
        </div>
      </div>
      
    </form>
  )
}
