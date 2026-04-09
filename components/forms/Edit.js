import { useState } from 'react'
import Router from 'next/router'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import UUID from '../UUID'
import MinusIcon from '../MinusIcon'
import Editor from '../Editor'

const TestCaseFieldset = ({index, remove, test, update}) => {
  return (
    <Card className="mb-4">
      <CardHeader className="py-4 flex flex-row items-center justify-between">
        <CardTitle className="text-lg">Test #{index + 1}</CardTitle>
        {remove && (
          <Button variant="ghost" size="icon" type="button" onClick={() => remove(test.id)} className="text-destructive">
            <MinusIcon fill="currentColor" width={20} height={20} />
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-2">
          <Label htmlFor={`testTitle-${test.id}`}>Title <span className="text-red-500">*</span></Label>
          <Input 
            id={`testTitle-${test.id}`}
            type="text" 
            name="testTitle" 
            onChange={event => update({"title": event.target.value}, test.id)} 
            required 
            defaultValue={test && test.title} 
          />
        </div>
        <div className="flex items-center gap-2">
          <input 
            type="checkbox" 
            id={`async-${test.id}`}
            name="async" 
            className="w-4 h-4 rounded border-gray-300 text-primary focus:ring-primary"
            onChange={event => update({"async": event.target.checked}, test.id)} 
            defaultChecked={test && test.async} 
          />
          <Label htmlFor={`async-${test.id}`} className="font-normal cursor-pointer">Async</Label>
        </div>
        <div className="grid gap-2">
          <Label htmlFor={`code-${test.id}`}>Code <span className="text-red-500">*</span></Label>
          <Editor 
            code={test && test.code} 
            onUpdate={code => update({code}, test.id)} 
            className="javascript w-full p-2 border rounded-md font-mono text-sm" 
            style={{minHeight: "150px"}} 
          />
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
    {id: 0, title: '', code: '', 'async': false},
    {id: 1, title: '', code: '', 'async': false},
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
    const lastId = testsState[testsState.length - 1].id
    setTestsState(tests => [...tests, {id: lastId+1, title: '', code: '', 'async': false}])
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
    <form onSubmit={submitFormHandler} className="w-full space-y-8">
      
      <Card>
        <CardHeader>
          <CardTitle>Test Case Details</CardTitle>
          <CardDescription>Basic information about your performance benchmark.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-2">
            <Label htmlFor="title">
              Title <span className="text-red-500">*</span>
            </Label>
            <Input type="text" id="title" name="title" defaultValue={formDefaults.title} required />
          </div>
          <div className="grid gap-2">
            <Label htmlFor="info">
              Description <span className="text-muted-foreground font-normal ml-2">(Markdown syntax is allowed)</span>
            </Label>
            <textarea 
              name="info" 
              id="info" 
              rows="5" 
              className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
              maxLength="16777215" 
              defaultValue={formDefaults.info} 
            />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Preparation Code</CardTitle>
          <CardDescription>Code that runs before any tests are executed.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-2">
            <Label htmlFor="initHTML">
              Preparation HTML
              <span className="block text-muted-foreground font-normal text-xs mt-1">
                (this will be inserted in the {`<body>`} of a valid HTML5 document in standards mode)
                <br />(useful when testing DOM operations or including libraries)
              </span>
            </Label>
            <Editor code={codeBlockInitHTML} onUpdate={setCodeBlockInitHTML} className="html w-full p-2 border rounded-md font-mono text-sm" style={{minHeight: "150px"}} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="setup">Setup JS</Label>
            <Editor code={codeBlockSetup} onUpdate={setCodeBlockSetup} className="javascript w-full p-2 border rounded-md font-mono text-sm" style={{minHeight: "150px"}} />
          </div>

          <div className="grid gap-2">
            <Label htmlFor="teardown">Teardown JS</Label>
            <Editor code={codeBlockTeardown} onUpdate={setCodeBlockTeardown} className="javascript w-full p-2 border rounded-md font-mono text-sm" style={{minHeight: "150px"}} />
          </div>
        </CardContent>
      </Card>

      <div>
        <h3 className="text-2xl font-bold tracking-tight mb-4">Test Cases</h3>
        <div className="space-y-4">
          {testsState.map((test, index) => {
            const optionalProps = {}
            index > 1 && (optionalProps.remove = testsRemove)
            return <TestCaseFieldset {...optionalProps} key={test.id} index={index} test={test} update={(e, id) => testsUpdate(e, id)} />
          })}
        </div>
      </div>

      <div className="flex flex-col sm:flex-row items-center gap-4 pt-4 border-t border-border">
        <Button type="button" variant="outline" onClick={testsAdd} className="w-full sm:w-auto">
          Add Test Case
        </Button>
        <div className="flex-1"></div>
        <Button type="submit" size="lg" className="w-full sm:w-auto font-bold">
          Save Test Case
        </Button>
      </div>
      
    </form>
  )
}
