// Blueprint: a 45° hatch for .fill-c.
const ns = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(ns, 'svg');
svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
svg.innerHTML = `<defs><pattern id="bp-hatch" width="18" height="18" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
  <line x1="0" y1="0" x2="0" y2="18" stroke="#eef5ff" stroke-width="2.5" opacity=".7"/></pattern></defs>`;
document.body.prepend(svg);
