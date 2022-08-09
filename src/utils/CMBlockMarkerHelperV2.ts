import {debounce} from "ts-debounce";
import CodeMirror, {TextMarker} from "codemirror";
import clickAndClear from "./click-and-clear";
import {findLineWidgetAtLine, isCursorOutRange, isRangeSelected} from "./cm-utils";

export class CMBlockMarkerHelperV2 {

    lineWidgetClassName: string;

    /**
     * Constructor
     * @param editor Codemirror editor
     * @param blockRegexp Target content block regexp without the begin-token and end-token
     * @param blockStartTokenRegexp The regexp for the begin-token of the target block.
     * @param blockEndTokenRegex The regexp for the end-token of the target block.
     *                           It only works when the begin-token is matched
     * @param renderer Custom appended line widget renderer function
     * @param spanRenderer Custom inline marker widget renderer function. It will be followed by the widget generated by renderer
     * @param MARKER_CLASS_NAME Target marker class name
     * @param clearOnClick Whether we clear the marker with the rendered content when it is clicked by the mouse
     */
    constructor(private readonly editor: CodeMirror.Editor,
                private readonly blockRegexp: RegExp,
                private readonly blockStartTokenRegexp: RegExp,
                private readonly blockEndTokenRegex: RegExp,
                private readonly renderer: (beginMatch, endMatch, content, fromLine, toLine) => HTMLElement,
                private readonly spanRenderer: () => HTMLElement,
                private readonly MARKER_CLASS_NAME: string,
                private readonly clearOnClick: boolean,
                private readonly renderWhenEditing: boolean
    ) {
        this.lineWidgetClassName = this.MARKER_CLASS_NAME + '-line-widget';
    }

    /**
     * Process current view port to render the target block in the editor with the given marker class name
     */
    public process(afterSetValue: boolean = false) {
        // First, find all math elements
        // We'll only render the viewport
        const viewport = this.editor.getViewport()
        let blockRangeList = [];
        let meetBeginToken = false;
        let prevBeginTokenLineNumber = -1;
        let beginMatch = null;

        let fromLine = viewport.from;
        let toLine = viewport.to;

        if (afterSetValue) {
            fromLine = 0;
            toLine = this.editor.lineCount();
        }

        // start from 0 to avoid strange rendering results
        for (let i = 0; i < toLine; i++) {
            const line = this.editor.getLine(i);

            // if we find the start token, then we will try to find the end token
            if (!meetBeginToken && this.blockStartTokenRegexp.test(line)) {
                beginMatch = line.match(this.blockStartTokenRegexp);
                meetBeginToken = true;
                prevBeginTokenLineNumber = i;
                continue;
            }

            // only find the end token when we met start token before
            //   if found, we save the block line area to blockRangeList
            if (meetBeginToken && this.blockEndTokenRegex.test(line)) {
                if (i >= fromLine) {
                    blockRangeList.push({
                        from: prevBeginTokenLineNumber,
                        to: i,
                        beginMatch: beginMatch,
                        endMatch: line.match(this.blockEndTokenRegex)
                    });
                }
                meetBeginToken = false;
                prevBeginTokenLineNumber = -1;
            }
        }

        // we need to check the left lines if we meet the begin token without end token in current view port
        if (meetBeginToken) {
            for (let i = viewport.to; i < this.editor.lineCount(); ++i) {
                const line = this.editor.getLine(i);
                if (this.blockEndTokenRegex.test(line)) {
                    blockRangeList.push({
                        from: prevBeginTokenLineNumber,
                        to: i,
                        beginMatch: beginMatch,
                        endMatch: line.match(this.blockEndTokenRegex)
                    });
                    break;
                }
            }
        }

        // nothing to do here. Just return
        if (blockRangeList.length === 0) {
            return;
        }

        // improve performance by updating dom only once even with multiple operations
        this._markRanges(blockRangeList);
    }

