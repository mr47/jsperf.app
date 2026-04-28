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
import { TYPESCRIPT_SEED_BENCHMARKS, getTypeScriptSeedBenchmark } from '../../lib/benchmark/typescriptSeeds'

const STORAGE_KEY = 'jsperf-draft'
const DEFAULT_TS_OPTIONS = {
  runtimeMode: 'native-where-available',
  target: 'es2020',
  jsx: false,
  typeCheck: false,
  imports: false,
}

function normalizeLanguage(value) {
  return value === 'typescript' ? 'typescript' : 'javascript'
}

function normalizeTypeScriptOptions(value) {
  const input = value && typeof value === 'object' ? value : {}
  return {
    ...DEFAULT_TS_OPTIONS,
    runtimeMode: input.runtimeMode === 'compiled-everywhere'
      ? 'compiled-everywhere'
      : DEFAULT_TS_OPTIONS.runtimeMode,
    target: ['es2020', 'es2022', 'esnext'].includes(input.target)
      ? input.target
      : DEFAULT_TS_OPTIONS.target,
  }
}

function languageLabel(language) {
  return language === 'typescript' ? 'TypeScript' : 'JavaScript'
}

function editorClassFor(language) {
  return language === 'typescript' ? 'typescript' : 'javascript'
}

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

