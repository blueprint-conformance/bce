import fs from 'node:fs'; import path from 'node:path'; import { builtinModules } from 'node:module'; import { pathToFileURL } from 'node:url'; const root=process.env.BCE_EVAL_WORKSPACE; const taskId=process.env.BCE_EVAL_TASK_ID; const inputTreeSha256=process.env.BCE_EVAL_INPUT_TREE_SHA256; const target="src/features/repair-summary.mjs"; const source=fs.readFileSync(path.join(root,target),'utf8'); const extractModuleSpecifiers=function extractModuleSpecifiers(source) {
  const specifiers = [];
  let computed = false;
  const quoted = (index) => {
    const quote = source[index];
    let value = '';
    for (let cursor = index + 1; cursor < source.length; cursor += 1) {
      if (source[cursor] === '\\') {
        value += source[cursor + 1] ?? '';
        cursor += 1;
      } else if (source[cursor] === quote) return { value, end: cursor + 1 };
      else value += source[cursor];
    }
    return { value, end: source.length };
  };
  const trivia = (index) => {
    let cursor = index;
    while (cursor < source.length) {
      if (/\s/.test(source[cursor])) cursor += 1;
      else if (source.startsWith('//', cursor)) {
        cursor = source.indexOf('\n', cursor + 2);
        if (cursor < 0) return source.length;
      } else if (source.startsWith('/*', cursor)) {
        const end = source.indexOf('*/', cursor + 2);
        cursor = end < 0 ? source.length : end + 2;
      } else break;
    }
    return cursor;
  };
  const word = (index) => {
    const match = /^[A-Za-z_$][A-Za-z0-9_$]*/.exec(source.slice(index));
    return match ? { value: match[0], end: index + match[0].length } : null;
  };
  const callSpecifier = (openParen) => {
    const argument = trivia(openParen + 1);
    if (source[argument] === "'" || source[argument] === '"') {
      const literal = quoted(argument);
      const closing = trivia(literal.end);
      if (source[closing] === ')') specifiers.push(literal.value);
      else computed = true;
      return closing + 1;
    }
    computed = true;
    return argument + 1;
  };
  for (let index = 0; index < source.length;) {
    index = trivia(index);
    if (index >= source.length) break;
    if (source[index] === "'" || source[index] === '"' || source[index] === '`') {
      index = quoted(index).end;
      continue;
    }
    const token = word(index);
    if (!token) {
      index += 1;
      continue;
    }
    index = token.end;
    if (token.value === 'import') {
      let cursor = trivia(index);
      if (source[cursor] === '.') continue;
      if (source[cursor] === '(') {
        index = callSpecifier(cursor);
        continue;
      }
      while (cursor < source.length && source[cursor] !== ';') {
        cursor = trivia(cursor);
        if (source[cursor] === "'" || source[cursor] === '"') {
          const literal = quoted(cursor);
          specifiers.push(literal.value);
          index = literal.end;
          break;
        }
        cursor += 1;
      }
    } else if (token.value === 'export') {
      let cursor = trivia(index);
      while (cursor < source.length && source[cursor] !== ';') {
        const next = word(cursor);
        if (next?.value === 'from') {
          const literalStart = trivia(next.end);
          if (source[literalStart] === "'" || source[literalStart] === '"') {
            const literal = quoted(literalStart);
            specifiers.push(literal.value);
            index = literal.end;
          }
          break;
        }
        if (source[cursor] === "'" || source[cursor] === '"' || source[cursor] === '`') cursor = quoted(cursor).end;
        else cursor += 1;
      }
    } else if (token.value === 'require') {
      let cursor = trivia(index);
      if (source.startsWith('.resolve', cursor)) cursor = trivia(cursor + '.resolve'.length);
      if (source[cursor] === '(') index = callSpecifier(cursor);
    }
  }
  return { specifiers, computed };
}; const parsed=extractModuleSpecifiers(source); const builtins=new Set(builtinModules.map((name)=>name.replace(/^node:/,''))); const normalize=(specifier)=>{const builtin=specifier.replace(/^node:/,''); if(builtins.has(builtin))return 'builtin:'+builtin; if(specifier.startsWith('.')){const base=path.posix.normalize(path.posix.join(path.posix.dirname(target),specifier)); const candidates=[base,base+'.mjs',base+'.js',base+'.ts',base+'/index.mjs',base+'/index.js',base+'/index.ts']; const resolved=candidates.find((candidate)=>fs.existsSync(path.join(root,candidate)))??base; return 'module:'+resolved;} return 'package:'+(specifier.startsWith('@')?specifier.split('/').slice(0,2).join('/'):specifier.split('/')[0]);}; const observed=parsed.specifiers.map(normalize); const matched=observed.includes("module:src/vendor/raw-provider.mjs"); const passed=!parsed.computed&&matched===false; process.stdout.write(JSON.stringify({schemaVersion:'1',taskId:"provider-repair",inputTreeSha256,passed,locations:passed?[]:["src/features/repair-summary.mjs#L1"]}));
