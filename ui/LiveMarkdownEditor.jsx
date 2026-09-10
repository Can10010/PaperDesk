import React, {forwardRef, useEffect, useImperativeHandle, useRef} from 'react';
import {EditorState, StateField, StateEffect, Annotation, Transaction} from '@codemirror/state';
import {EditorView, Decoration, WidgetType, keymap, placeholder as editorPlaceholder} from '@codemirror/view';
import {defaultKeymap, history, historyKeymap, indentWithTab} from '@codemirror/commands';
import {markdown, markdownLanguage} from '@codemirror/lang-markdown';
import {HighlightStyle, syntaxHighlighting} from '@codemirror/language';
import {tags} from '@lezer/highlight';
import DOMPurify from 'dompurify';
import {markdownBlocks, renderMarkdownBlock} from './markdown.mjs';

const focusChanged = StateEffect.define();
const externalChange = Annotation.define();
const normalize = value => (value || '').replace(/\r\n?/g, '\n');
const sanitize = html => DOMPurify.sanitize(html, {ALLOWED_URI_REGEXP:/^(?:(?:https?|mailto|paperdesk):|[^a-z]|[a-z+.-]+(?:[^a-z+.-:]|$))/i});

class RenderedBlock extends WidgetType {
  constructor(block, onPaperLink) {super();this.block=block;this.onPaperLink=onPaperLink;}
  eq(other) {return this.block.from===other.block.from && this.block.html===other.block.html;}
  toDOM(view) {
    const dom=document.createElement('div');
    dom.className='markdown cm-rendered-block';dom.dataset.markdownFrom=String(this.block.from);
    dom.innerHTML=this.block.html;
    const tasks=[...this.block.raw.matchAll(/^[ \t]*(?:[-*+]|\d+[.)])\s+\[([ xX])\]/gm)];
    dom.querySelectorAll('input[type=checkbox]').forEach((checkbox,index)=>{
      const task=tasks[index];if(!task)return;
      checkbox.disabled=false;checkbox.setAttribute('aria-label','切换任务完成状态');
      checkbox.addEventListener('change',()=>{
        const from=this.block.from+task.index+task[0].indexOf('[')+1;
        view.dispatch({changes:{from,to:from+1,insert:checkbox.checked?'x':' '},userEvent:'input'});
      });
    });
    dom.addEventListener('mousedown',event=>{
      if(event.button!==0 || event.target.matches('input[type=checkbox]'))return;
      const link=event.target.closest('a');
      if(link && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();const href=link.getAttribute('href') || '';
        if(href.startsWith('paperdesk://paper/')) this.onPaperLink?.(decodeURIComponent(href.slice('paperdesk://paper/'.length)));
        else if(/^https?:\/\//.test(href)) window.open(href,'_blank','noopener,noreferrer');
        return;
      }
      // Map the clicked text back to Markdown while keeping the actual source intact.
      const caret=document.caretPositionFromPoint?.(event.clientX,event.clientY);
      const range=!caret && document.caretRangeFromPoint?.(event.clientX,event.clientY);
      const node=caret?.offsetNode || range?.startContainer;
      const offset=caret?.offset ?? range?.startOffset ?? 0;
      let relative=this.block.raw.search(/[^\s#>*`$\\\[\]()]/);
      if(node?.nodeType===Node.TEXT_NODE && dom.contains(node)) {
        const text=node.textContent;
        const found=this.block.raw.indexOf(text);
        if(found>=0)relative=found+offset;
      }
      const anchor=Math.max(this.block.from,Math.min(this.block.to,this.block.from+Math.max(0,relative)));
      event.preventDefault();
      view.dispatch({selection:{anchor},effects:focusChanged.of(true)});
      view.focus();
    });
    // A plain click edits links; Ctrl+click follows them.
    dom.addEventListener('click',event=>{if(event.target.closest('a'))event.preventDefault();});
    return dom;
  }
  ignoreEvent() {return true;}
}

function liveBlocks(onPaperLink) {
  const cache=new Map();
  function parse(state) {
    const source=state.doc.toString(),tokens=markdownBlocks(source);let offset=0;
    const links=JSON.stringify(tokens.links || {});
    return tokens.map(token=>{
      const from=source.indexOf(token.raw,offset);
      if(from<0 || !token.raw.length)return null;
      offset=from+token.raw.length;const raw=token.raw;
      const key=links+'\n'+token.raw;
      let html=cache.get(key);
      if(html===undefined){html=sanitize(renderMarkdownBlock(token,tokens.links));cache.set(key,html);if(cache.size>256)cache.delete(cache.keys().next().value);}
      return {from,to:from+raw.length,raw,html,type:token.type,depth:token.depth};
    }).filter(Boolean);
  }
  function decorate(state,blocks,focused) {
    const ranges=[];
    for(const block of blocks) {
      const active=focused && state.selection.ranges.some(r=>r.from<=block.to && r.to>=block.from);
      if(!active)ranges.push(Decoration.replace({widget:new RenderedBlock(block,onPaperLink),block:true}).range(block.from,block.to));
      else {
        const first=state.doc.lineAt(block.from).number,last=state.doc.lineAt(block.to).number;
        for(let n=first;n<=last;n++)ranges.push(Decoration.line({class:'cm-md-active'+(block.type==='heading'?' cm-md-heading cm-md-h'+block.depth:'')+(block.type==='code'?' cm-md-code':'')}).range(state.doc.line(n).from));
      }
    }
    return Decoration.set(ranges,true);
  }
  return StateField.define({
    create(state){const blocks=parse(state);return {blocks,focused:false,decorations:decorate(state,blocks,false)};},
    update(value,tr){
      let focused=value.focused;
      for(const effect of tr.effects)if(effect.is(focusChanged))focused=effect.value;
      if(!tr.docChanged && !tr.selection && focused===value.focused)return value;
      const blocks=tr.docChanged?parse(tr.state):value.blocks;
      return {blocks,focused,decorations:decorate(tr.state,blocks,focused)};
    },
    provide:field=>EditorView.decorations.from(field,value=>value.decorations)
  });
}

function wrap(view,before,after='') {
  const {from,to}=view.state.selection.main;
  const selected=view.state.sliceDoc(from,to) || (after?'文字':'');
  view.dispatch({changes:{from,to,insert:before+selected+after},selection:{anchor:from+before.length,head:from+before.length+selected.length},effects:focusChanged.of(true),userEvent:'input'});
  view.focus();return true;
}
const LiveMarkdownEditor=forwardRef(function LiveMarkdownEditor({value,onChange,onCompositionChange,onPaperLink,placeholder},ref) {
  const parent=useRef(null),editor=useRef(null),callbacks=useRef({onChange,onCompositionChange,onPaperLink});
  callbacks.current={onChange,onCompositionChange,onPaperLink};
  useImperativeHandle(ref,()=>({insertMarkdown:(before,after)=>editor.current&&wrap(editor.current,before,after),focus:()=>editor.current?.focus()}),[]);
  useEffect(()=>{
    const view=new EditorView({parent:parent.current,state:EditorState.create({doc:normalize(value),extensions:[
      history(),markdown({base:markdownLanguage,completeHTMLTags:false}),EditorView.lineWrapping,
      keymap.of([{key:'Mod-b',run:view=>wrap(view,'**','**')},{key:'Mod-i',run:view=>wrap(view,'*','*')},...defaultKeymap,...historyKeymap,indentWithTab]),
      syntaxHighlighting(HighlightStyle.define([
        {tag:tags.heading,fontWeight:'600',color:'#e3ccec'},
        {tag:tags.strong,fontWeight:'700'}, {tag:tags.emphasis,fontStyle:'italic'},
        {tag:tags.strikethrough,textDecoration:'line-through'},
        {tag:[tags.monospace,tags.processingInstruction],fontFamily:'Consolas, monospace',color:'#d6b9e8'},
        {tag:[tags.link,tags.url],color:'#c49ee9'}, {tag:tags.contentSeparator,color:'#806a90'}
      ])),
      liveBlocks(id=>callbacks.current.onPaperLink?.(id)),
      editorPlaceholder(placeholder),
      EditorView.contentAttributes.of({'aria-label':'Markdown 笔记编辑器','aria-multiline':'true',spellcheck:'false'}),
      EditorView.domEventHandlers({
        focus:(_e,view)=>{view.dispatch({effects:focusChanged.of(true)});},
        blur:(_e,view)=>{view.dispatch({effects:focusChanged.of(false)});},
        compositionstart:()=>callbacks.current.onCompositionChange?.(true),
        compositionend:()=>callbacks.current.onCompositionChange?.(false)
      }),
      EditorView.updateListener.of(update=>{if(update.docChanged && !update.transactions.every(tr=>tr.annotation(externalChange)))callbacks.current.onChange(update.state.doc.toString());}),
      EditorView.theme({'&':{height:'100%'},'.cm-scroller':{overflow:'auto'},'&.cm-focused':{outline:'none'},'.cm-content':{minHeight:'100%',padding:'20px 24px'},'.cm-line':{padding:'0',lineHeight:'1.95'},'.cm-cursor':{borderLeftColor:'#e4c8fa'},'.cm-selectionBackground, &.cm-focused .cm-selectionBackground, ::selection':{background:'#65487b88'}})
    ]})});
    editor.current=view;
    return ()=>{editor.current=null;view.destroy();};
  },[]);
  useEffect(()=>{
    const view=editor.current,next=normalize(value);
    if(view && view.state.doc.toString()!==next)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:next},annotations:[externalChange.of(true),Transaction.addToHistory.of(false)]});
  },[value]);
  return <div className="live-markdown-editor" ref={parent} />;
});
export default LiveMarkdownEditor;
