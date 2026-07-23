const ts = require('typescript');
const fs = require('fs');

const fileName = 'src/App.tsx';
const code = fs.readFileSync(fileName, 'utf8');

// Parse the file as a source file
const sourceFile = ts.createSourceFile(
  fileName,
  code,
  ts.ScriptTarget.Latest,
  true,
  ts.ScriptKind.TSX
);

// Walk AST and find JSX elements that are not closed
function findUnclosedJsx(node, depth = 0) {
  ts.forEachChild(node, child => {
    if (child.kind === ts.SyntaxKind.JsxElement) {
      // Check if it has children
      let hasChildren = false;
      ts.forEachChild(child, c => { hasChildren = true; });
      if (!hasChildren) {
        console.log(`Line ${child.getFullStart()}: JsxElement without children: ${code.substring(child.getFullStart(), child.getEnd())}`);
      }
      findUnclosedJsx(child, depth + 1);
    }
    
    if (child.kind === ts.SyntaxKind.JsxOpeningElement) {
      console.log(`Line ${child.getFullStart()}: JsxOpeningElement ${code.substring(child.getFullStart(), child.getEnd())}`);
    }
  });
}

// Let's just print diagnostics
const diagnostics = [];
const options = {
  noEmit: true,
  jsx: ts.JsxEmit.React,
};

// Re-parse with full diagnostics
const program = ts.createProgram([fileName], options, {
  getSourceFile: (name) => name === fileName ? sourceFile : undefined,
  writeFile: () => {},
  getCurrentDirectory: () => '',
  getDirectories: () => [],
  fileExists: () => true,
  readFile: () => '',
  getCanonicalFileName: (f) => f,
  useCaseSensitiveFileNames: () => true,
  getNewLine: () => '\n'
});

// Actually, let's just parse and look for JSX nodes
const allDiagnostics = ts.getPreEmitDiagnostics(program);
for (const diag of allDiagnostics) {
  if (diag.file) {
    const msg = ts.flattenDiagnosticMessageText(diag.messageText, '\n');
    console.log(`Line ${diag.file.getLineAndCharacterOfPosition(diag.start).line + 1}: ${msg}`);
  }
}

// Let's also try a different approach - just walk the AST and count JSX open/close
let openCount = 0;
let closeCount = 0;
function countJsxTags(node) {
  if (node.kind === ts.SyntaxKind.JsxOpeningElement) {
    openCount++;
  }
  if (node.kind === ts.SyntaxKind.JsxClosingElement) {
    closeCount++;
  }
  ts.forEachChild(node, countJsxTags);
}
countJsxTags(sourceFile);
console.log(`\nJSX open tags: ${openCount}, close tags: ${closeCount}`);
