// gl-transitions (MIT / BSD, https://github.com/gl-transitions/gl-transitions): look up a transition by name.
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
let all = null;
export function glTransitions() { return all || (all = require('gl-transitions/gl-transitions.json')); }
export function glTransition(name) {
  const t = glTransitions().find(t => t.name.toLowerCase() === String(name).toLowerCase());
  if (!t) throw new Error(`unknown gl transition "${name}"`);
  return t;
}
// closest names, for error messages
export function suggest(name) {
  const n = String(name).toLowerCase();
  return glTransitions().map(t => t.name).filter(x => x.toLowerCase().includes(n.slice(0, 4)) || n.includes(x.toLowerCase().slice(0, 4))).slice(0, 6);
}