    private _markRanges(blockRangeList) {
        const cursor = this.editor.getCursor();
        const doc = this.editor.getDoc();

        for (const blockRange of blockRangeList) {
            let from = {line: blockRange.from, ch: 0};
            let to = {line: blockRange.to, ch: this.editor.getLine(blockRange.to).length};

            const cursorOutRange = isCursorOutRange(cursor, from, to);
            let selected = isRangeSelected(from, to, this.editor);

            // check whether we have created a marker for it before
            let existingMarker;
            let existingLineWidget;
            this.editor.findMarks(from, to).find((marker) => {
                if (marker.className === this.MARKER_CLASS_NAME) {
                    // check whether there exists rendered line widget
                    existingLineWidget = findLineWidgetAtLine(this.editor, to.line, this.lineWidgetClassName);
                    if (existingLineWidget) {
                        existingMarker = marker;
                    }

                    // @ts-ignore
                    if (marker.find().from.line !== from.line || marker.find().to.line !== to.line) {
                        marker.clear();
                        if (existingLineWidget) {
                            existingLineWidget.clear();
                        }
                    } else if (!existingMarker) {  // always clear the existing marker without rendered line widget
                        marker.clear();
                    }
                }
            });

            // whatever it is, we do not allow a line widget in a marked range
            for (let i = from.line; i < to.line; i++) {
                const lineWidget = findLineWidgetAtLine(this.editor, i, this.lineWidgetClassName);
                if (lineWidget) {
                    lineWidget.clear();
                }
            }

            // clear all markers and rendered line widgets when selected
            if (selected && cursorOutRange) {
                if (existingMarker) {
                    existingMarker.clear();
                    existingLineWidget.clear();
                }
                continue;
            }

            // get the content in the block without the begin/end tokens
            const blockContentLines = [];
            for (let i = from.line + 1; i <= to.line - 1; ++i) {
                blockContentLines.push(this.editor.getLine(i));
            }

            // otherwise there are two different situations:
            //   1) when cursor outside: set marker and render line widget
            //   2) when cursor inside: **clear** marker if has and only render line widget without marker
            //                          when renderWhenEditing is true
            if (cursorOutRange) {
                if (existingMarker) {  // cursor outside, and there already have a marker and a line widget
                    continue;
                } else {
                    let existingLineWidget = findLineWidgetAtLine(this.editor, to.line, this.lineWidgetClassName);
                    if (existingLineWidget) {
                        existingLineWidget.clear();
                    }

                    // replace the matched range with marker element
                    const markerEl = this.spanRenderer();
                    markerEl.classList.add(this.MARKER_CLASS_NAME);
                    const textMarker = doc.markText(
                        from,
                        to,
                        {
                            replacedWith: markerEl,
                            handleMouseEvents: true,
                            className: this.MARKER_CLASS_NAME, // class name is not renderer in DOM
                            inclusiveLeft: false,
                            inclusiveRight: false
                        },
                    );

                    // build the line widget just after the marker with the rendered element
                    const wrapper = document.createElement('div');
                    const element = this.renderer(blockRange.beginMatch, blockRange.endMatch, blockContentLines.join('\n'), from.line, to.line);
                    wrapper.appendChild(element);
                    const lineWidget = this.createLineWidgetForMarker(doc, to.line, wrapper);
                    this.setStyleAndLogical(doc, from, to, textMarker, markerEl, wrapper, lineWidget);
                }
            } else {
                if (existingMarker) {  // cursor inside, and there already have a marker and a line widget
                    existingMarker.clear();
                }

                let existingLineWidget = findLineWidgetAtLine(this.editor, to.line, this.lineWidgetClassName);
                if (this.renderWhenEditing) {
                    if (existingLineWidget) {
                        existingLineWidget.node.innerHTML = '';
                        const element = this.renderer(blockRange.beginMatch, blockRange.endMatch, blockContentLines.join('\n'), from.line, to.line);
                        existingLineWidget.node.appendChild(element);
                    } else {
                        // build the line widget just after the marker with the rendered element
                        const wrapper = document.createElement('div');
                        const element = this.renderer(blockRange.beginMatch, blockRange.endMatch, blockContentLines.join('\n'), from.line, to.line);
                        wrapper.appendChild(element);
                        this.createLineWidgetForMarker(doc, to.line, wrapper);
                    }
                } else if (existingLineWidget) {
                    existingLineWidget.clear();
                }
            }
        }
    }

