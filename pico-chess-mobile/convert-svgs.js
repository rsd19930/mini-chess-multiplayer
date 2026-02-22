const fs = require('fs');
const path = require('path');

const piecesDir = path.join(__dirname, 'assets', 'pieces');
const outDir = path.join(__dirname, 'src', 'components', 'pieces');

if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

const files = fs.readdirSync(piecesDir).filter(f => f.endsWith('.svg'));

for (const file of files) {
  const name = file.replace('.svg', '').replace(' ', ''); // e.g. "King White" -> "KingWhite"
  let content = fs.readFileSync(path.join(piecesDir, file), 'utf8');

  // We must preserve the native viewBox coordinates, but enforce 100% width/height
  content = content
    .replace(/<\?xml.*?\?>/g, '') // Strip XML declarations
    .replace(/<svg\s+.*?viewBox="([^"]+)".*?>/, '<Svg width="100%" height="100%" viewBox="$1">')
    .replace(/<\/svg>/, '</Svg>')
    .replace(/<path/g, '<Path')
    .replace(/<\/path>/g, '</Path>')
    .replace(/<g/g, '<G')
    .replace(/<\/g>/g, '</G>')
    .replace(/<circle/g, '<Circle')
    .replace(/<\/circle>/g, '</Circle>')
    .replace(/<defs/g, '<Defs')
    .replace(/<\/defs>/g, '</Defs>')
    .replace(/<radialGradient/g, '<RadialGradient')
    .replace(/<\/radialGradient>/g, '</RadialGradient>')
    .replace(/<linearGradient/g, '<LinearGradient')
    .replace(/<\/linearGradient>/g, '</LinearGradient>')
    .replace(/<clipPath/g, '<ClipPath')
    .replace(/<\/clipPath>/g, '</ClipPath>')
    .replace(/<mask/g, '<Mask')
    .replace(/<\/mask>/g, '</Mask>')
    .replace(/<rect/g, '<Rect')
    .replace(/<\/rect>/g, '</Rect>')
    .replace(/<stop/g, '<Stop')
    .replace(/<\/stop>/g, '</Stop>')
    .replace(/fill-rule/g, 'fillRule')
    .replace(/clip-rule/g, 'clipRule')
    .replace(/fill-opacity/g, 'fillOpacity')
    .replace(/stroke-width/g, 'strokeWidth')
    .replace(/stroke-linecap/g, 'strokeLinecap')
    .replace(/stroke-linejoin/g, 'strokeLinejoin')
    .replace(/stroke-miterlimit/g, 'strokeMiterlimit')
    .replace(/stroke-dasharray/g, 'strokeDasharray')
    .replace(/stroke-dashoffset/g, 'strokeDashoffset')
    .replace(/clip-path/g, 'clipPath');

  const component = `
import React from 'react';
import Svg, { Path, G, Circle, Defs, RadialGradient, LinearGradient, Stop, Rect, ClipPath, Mask } from 'react-native-svg';

export const ${name}: React.FC = () => {
  return (
    ${content}
  );
};
`;

  fs.writeFileSync(path.join(outDir, `${name}.tsx`), component.trim());
  console.log(`Generated ${name}.tsx`);
}

// Generate the hardcoded 6x6 board background SVG from the new layout file
const boardSvgPath = path.join(__dirname, 'assets', 'chessboard_6x6.svg');
let boardContent = fs.readFileSync(boardSvgPath, 'utf8');

boardContent = boardContent
  .replace(/<\?xml.*?\?>/g, '') // Strip XML declarations
  .replace(/<svg.*?>/, '<Svg width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 600 600">')
  .replace(/<\/svg>/, '</Svg>')
  .replace(/<path/g, '<Path')
  .replace(/<\/path>/g, '</Path>')
  .replace(/<g/g, '<G')
  .replace(/<\/g>/g, '</G>')
  .replace(/<circle/g, '<Circle')
  .replace(/<\/circle>/g, '</Circle>')
  .replace(/<defs/g, '<Defs')
  .replace(/<\/defs>/g, '</Defs>')
  .replace(/<radialGradient/g, '<RadialGradient')
  .replace(/<\/radialGradient>/g, '</RadialGradient>')
  .replace(/<linearGradient/g, '<LinearGradient')
  .replace(/<\/linearGradient>/g, '</LinearGradient>')
  .replace(/<clipPath/g, '<ClipPath')
  .replace(/<\/clipPath>/g, '</ClipPath>')
  .replace(/<mask/g, '<Mask')
  .replace(/<\/mask>/g, '</Mask>')
  .replace(/<rect/g, '<Rect')
  .replace(/<\/rect>/g, '</Rect>')
  .replace(/<stop/g, '<Stop')
  .replace(/<\/stop>/g, '</Stop>')
  .replace(/fill-rule/g, 'fillRule')
  .replace(/clip-rule/g, 'clipRule')
  .replace(/fill-opacity/g, 'fillOpacity')
  .replace(/stroke-width/g, 'strokeWidth')
  .replace(/stroke-linecap/g, 'strokeLinecap')
  .replace(/stroke-linejoin/g, 'strokeLinejoin')
  .replace(/stroke-miterlimit/g, 'strokeMiterlimit')
  .replace(/stroke-dasharray/g, 'strokeDasharray')
  .replace(/stroke-dashoffset/g, 'strokeDashoffset')
  .replace(/clip-path/g, 'clipPath');

const boardComponent = `
import React from 'react';
import Svg, { Path, G, Circle, Defs, RadialGradient, LinearGradient, Stop, Rect, ClipPath, Mask } from 'react-native-svg';

export const BoardBackground: React.FC = () => {
  return (
    ${boardContent}
  );
};
`;
fs.writeFileSync(path.join(outDir, 'BoardBackground.tsx'), boardComponent.trim());
console.log('Generated BoardBackground.tsx');
