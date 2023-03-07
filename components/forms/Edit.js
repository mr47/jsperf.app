import { useState, useEffect, useRef } from 'react'
import Router from 'next/router'
import { signIn, useSession } from "next-auth/react"
import GitHubIcon from '../GitHubIcon'
import buttonStyles from '../../styles/buttons.module.css'
import formStyles from '../../styles/forms.module.css'
import UUID from '../UUID'
import MinusIcon from '../MinusIcon'

import Editor from '../Editor'

const TestCaseFieldset = ({index, remove, test, update}) => {
  return (
    <fieldset name="testCase">
      <div>
        <h2 className="mx-5 w-full md:w-1/4 text-black font-bold text-right">
          {
            remove && 
              <button className="align-middle mr-2" type="button" onClick={() => remove(test.id)}>
                <MinusIcon fill="#000000" width={20} height={20} className="fill-inherit" />
              </button>
          }
          Test #{index + 1}
        </h2>
      </div>
      <div>
        <label htmlFor="testTitle">Title <span className="text-red-600">*</span></label>
        <input type="text" name="testTitle" onChange={event => update({"title": event.target.value}, test.id)} required defaultValue={test && test.title} />
      </div>
      <div>
        <label htmlFor="async">Async</label>
        <input type="checkbox" name="async" onChange={event => update({"async": event.target.checked}, test.id)} defaultValue={test && test.async} />
      </div>
      <div>
        <label htmlFor="code" className="self-start">Code <span className="text-red-600">*</span></label>
        <Editor code={test && test.code} onUpdate={code => update({code}, test.id)} className="javascript w-full md:w-1/2 p-2 border" style={{minHeight: "150px"}} />
      </div>
    </fieldset>
  )
}


// We need to give each test in the array of tests a stable key.
// Otherwise when we change order or remove react will not update the mapped array if using the array index
// https://stackoverflow.com/questions/39549424/how-to-create-unique-keys-for-react-elements
let stableTestKey = 0

export default function EditForm({pageData}) {
  const uuid = UUID()

  // Code block states
  const [codeBlockInitHTML, setCodeBlockInitHTML] = useState(pageData?.initHTML || '')
  const [codeBlockSetup, setCodeBlockSetup] = useState(pageData?.setup || '')
  const [codeBlockTeardown, setCodeBlockTeardown] = useState(pageData?.teardown || '')

  // Test states
  const testDefault = () => ({id: stableTestKey++, title: '', code: '', 'async': false})

  let defaultTestsState = [
    {id: 0, title: '', code: '', 'async': false},
    {id: 1, title: '', code: '', 'async': false},
  ]
  if (pageData?.tests) {
    defaultTestsState = pageData.tests.map((t, i) => ({id: i, ...t}))
  }

  console.log('trigger', stableTestKey)
  const [testsState, setTestsState] = useState(defaultTestsState)

  const testsRemove = (id) => {
    const testIndex = testsState.findIndex(test => test.id === id)
    setTestsState(tests => tests.splice(testIndex, 1) && [...tests])
  }

  const testsAdd = () => {
    const lastId = testsState[testsState.length - 1].id
    console.log('adding new test with id: ', lastId+1)
    setTestsState(tests => tests.push({id: lastId+1, title: '', code: '', 'async': false}) && [...tests])
  }

  const testsUpdate = (test, id) => {
    const testIndex = testsState.findIndex(test => test.id === id)
    testsState[testIndex] = {...testsState[testIndex], ...test}
    setTestsState(testsState)
  }

  // Default form values if none are provided via props.pageData
  const formDefaults = Object.assign({}, {
    title: '',
    info: '',
    slug: '',
    visible: false
  }, pageData)

  const submitFormHandler = async event => {
    event.preventDefault()

    // Pick fields referenced by their ID from the form to include in request payload
    // Uses IIFE to destructure event.target. event.target is the form.
    const formData = (({
      title, 
      info
    }) => ({
      title: title.value, 
      info: info.value
    }))( event.target )

    formData.slug = formDefaults.slug

    formData.initHTML = codeBlockInitHTML
    formData.setup = codeBlockSetup
    formData.teardown = codeBlockTeardown
    formData.tests = testsState

    const isPublished = !!pageData?.visible

    // Editing an existing document
    if (pageData?.revision) {
      formData.revision = pageData.revision
    }

    // Include UUID in payload
    formData.uuid = uuid

    // Send form data to tests API
    const response = await fetch('/api/page', {
      method: (isPublished || !pageData) ? 'POST' : 'PUT',
      body: JSON.stringify(formData),
    })

    const {success, message, data} = await response.json()

    if (success) {
      // redirect to SSR preview page
      Router.push(`/${data.slug}/${data.revision}/preview`)
    }
  }

  return (
    <form onSubmit={submitFormHandler} className={`${formStyles.editForm} w-full`}>
      <fieldset>
        <h3 className="bg-blue-500">Test case details</h3>
        <div>
          <label htmlFor="title">
            Title <span className="text-red-600">*</span>
          </label>
          <input type="text" id="title" name="title" defaultValue={formDefaults.title} required />
        </div>
        <div>
          <label htmlFor="info" className="self-start">Description <br /><span className="text-gray-300 font-normal">(Markdown syntax is allowed)</span> </label>
          <textarea name="info" id="info" rows="5" maxLength="16777215" defaultValue={formDefaults.info}></textarea>
        </div>
      </fieldset>
      <fieldset>
        <h3 className="bg-blue-500">Preparation Code</h3>

        <div>
          <label htmlFor="initHTML" className="self-start">Preparation HTML <br /><span className="text-gray-300 font-normal">(this will be inserted in the <code>{`<body>`}</code> of a valid HTML5 document in standards mode)<br />(useful when testing DOM operations or including libraries)</span></label>
          <Editor code={codeBlockInitHTML} onUpdate={setCodeBlockInitHTML} className="html w-full md:w-1/2 p-2 border" style={{minHeight: "150px"}} />
        </div>

        <div>
          <label htmlFor="setup" className="self-start">Setup JS</label>
          <Editor code={codeBlockSetup} onUpdate={setCodeBlockSetup} className="javascript w-full md:w-1/2 p-2 border" style={{minHeight: "150px"}} />
        </div>

        <div>
          <label htmlFor="teardown" className="self-start">Teardown JS</label>
          <Editor code={codeBlockTeardown} onUpdate={setCodeBlockTeardown} className="javascript w-full md:w-1/2 p-2 border" style={{minHeight: "150px"}} />
        </div>

      </fieldset>
      <fieldset>
        <h3 className="bg-blue-500">Test cases</h3>
        { 
          testsState.map((test,index) => {
            const optionalProps = {}
            index > 1 && (optionalProps.remove = testsRemove)
            return <TestCaseFieldset {...optionalProps} key={test.id} index={index} test={test} update={e => {testsUpdate(e, test.id)}} />
          })
        }
      </fieldset>
      <div className="flex my-5 items-center">
        <div className="flex-1">
          <button type="button" className="underline hover:no-underline" onClick={testsAdd}>Add test</button>
        </div>
        <button type="submit" className={buttonStyles.default}>Save test case</button>
      </div>
    </form>
  )
}
