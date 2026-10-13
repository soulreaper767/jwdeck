// Tiny safe arithmetic evaluator for head / line formulas.
// Grammar: expr = term (('+'|'-') term)* ; term = unary (('*'|'/') unary)* ;
//          unary = '-' unary | primary ; primary = number | CODE | '(' expr ')'
// CODE = [A-Za-z_][A-Za-z0-9_.]*. Division by zero yields null. Missing codes count as 0.

function tokenize(src) {
  const tokens = [];
  const re = /\s*(?:(\d+(?:\.\d+)?)|([A-Za-z_][A-Za-z0-9_.]*)|([+\-*/()]))/y;
  let i = 0;
  const s = String(src || '').trim();
  while (i < s.length) {
    re.lastIndex = i;
    const m = re.exec(s);
    if (!m) throw new Error(`Invalid formula near "${s.slice(i, i + 10)}"`);
    if (m[1] !== undefined) tokens.push({ t: 'num', v: parseFloat(m[1]) });
    else if (m[2] !== undefined) tokens.push({ t: 'id', v: m[2] });
    else tokens.push({ t: 'op', v: m[3] });
    i = re.lastIndex;
    while (i < s.length && /\s/.test(s[i])) i++;
  }
  return tokens;
}

export function parse(src) {
  const tokens = tokenize(src);
  let p = 0;
  const peek = () => tokens[p];
  const eat = (v) => {
    const t = tokens[p];
    if (!t || (v && t.v !== v)) throw new Error(`Expected "${v || 'value'}" in formula`);
    p++;
    return t;
  };
  function expr() {
    let n = term();
    while (peek() && (peek().v === '+' || peek().v === '-')) n = { op: eat().v, a: n, b: term() };
    return n;
  }
  function term() {
    let n = unary();
    while (peek() && (peek().v === '*' || peek().v === '/')) n = { op: eat().v, a: n, b: unary() };
    return n;
  }
  function unary() {
    if (peek() && peek().v === '-') { eat('-'); return { op: 'neg', a: unary() }; }
    return primary();
  }
  function primary() {
    const t = peek();
    if (!t) throw new Error('Unexpected end of formula');
    if (t.t === 'num') { p++; return { num: t.v }; }
    if (t.t === 'id') { p++; return { id: t.v }; }
    if (t.v === '(') { eat('('); const n = expr(); eat(')'); return n; }
    throw new Error(`Unexpected "${t.v}" in formula`);
  }
  if (!tokens.length) throw new Error('Empty formula');
  const ast = expr();
  if (p < tokens.length) throw new Error(`Unexpected "${tokens[p].v}" in formula`);
  return ast;
}

export function refs(src) {
  return [...new Set(tokenize(src).filter((t) => t.t === 'id').map((t) => t.v))];
}

export function evaluate(ast, lookup) {
  if ('num' in ast) return ast.num;
  if ('id' in ast) { const v = lookup(ast.id); return v == null ? 0 : v; }
  if (ast.op === 'neg') { const a = evaluate(ast.a, lookup); return a == null ? null : -a; }
  const a = evaluate(ast.a, lookup);
  const b = evaluate(ast.b, lookup);
  if (a == null || b == null) return null;
  switch (ast.op) {
    case '+': return a + b;
    case '-': return a - b;
    case '*': return a * b;
    case '/': return b === 0 ? null : a / b;
  }
  return null;
}

export function validate(src, knownCodes) {
  parse(src);
  const unknown = refs(src).filter((c) => !knownCodes.has(c));
  if (unknown.length) throw new Error(`Unknown code(s) in formula: ${unknown.join(', ')}`);
}
