/**
 * @ignore
 * BEGIN HEADER
 *
 * Contains:        Heading tags Plugin
 * CVM-Role:        CodeMirror Plugin
 * Maintainer:      Hendrik Erz
 * License:         GNU GPL v3
 *
 * Description:     This plugin renders Bear-style heading indicators.
 *
 * END HEADER
 */

import CodeMirror, { commands } from 'codemirror'
import { getHeadRE } from '../../../../utils/regular-expressions'
import showPopupMenu from './window-register/application-menu-helper'
import canRenderElement from '../../../../utils/can-render-element'

const headRE = getHeadRE()

export function markdownRenderHTags (cm: CodeMirror.Editor, viewPort: boolean): void {
    let match

    let fromLine = 0;
    let toLine = Math.min(60, cm.lineCount());

    if (viewPort) {
        // We'll only renderer the viewport
        const viewport = cm.getViewport()
        fromLine = viewport.from;
        toLine = viewport.to;
    }
    for (let i = fromLine; i < toLine; i++) {
        if (cm.getModeAt({ 'line': i, 'ch': 0 }).name !== 'markdown') continue
        // Always reset lastIndex property, because test()-ing on regular
        // expressions advances it.
        headRE.lastIndex = 0

        // First get the line and test if the contents contain a link
        let line = cm.getLine(i)
        if ((match = headRE.exec(line)) == null) {
            continue
        }

        const headingLevel = match[1].length

        const curFrom = { line: i, ch: 0 }
        const curTo = { line: i, ch: headingLevel }

        if (!canRenderElement(cm, curFrom, curTo, !viewPort)) {
            continue
        }

        const hTagWrapper = document.createElement('div')
        hTagWrapper.className = 'heading-tag'

        const hTag = document.createElement('span')
        hTag.textContent = `h${headingLevel}`
        hTagWrapper.appendChild(hTag)

        const textMarker = cm.markText(
            curFrom, curTo,
            {
                'clearOnEnter': true,
                'replacedWith': hTagWrapper,
                'inclusiveLeft': false,
                'inclusiveRight': false
            }
        )

        // Display a small menu to change the heading level on click
        hTagWrapper.onclick = (e) => {
            // Prevent bubbling because otherwise the context menu will be hidden
            // again immediately due to the event bubbling upwards to the window.
            e.stopPropagation()

            const items = [
                {
                    id: '1',
                    label: '#',
                    type: 'checkbox',
                    enabled: !cm.isReadOnly(),
                    checked: headingLevel === 1
                },
                {
                    id: '2',
                    label: '##',
                    type: 'checkbox',
                    enabled: !cm.isReadOnly(),
                    checked: headingLevel === 2
                },
                {
                    id: '3',
                    label: '###',
                    type: 'checkbox',
                    enabled: !cm.isReadOnly(),
                    checked: headingLevel === 3
                },
                {
                    id: '4',
                    label: '####',
                    type: 'checkbox',
                    enabled: !cm.isReadOnly(),
                    checked: headingLevel === 4
                },
                {
                    id: '5',
                    label: '#####',
                    type: 'checkbox',
                    enabled: !cm.isReadOnly(),
                    checked: headingLevel === 5
                },
                {
                    id: '6',
                    label: '######',
                    type: 'checkbox',
                    enabled: !cm.isReadOnly(),
                    checked: headingLevel === 6
                }
            ]

            const point = { x: e.clientX, y: e.clientY }
            showPopupMenu(point, items as any, (id) => {
                const newLevel = parseInt(id, 10)

                const markerRange = textMarker.find()
                if (markerRange === undefined) {
                    return
                }

                // The heading might have changed position in the meantime
                const { from, to } = markerRange
                cm.replaceRange('#'.repeat(newLevel), from, to)
                textMarker.clear()
                // Programmatically trigger a cursor movement ...
                cm.setCursor({ line: from.line, ch: newLevel + 1 })
                // ... and re-focus the editor
                cm.focus()
            })
        }
    }
}
