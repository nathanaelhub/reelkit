// Terminal: a dot screen for .fill-c.
const ns = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(ns, 'svg');
svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
svg.innerHTML = `<defs><pattern id="crt-dots" width="12" height="12" patternUnits="userSpaceOnUse">
  <rect x="4" y="4" width="4" height="4" fill="#1f9e48"/></pattern></defs>`;
document.body.prepend(svg);
