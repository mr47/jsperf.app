import { useState } from 'react'
import Router from 'next/router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import UUID from '../UUID'
import { Trash2 } from 'lucide-react'
import Editor from '../Editor'

const TestCaseFieldset = ({index, remove, test, update}) => {
  return (
    <Card className="mb-6 overflow-hidden border-border/60 shadow-sm bg-card/40 backdrop-blur-sm group">
      {/* Subtle top border accent instead of full gradient bar */}
      <div className="h-[2px] w-full bg-primary/20 group-hover:bg-primary/50 transition-colors" />
      
      <CardContent className="p-0">
        <div className="flex flex-col">
          
          {/* Top Row: Number, Title Input, Remove Button all perfectly inline */}
          <div className="flex items-center gap-3 p-4 bg-muted/10 border-b border-border/50">
            <div className="bg-background border border-border/50 text-muted-foreground font-mono font-bold w-8 h-8 rounded flex items-center justify-center text-sm shadow-sm shrink-0">
              {index + 1}
            </div>
            
            <div className="flex-1 flex items-center bg-background border border-border/50 rounded-md overflow-hidden focus-within:ring-1 focus-within:ring-primary/50 focus-within:border-primary/50 transition-all shadow-sm">
              <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider px-3 border-r border-border/50 bg-muted/30 py-2.5">
                Title
              </span>
              <input
                id={`testTitle-${test.id}`}
                type="text" 
                name="testTitle" 
                placeholder="e.g. Using Array.map()"
                className="flex-1 bg-transparent px-3 py-2 text-sm outline-none placeholder:text-muted-foreground/50"
                onChange={event => update({"title": event.target.value}, test.id)} 
                required 
                defaultValue={test && test.title} 
              />
            </div>

            {remove && (
              <Button variant="ghost" size="sm" type="button" onClick={() => remove(test.id)} className="h-10 text-muted-foreground hover:text-destructive hover:bg-destructive/10 border border-transparent hover:border-destructive/20 transition-all flex items-center gap-2">
                <Trash2 className="w-4 h-4" />
                <span className="hidden sm:inline-block">Remove</span>
              </Button>
            )}
          </div>

          {/* Editor Area (No label, just code) */}
          <div className="w-full bg-background relative group/editor">
            {/* Very subtle floating label inside the editor area so it doesn't waste vertical space */}
            <div className="absolute top-2 right-4 text-[10px] uppercase tracking-widest font-bold text-muted-foreground/30 group-hover/editor:text-muted-foreground/60 transition-colors pointer-events-none z-10">
              JavaScript
            </div>
            <Editor 
              code={test && test.code} 
              onUpdate={code => update({code}, test.id)} 
              className="javascript w-full p-4 pt-5 font-mono text-sm outline-none focus:bg-primary/[0.02] transition-colors" 
              style={{minHeight: "200px"}} 
            />
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

export default function EditForm({pageData}) {
  const uuid = UUID()

  // Code block states
  const [codeBlockInitHTML, setCodeBlockInitHTML] = useState(pageData?.initHTML || '')
  const [codeBlockSetup, setCodeBlockSetup] = useState(pageData?.setup || '')
  const [codeBlockTeardown, setCodeBlockTeardown] = useState(pageData?.teardown || '')

  // Test states
  let defaultTestsState = [
    {id: 0, title: '', code: ''},
    {id: 1, title: '', code: ''},
  ]

  if (pageData?.tests) {
    defaultTestsState = pageData.tests.map((test, index) => ({id: index, ...test}))
  }

  const [testsState, setTestsState] = useState(defaultTestsState)

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

  const formDefaults = Object.assign({}, {
    title: '',
    info: '',
    slug: '',
    visible: false
  }, pageData)

  const submitFormHandler = async event => {
    event.preventDefault()

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

    const response = await fetch('/api/page', {
      method: (isPublished || !pageData) ? 'POST' : 'PUT',
      body: JSON.stringify(formData),
    })

    const {success, message, data} = await response.json()

    if (success) {
      Router.push(`/${data.slug}/${data.revision}/preview`)
    } else {
      console.log(success, message, data)
    }
  }

  return (
    <form onSubmit={submitFormHandler} className="w-full max-w-5xl mx-auto space-y-10 pb-20">
      
      <Card className="border-border/60 shadow-sm bg-card/40 backdrop-blur-sm overflow-hidden">
        <div className="h-[2px] w-full bg-primary/20" />
        <CardHeader className="bg-muted/20 border-b border-border/50 pb-6">
          <CardTitle className="text-2xl font-bold tracking-tight">Benchmark Details</CardTitle>
          <CardDescription className="text-base">Provide basic information about your performance test so others can understand what you are comparing.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6 pt-6">
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

      <Card className="border-border/60 shadow-sm bg-card/40 backdrop-blur-sm overflow-hidden">
        <div className="h-[2px] w-full bg-primary/20" />
        <CardHeader className="bg-muted/20 border-b border-border/50 pb-6">
          <CardTitle className="text-2xl font-bold tracking-tight">Preparation & Teardown</CardTitle>
          <CardDescription className="text-base">Code that runs before/after the tests. Useful for setting up the DOM or declaring shared variables.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-8 pt-6">
          <div className="grid gap-3">
            <div className="flex justify-between items-baseline">
              <Label htmlFor="initHTML" className="text-sm font-semibold">Preparation HTML</Label>
              <span className="text-xs text-muted-foreground hidden sm:inline">Inserted into the document {`<body>`}</span>
            </div>
            <div className="rounded-lg overflow-hidden border border-border/50 bg-muted/10 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 shadow-inner transition-all">
              <Editor code={codeBlockInitHTML} onUpdate={setCodeBlockInitHTML} className="html w-full p-4 font-mono text-sm outline-none" style={{minHeight: "120px"}} />
            </div>
            <p className="text-xs text-muted-foreground sm:hidden">Inserted into the document {`<body>`}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
            <div className="grid gap-3">
              <Label htmlFor="setup" className="text-sm font-semibold">Setup JS <span className="font-normal text-xs text-muted-foreground ml-2">(runs before tests)</span></Label>
              <div className="rounded-lg overflow-hidden border border-border/50 bg-muted/10 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 shadow-inner transition-all">
                <Editor code={codeBlockSetup} onUpdate={setCodeBlockSetup} className="javascript w-full p-4 font-mono text-sm outline-none" style={{minHeight: "150px"}} />
              </div>
            </div>

            <div className="grid gap-3">
              <Label htmlFor="teardown" className="text-sm font-semibold">Teardown JS <span className="font-normal text-xs text-muted-foreground ml-2">(runs after tests)</span></Label>
              <div className="rounded-lg overflow-hidden border border-border/50 bg-muted/10 focus-within:border-primary/50 focus-within:ring-1 focus-within:ring-primary/50 shadow-inner transition-all">
                <Editor code={codeBlockTeardown} onUpdate={setCodeBlockTeardown} className="javascript w-full p-4 font-mono text-sm outline-none" style={{minHeight: "150px"}} />
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <div className="pt-4">
        <div className="flex items-center justify-between mb-6">
          <h3 className="text-3xl font-extrabold tracking-tight">Test Snippets</h3>
          <Button type="button" variant="outline" onClick={testsAdd} className="font-semibold shadow-sm hover:shadow transition-all bg-background border-border hover:bg-muted">
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

      <div className="sticky bottom-6 z-10 flex flex-col sm:flex-row items-center gap-4 p-4 rounded-2xl border border-border/50 bg-card/80 backdrop-blur-xl shadow-2xl mt-16 ring-1 ring-white/10 dark:ring-white/5">
        <div className="flex-1 text-sm font-medium text-muted-foreground ml-2 text-center sm:text-left">
          Ready to run? Make sure all your snippets are correct.
        </div>
        <Button type="button" variant="secondary" onClick={testsAdd} className="hidden sm:inline-flex w-full sm:w-auto shadow-sm">
          Add Another Test
        </Button>
        <Button type="submit" size="lg" className="w-full sm:w-auto font-bold px-8 shadow-md hover:shadow-lg hover:-translate-y-0.5 transition-all">
          Save & Run Benchmark
        </Button>
      </div>
      
    </form>
  )
}