    private createLineWidgetForMarker(doc, line, element) {
        return doc.addLineWidget(line, element, { className: this.lineWidgetClassName });
    }

    private setStyleAndLogical(doc, from, to, textMarker, makerEl, renderedWrapper, wrapperLineWidget) {
        renderedWrapper.style.cssText = 'border: 2px solid transparent; padding: 4px; width: 100%; border-radius: 4px; background-color: var(--joplin-background-color) !important; transition: border-color 500ms;';
        const editButton = document.createElement('div');
        editButton.innerHTML = `<svg viewBox="0 0 100 100" class="code-glyph" width="16" height="16"><path fill="currentColor" stroke="currentColor" d="M56.6,13.3c-1.6,0-2.9,1.2-3.2,2.7L40.1,82.7c-0.3,1.2,0.1,2.4,1,3.2c0.9,0.8,2.2,1.1,3.3,0.7c1.1-0.4,2-1.4,2.2-2.6 l13.3-66.7c0.2-1,0-2-0.7-2.8S57.6,13.3,56.6,13.3z M24.2,26.6c-1.1,0-2.1,0.5-2.8,1.4l-14.1,20c-0.8,1.2-0.8,2.7,0,3.9l14.1,20 c1.1,1.5,3.1,1.9,4.6,0.8c1.5-1.1,1.9-3.1,0.8-4.6L14.1,50l12.8-18.1c0.7-1,0.8-2.4,0.3-3.5C26.6,27.3,25.4,26.6,24.2,26.6 L24.2,26.6z M76.5,26.6c-1.2,0-2.4,0.8-2.9,1.9c-0.5,1.1-0.4,2.4,0.3,3.4L86.7,50L73.9,68.1c-0.7,1-0.8,2.2-0.3,3.3 s1.5,1.8,2.7,1.9c1.2,0.1,2.3-0.4,3-1.4l14.1-20c0.8-1.2,0.8-2.7,0-3.9l-14.1-20C78.7,27.1,77.7,26.6,76.5,26.6L76.5,26.6z"></path></svg>`;
        editButton.style.cssText = 'position: absolute; top: 8px; right: 10px; width: 24px; height: 24px;' +
            'background-color: #19a2f0 !important; color: #f2f2f2; border-radius: 5px; display: flex; align-items: center; justify-content: center; transition: opacity 500ms;';
        editButton.style.opacity = '0';
        if (this.clearOnClick) {
            makerEl.onclick = (e) => {
                wrapperLineWidget.clear();
                clickAndClear(textMarker, this.editor)(e);
            };
        }
        editButton.onclick = (e) => {
            if (textMarker) {
                // this.clearLineWidgetForMarker(textMarker, wrapperLineWidget);
                const from = textMarker.find().from;
                const to = textMarker.find().to;
                textMarker.clear();
                doc.setSelection(
                    {line: from.line + 1, ch: 0},
                    {line: to.line - 1, ch: this.editor.getLine(to.line - 1).length}
                );
            }
        }
        renderedWrapper.appendChild(editButton);
        renderedWrapper.onmouseover = (e) => {
            editButton.style.opacity = '1';
            renderedWrapper.style.border = '2px solid #d8d8d8';
        };
        renderedWrapper.onmouseleave = (e) => {
            editButton.style.opacity = '0';
            renderedWrapper.style.border = '2px solid transparent';
        };
    }
}