const TestCaseFieldset = ({index, remove = null, test, update, language}) => {
  const label = languageLabel(language)
  const editorClass = editorClassFor(language)
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
            {label}
          </div>
          <Editor 
            code={test && test.code} 
            onUpdate={code => update({code}, test.id)} 
            className={`${editorClass} w-full p-4 pt-6 font-mono text-sm outline-none focus:bg-primary/[0.02] transition-colors`} 
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

  const [codeBlockInitHTML, setCodeBlockInitHTML] = useState(pageData?.initHTML ?? '')
  const [codeBlockSetup, setCodeBlockSetup] = useState(pageData?.setup ?? '')
  const [codeBlockTeardown, setCodeBlockTeardown] = useState(pageData?.teardown ?? '')
  const [languageState, setLanguageState] = useState(normalizeLanguage(pageData?.language))
  const [tsOptionsState, setTsOptionsState] = useState(normalizeTypeScriptOptions(pageData?.languageOptions))

  let defaultTestsState = [
    {id: 0, title: '', code: ''},
    {id: 1, title: '', code: ''},
  ]

  if (pageData?.tests) {
    defaultTestsState = pageData.tests.map((test, index) => ({id: index, ...test}))
  }

  const [testsState, setTestsState] = useState(defaultTestsState)
  const [isSaving, setIsSaving] = useState(false)
  const [saveError, setSaveError] = useState(null)
  const [showResetConfirm, setShowResetConfirm] = useState(false)

  useEffect(() => {
    if (isEditing) return
    const draft = loadDraft()
    if (!draft) return

    setCodeBlockInitHTML(draft.initHTML ?? '')
    setCodeBlockSetup(draft.setup ?? '')
    setCodeBlockTeardown(draft.teardown ?? '')
    setLanguageState(normalizeLanguage(draft.language))
    setTsOptionsState(normalizeTypeScriptOptions(draft.languageOptions))
    if (draft.tests?.length) setTestsState(draft.tests)

    if (formRef.current) {
      formRef.current.title.value = draft.title ?? ''
      formRef.current.info.value = draft.info ?? ''
    }
  }, [isEditing])

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
      language: languageState,
      languageOptions: languageState === 'typescript' ? tsOptionsState : null,
      tests: testsState,
    })
  }, [isEditing, codeBlockInitHTML, codeBlockSetup, codeBlockTeardown, languageState, tsOptionsState, testsState])

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

  const applyTypeScriptSeed = (seedId) => {
    const seed = getTypeScriptSeedBenchmark(seedId)
    setLanguageState('typescript')
    setTsOptionsState(DEFAULT_TS_OPTIONS)
    setCodeBlockSetup(seed.setup)
    setCodeBlockTeardown('')
    setTestsState(seed.tests.map((test, index) => ({ id: index, ...test })))
    if (formRef.current) {
      if (!formRef.current.title.value) formRef.current.title.value = seed.title
      if (!formRef.current.info.value) formRef.current.info.value = seed.description
    }
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
    setLanguageState('javascript')
    setTsOptionsState(DEFAULT_TS_OPTIONS)
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
  }, pageData) as any

  const submitFormHandler = async event => {
    event.preventDefault()
    setIsSaving(true)
    setSaveError(null)

    const formData: any = {
      title: event.target.title.value,
      info: event.target.info.value
    }

    formData.slug = formDefaults.slug
    formData.initHTML = codeBlockInitHTML
    formData.setup = codeBlockSetup
    formData.teardown = codeBlockTeardown
    formData.language = languageState
    formData.languageOptions = languageState === 'typescript' ? tsOptionsState : null

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
              rows={4}
              placeholder="Explain what you are benchmarking and why..."
              className="flex min-h-[120px] w-full rounded-md border border-input bg-background/50 px-4 py-3 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 focus-visible:border-primary/50 transition-all shadow-inner"
              maxLength={16777215}
              defaultValue={formDefaults.info} 
            />
          </div>
        </CardContent>
      </Card>
    </div>

      <div className="pt-2">
        <Card className="border-border/60 shadow-sm bg-card/40 backdrop-blur-sm overflow-hidden">
          <CardHeader>
            <CardTitle className="text-xl">Code Language</CardTitle>
            <CardDescription>
              Choose how setup, teardown, and test snippets are written. JavaScript stays the default; TypeScript is compiled where engines need JavaScript.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <label className={`rounded-xl border p-4 cursor-pointer transition-colors ${languageState === 'javascript' ? 'border-primary/60 bg-primary/5' : 'border-border/60 bg-background/40 hover:bg-muted/30'}`}>
                <input
                  type="radio"
                  name="language"
                  value="javascript"
                  checked={languageState === 'javascript'}
                  onChange={() => setLanguageState('javascript')}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold">JavaScript</span>
                <span className="mt-1 block text-xs text-muted-foreground">Fastest setup and compatible with every existing benchmark.</span>
              </label>
              <label className={`rounded-xl border p-4 cursor-pointer transition-colors ${languageState === 'typescript' ? 'border-primary/60 bg-primary/5' : 'border-border/60 bg-background/40 hover:bg-muted/30'}`}>
                <input
                  type="radio"
                  name="language"
                  value="typescript"
                  checked={languageState === 'typescript'}
                  onChange={() => setLanguageState('typescript')}
                  className="sr-only"
                />
                <span className="block text-sm font-semibold">TypeScript</span>
                <span className="mt-1 block text-xs text-muted-foreground">Write typed snippets. Browser, Node, QuickJS and V8 run compiled JS; Deno/Bun can run native TS.</span>
              </label>
            </div>

            {languageState === 'typescript' && (
              <div className="space-y-4">
                <div className="rounded-xl border border-sky-500/30 bg-sky-500/5 p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                    <div>
                      <h4 className="text-sm font-semibold text-sky-800 dark:text-sky-200">Try TypeScript seed benchmarks</h4>
                      <p className="mt-1 text-xs text-muted-foreground">
                        Load typed examples with discriminated unions, generic helpers, and runtime-friendly data setup.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {TYPESCRIPT_SEED_BENCHMARKS.map(seed => (
                        <Button
                          key={seed.id}
                          type="button"
                          variant="outline"
                          size="sm"
                          className="bg-background/60"
                          onClick={() => applyTypeScriptSeed(seed.id)}
                        >
                          {seed.title}
                        </Button>
                      ))}
                    </div>
                  </div>
                </div>

                <details className="rounded-xl border border-border/60 bg-background/40 p-4">
                  <summary className="cursor-pointer text-sm font-semibold">
                    TypeScript options
                    <span className="ml-2 text-xs font-normal text-muted-foreground">
                      Target: {tsOptionsState.target.toUpperCase()}, {tsOptionsState.runtimeMode === 'compiled-everywhere' ? 'compiled everywhere' : 'Deno/Bun native TS'}
                    </span>
                  </summary>
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <div className="grid gap-2">
                      <Label htmlFor="tsTarget">Compile target</Label>
                      <select
                        id="tsTarget"
                        value={tsOptionsState.target}
                        onChange={(event) => setTsOptionsState(opts => ({ ...opts, target: event.target.value }))}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="es2020">ES2020</option>
                        <option value="es2022">ES2022</option>
                        <option value="esnext">ESNext</option>
                      </select>
                      <p className="text-xs text-muted-foreground">ES2020 is the safest default for QuickJS and older engine features.</p>
                    </div>
                    <div className="grid gap-2">
                      <Label htmlFor="tsRuntimeMode">Runtime mode</Label>
                      <select
                        id="tsRuntimeMode"
                        value={tsOptionsState.runtimeMode}
                        onChange={(event) => setTsOptionsState(opts => ({ ...opts, runtimeMode: event.target.value }))}
                        className="h-10 rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="native-where-available">Native TypeScript on Deno/Bun</option>
                        <option value="compiled-everywhere">Compiled JavaScript everywhere</option>
                      </select>
                      <p className="text-xs text-muted-foreground">Node, browser, QuickJS and V8 always use compiled JavaScript.</p>
                    </div>
                  </div>
                  <p className="mt-4 text-xs text-muted-foreground">
                    Snippets are still function bodies. Top-level import/export, JSX and type-checking are not enabled in benchmark runs yet.
                  </p>
                </details>
              </div>
            )}
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
                  <TabsTrigger value="setup" className="text-xs uppercase tracking-wider font-semibold">Setup {languageState === 'typescript' ? 'TS' : 'JS'}</TabsTrigger>
                  <TabsTrigger value="teardown" className="text-xs uppercase tracking-wider font-semibold">Teardown {languageState === 'typescript' ? 'TS' : 'JS'}</TabsTrigger>
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
                  <div className="absolute top-2 right-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground/30 group-hover/editor:text-muted-foreground/60 transition-colors pointer-events-none z-10">{languageLabel(languageState)}</div>
                  <Editor 
                    code={codeBlockSetup} 
                    onUpdate={setCodeBlockSetup} 
                    className={`${editorClassFor(languageState)} w-full p-4 pt-6 font-mono text-sm outline-none focus:bg-primary/[0.02] transition-colors`} 
                    style={{minHeight: "200px"}} 
                  />
                </div>
              </TabsContent>

              <TabsContent value="teardown" className="m-0 border-none outline-none">
                <div className="w-full bg-background relative group/editor">
                  <div className="absolute top-2 right-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground/30 group-hover/editor:text-muted-foreground/60 transition-colors pointer-events-none z-10">{languageLabel(languageState)}</div>
                  <Editor 
                    code={codeBlockTeardown} 
                    onUpdate={setCodeBlockTeardown} 
                    className={`${editorClassFor(languageState)} w-full p-4 pt-6 font-mono text-sm outline-none focus:bg-primary/[0.02] transition-colors`} 
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
            <p className="text-muted-foreground mt-2 text-sm">Write the {languageLabel(languageState)} code you want to benchmark. Each snippet runs as a function body.</p>
          </div>
          <Button type="button" variant="outline" onClick={testsAdd} className="font-semibold shadow-sm hover:shadow transition-all bg-background border-border hover:bg-muted shrink-0">
            + Add Snippet
          </Button>
        </div>
        <div className="space-y-6">
          {testsState.map((test, index) => {
            const optionalProps: any = {}
            if (testsState.length > 2) {
              optionalProps.remove = testsRemove
            }
            return <TestCaseFieldset {...optionalProps} key={test.id} index={index} test={test} language={languageState} update={(e, id) => testsUpdate(e, id)} />
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
