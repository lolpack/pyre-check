/**
 * Copyright (c) Meta Platforms, Inc. and affiliates.
 *
 * This source code is licensed under the MIT license found in the
 * LICENSE file in the root directory of this source tree.
 *
 * @format
 */

import React, {useState, useEffect, useRef, type MixedElement} from 'react';
import {useBaseUrlUtils} from '@docusaurus/useBaseUrl';
import clsx from 'clsx';
import Editor from '@monaco-editor/react';
import * as LZString from 'lz-string';
import styles from './TryPyre2.module.css';
import TryPyre2ConfigEditor from './TryPyre2ConfigEditor';
import TryPyre2Results from './TryPyre2Results';
import {
  monaco,
  setAutoCompleteFunction,
  setGetDefFunction,
  setHoverFunctionForMonaco,
} from './configured-monaco';
import FlowJsServices from './flow-services';
import flowLanguageConfiguration from './flow-configuration.json';

const TRY_FLOW_LAST_CONTENT_STORAGE_KEY = 'TryPyre2LastContent';
const DEFAULT_PYTHON_PROGRAM = `
# Pyre is being run in gradual typing mode: https://pyre-check.org/docs/types-in-python/#gradual-typing
# Use the \`# pyre-strict\` header to run in strict mode, which requires annotations.

from typing import *

# reveal_type will produce a type error that tells you the type Pyre has
# computed for the argument (in this case, int)
def test(x: int) -> str:
  return f"{x}"

reveal_type(test(42))

`;

const LLM_SERVICE_URL= 'http://localhost:5002'//'https://type-check-service-b4ffb457dde9.herokuapp.com'

const pyre2WasmUninitializedPromise =
  typeof window !== 'undefined' ? import('./pyre2_wasm') : new Promise((_resolve) => {});

const pyre2WasmInitializedPromise = pyre2WasmUninitializedPromise.then(async (mod) => {
  await mod.default();
  return mod;
}).catch(e => console.log(e));

export default component TryPyre2(
  defaultFlowVersion: string,
  flowVersions: $ReadOnlyArray<string>,
  editorHeight: number,
  codeSample: string,
) {
  const {withBaseUrl} = useBaseUrlUtils();
  const editorRef = useRef(null);
  const [internalError, setInternalError] = useState('');
  const [loading, setLoading] = useState(true);
  const [pyreService, setPyreService] = useState<any>(null);

  useEffect(() => {
    setLoading(true);
    pyre2WasmInitializedPromise
      .then(pyre2 => {
        setPyreService(new pyre2.State());
        setLoading(false);
        setInternalError('');
      })
      .catch(e => {
        setLoading(false);
        setInternalError(JSON.stringify(e));
      });
  }, []);

  useEffect(() => {
    forceRecheck();
  }, [pyreService]);

  function forceRecheck() {
    const model = monaco.editor.getModels()[0];
    if (model == null || pyreService == null) return;
    const value = model.getValue();

    setAutoCompleteFunction((l, c) => pyreService.autoComplete(l, c));
    setGetDefFunction((l, c) => pyreService.gotoDefinition(l, c));
    setHoverFunctionForMonaco((l, c) => pyreService.queryType(l, c));

    // typecheck on edit
    try {
      pyreService.updateSource(model.getValue());
      monaco.editor.setModelMarkers(model, 'default', pyreService.getErrors())
      setInternalError('');
    } catch (e) {
      console.error(e);
      setInternalError(JSON.stringify(e));
    }
  }

  function onMount(editor: any) {
    forceRecheck();

    editorRef.current = editor;
  }

  async function addTypesToCode() {
    if (!editorRef.current) return;
    const currentCode = editorRef.current.getValue();
  
    try {
      const response = await fetch(`${LLM_SERVICE_URL}/add-types`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: currentCode }),
      });
  
      const data = await response.json();
      if (response.ok) {
        editorRef.current.setValue(data.typedCode);
      } else {
        alert(`Error: ${data.error}`);
      }
    } catch (error) {
      console.error("Failed to fetch types:", error);
      alert("Failed to fetch types from backend.");
    }
  }
  
  async function explainTypeError() {
    if (!editorRef.current) return;
    const editor = editorRef.current;
    const model = editor.getModel();
    const position = editor.getPosition(); // Get cursor position
    const currentCode = editor.getValue();
    const typeError = ' ' //get error from pyreService somehow
  
    try {
      const response = await fetch(`${LLM_SERVICE_URL}/explain-error`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: currentCode, typeError: typeError }),
      });
  
      const data = await response.json();
      if (response.ok) {
        const explanation = data.explanation || "No explanation available.";
  
        // Register a Monaco hover provider for Python
        monaco.languages.registerHoverProvider("python", {
          provideHover: function (_, hoverPosition) {
            if (hoverPosition.lineNumber === position.lineNumber) {
              return {
                range: new monaco.Range(position.lineNumber, 1, position.lineNumber, 1),
                contents: [{ value: `**AI Explanation:**\n\n${explanation}` }],
              };
            }
          },
        });
  
        // Manually trigger the hover effect
        editor.trigger("keyboard", "editor.action.showHover");
      } else {
        console.error("Error from backend:", data.error);
      }
    } catch (error) {
      console.error("Failed to fetch explanation:", error);
    }
  }

  const height = editorHeight || "calc(100vh - var(--ifm-navbar-height) - 40px)";

  return (
    <div className={styles.tryEditor}>
      <div className={styles.code}>
        <div className={styles.editorContainer}>
          <Editor
            defaultValue={codeSample || DEFAULT_PYTHON_PROGRAM}
            defaultLanguage="python"
            theme="vs-light"
            height={height}
            onChange={forceRecheck}
            onMount={onMount}
            options={{
              minimap: {enabled: false},
              hover: {enabled: true, above: false},
              scrollBeyondLastLine: false,
              overviewRulerBorder: false,
            }}
          />
        </div>
        {!codeSample && (
          <div className={styles.buttonContainer}>
            <button className={styles.button} onClick={addTypesToCode}>
              ➕ Add Types to My Code
            </button>
            <button className={styles.button} onClick={explainTypeError}>
              ❓ Explain This Type Error to Me
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
