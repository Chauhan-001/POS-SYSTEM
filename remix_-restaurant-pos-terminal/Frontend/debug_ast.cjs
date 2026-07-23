const ts = require('typescript');
const fs = require('fs');

const fileName = 'src/App.tsx';
const code = fs.readFileSync(fileName, 'utf8');

const sourceFile = ts.createSourceFile(fileName, code, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

let stack = [];

function visit(n) {
  if (n.kind === ts.SyntaxKind.JsxOpeningElement) {
    const name = n.tagName.getText(sourceFile);
    const pos = sourceFile.getLineAndCharacterOfPosition(n.getFullStart(sourceFile));
    stack.push({ name, line: pos.line + 1 });
  }
  if (n.kind === ts.SyntaxKind.JsxClosingElement) {
    const pos = sourceFile.getLineAndCharacterOfPosition(n.getFullStart(sourceFile));
    const line = pos.line + 1;
    const name = n.tagName.getText(sourceFile);
    if (stack.length > 0 && stack[stack.length - 1].name === name) {
      stack.pop();
    } else {
      const expected = stack.length > 0 ? stack[stack.length - 1].name : 'empty';
      console.log(`MISMATCH Line ${line}: </${name}>, expected </${expected}>, depth ${stack.length}`);
      console.log(`  Stack: [${stack.map(x => x.name + '@' + x.line).join(', ')}]`);
    }
  }
  if (n.kind === ts.SyntaxKind.JsxOpeningFragment) {
    stack.push({ name: 'Fragment', line: 0 });
  }
  if (n.kind === ts.SyntaxKind.JsxClosingFragment) {
    if (stack.length > 0 && stack[stack.length - 1].name === 'Fragment') {
      stack.pop();
    } else {
      const pos = sourceFile.getLineAndCharacterOfPosition(n.getFullStart(sourceFile));
      const expected = stack.length > 0 ? stack[stack.length - 1].name : 'empty';
      console.log(`MISMATCH Line ${pos.line + 1}: </>, expected </${expected}>, depth ${stack.length}`);
      console.log(`  Stack: [${stack.map(x => x.name + '@' + x.line).join(', ')}]`);
    }
  }
  
  ts.forEachChild(n, visit);
}

visit(sourceFile);
