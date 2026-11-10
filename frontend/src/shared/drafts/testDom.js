import { JSDOM } from 'jsdom';
import { fileURLToPath } from 'node:url';
import { createServer } from 'vite';

// Keep DOM tests on the same React instance as Vite's JSX modules, and restore
// globals because the node test runner shares its process across test files.
export async function withDraftDom(callback) {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { url: 'http://localhost/id/reservations', pretendToBeVisual: true });
  const values = { window: dom.window, document: dom.window.document, navigator: dom.window.navigator, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true };
  const previous = new Map(Object.keys(values).map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  for (const [key, value] of Object.entries(values)) Object.defineProperty(globalThis, key, { configurable: true, writable: true, value });
  dom.window.HTMLDialogElement.prototype.showModal = function () { this.open = true; };
  dom.window.HTMLDialogElement.prototype.close = function () { this.open = false; };
  dom.window.HTMLElement.prototype.scrollIntoView = function () {};
  dom.window.HTMLElement.prototype.scrollTo = function () {};
  dom.window.HTMLElement.prototype.getClientRects = function () { return this.closest('[hidden]') ? [] : [{}]; };
  const server = await createServer({ root: fileURLToPath(new URL('../../../', import.meta.url)), configFile: false, optimizeDeps: { noDiscovery: true }, server: { middlewareMode: true, hmr: false, watch: null } });
  const roots = new Set();
  try {
    const React = await import('react');
    const { createRoot } = await import('react-dom/client');
    const { act } = React;
    async function mount(element) {
      const container = document.createElement('div');
      document.body.append(container);
      const root = createRoot(container);
      roots.add(root);
      await act(async () => { root.render(element); });
      return { container, async unmount() { await act(async () => root.unmount()); roots.delete(root); container.remove(); } };
    }
    const click = async element => { if (!element) throw new Error('Missing click target'); await act(async () => element.click()); };
    const input = async (element, value) => {
      if (!element) throw new Error('Missing input target');
      const prototype = element.tagName === 'SELECT' ? dom.window.HTMLSelectElement.prototype : dom.window.HTMLInputElement.prototype;
      await act(async () => { Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value); element.dispatchEvent(new dom.window.Event(element.tagName === 'SELECT' ? 'change' : 'input', { bubbles: true })); });
    };
    await callback({ React, act, window: dom.window, document: dom.window.document, load: path => server.ssrLoadModule(path), mount, click, input });
  } finally {
    const { act } = await import('react');
    for (const root of roots) await act(async () => root.unmount());
    await server.close();
    dom.window.close();
    for (const [key, descriptor] of previous) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  }
}
