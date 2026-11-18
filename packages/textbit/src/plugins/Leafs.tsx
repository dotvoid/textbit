import type { PluginInitFunction } from '../../lib/types'

const Bold: PluginInitFunction = () => {
  return {
    class: 'leaf',
    name: 'base/bold',
    actions: [{
      name: 'toggle-bold',
      title: 'Bold',
      hotkey: 'mod+b',
      handler: () => true
    }],
    getStyle: () => {
      return {
        fontWeight: 'bold'
      }
    },
    view: {
      tools: { 'toggle-bold': () => <div style={{ fontWeight: 'bold' }}>B</div> }
    }
  }
}

const Italic: PluginInitFunction = () => {
  return {
    class: 'leaf',
    name: 'base/italic',
    actions: [{
      name: 'toggle-italic',
      title: 'Italic',
      hotkey: 'mod+i',
      handler: () => true
    }],
    getStyle: () => {
      return {
        fontStyle: 'italic'
      }
    },
    view: {
      tools: { 'toggle-italic': () => <div style={{ fontStyle: 'italic' }}>I</div> }
    }
  }
}

const Underline: PluginInitFunction = () => {
  return {
    class: 'leaf',
    name: 'base/underline',
    actions: [{
      name: 'toggle-underline',
      title: 'Underline',
      hotkey: 'mod+u',
      handler: () => true
    }],
    getStyle: () => {
      return {
        textDecoration: 'underline'
      }
    },
    view: {
      tools: { 'toggle-underline': () => <div style={{ textDecoration: 'underline' }}>U</div> }
    }
  }
}

export {
  Bold,
  Italic,
  Underline
}
