// Risograph: a halftone dot pattern for .fill-c (the yellow plate, printed as dots).
const ns = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(ns, 'svg');
svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
svg.innerHTML = `<defs><pattern id="riso-dots" width="16" height="16" patternUnits="userSpaceOnUse" patternTransform="rotate(22)">
  <circle cx="8" cy="8" r="5.2" fill="#ffd400"/></pattern></defs>`;
document.body.prepend(svg);
