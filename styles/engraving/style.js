// Copperplate engraving: hatching patterns for the three tones.
const ns = 'http://www.w3.org/2000/svg';
const svg = document.createElementNS(ns, 'svg');
svg.setAttribute('width', '0'); svg.setAttribute('height', '0'); svg.style.position = 'absolute';
svg.innerHTML = `<defs>
  <pattern id="engr-light" width="14" height="14" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
    <line x1="0" y1="0" x2="0" y2="14" stroke="#1f1a14" stroke-width="1.6"/></pattern>
  <pattern id="engr-hatch" width="9" height="9" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
    <line x1="0" y1="0" x2="0" y2="9" stroke="#1f1a14" stroke-width="2.6"/></pattern>
  <pattern id="engr-cross" width="8" height="8" patternUnits="userSpaceOnUse" patternTransform="rotate(-35)">
    <line x1="0" y1="0" x2="0" y2="8" stroke="#1f1a14" stroke-width="2.8"/><line x1="0" y1="0" x2="8" y2="0" stroke="#1f1a14" stroke-width="2"/></pattern>
</defs>`;
document.body.prepend(svg);
