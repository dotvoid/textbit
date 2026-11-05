import type { PluginInitFunction } from '../../lib/types'

const Bold: PluginInitFunction = () => {
  return {
    class: 'leaf',
    name: 'core/bold',
    actions: [{
      name: 'toggle-bold',
      title: 'Bold',
      tool: () => <div style={{ fontWeight: 'bold' }}>B</div>,
      hotkey: 'mod+b',
      handler: () => true
    }],
    getStyle: () => {
      return {
        fontWeight: 'bold'
      }
    }
  }
}

const Italic: PluginInitFunction = () => {
  return {
    class: 'leaf',
    name: 'core/italic',
    actions: [{
      name: 'toggle-italic',
      title: 'Italic',
      tool: () => <div style={{ fontStyle: 'italic' }}>I</div>,
      hotkey: 'mod+i',
      handler: () => true
    }],
    getStyle: () => {
      return {
        fontStyle: 'italic'
      }
    }
  }
}

const Underline: PluginInitFunction = () => {
  return {
    class: 'leaf',
    name: 'core/underline',
    actions: [{
      name: 'toggle-underline',
      title: 'Underline',
      hotkey: 'mod+u',
      tool: () => <div style={{ textDecoration: 'underline' }}>U</div>,
      handler: () => true
    }],
    getStyle: () => {
      return {
        textDecoration: 'underline'
      }
    }
  }
}

export {
  Bold,
  Italic,
  Underline
}
