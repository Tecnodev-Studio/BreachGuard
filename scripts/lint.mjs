#!/usr/bin/env node
// Zero-dependency lint + static security-pattern scan.
// This is NOT ESLint. It enforces a small, explicit rule set so the check runs
// identically offline and in CI without installing anything.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, extname, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));

/** [id, regex, message] applied to JS sources shipped in www/. */
export const JS_RULES = [
  ['no-innerhtml', /\.(innerHTML|outerHTML)\b/, 'innerHTML/outerHTML are forbidden; use textContent and DOM APIs'],
  ['no-insert-html', /insertAdjacentHTML|createContextualFragment|DOMParser/, 'HTML-parsing APIs are forbidden'],
  ['no-document-write', /document\.write(ln)?\s*\(/, 'document.write is forbidden'],
  ['no-eval', /\beval\s*\(|new\s+Function\s*\(/, 'eval / new Function are forbidden'],
  ['no-string-timer', /set(Timeout|Interval)\s*\(\s*['"`]/, 'string timers are forbidden'],
  ['no-js-url', /javascript:/i, 'javascript: URLs are forbidden'],
  ['no-console', /\bconsole\.(log|debug|info|warn|error|trace)\b/, 'no console output in shipped code (could leak input)'],
  ['no-debugger', /\bdebugger\b/, 'debugger statement'],
  ['no-cleartext-url', /['"`]http:\/\/(?!www\.w3\.org)/, 'cleartext http:// URL'],
  ['no-wildcard-postmessage', /postMessage\([^)]*['"]\*['"]\s*\)/, 'postMessage with * target origin']
];

/** Rules for HTML files shipped in www/. */
export const HTML_RULES = [
  ['no-inline-handler', /\son[a-z]+\s*=\s*["']/i, 'inline event handler attribute'],
  ['no-inline-style', /\sstyle\s*=\s*["']/i, 'inline style attribute (blocked by CSP)'],
  ['no-inline-script', /<script(?![^>]*\ssrc=)[^>]*>\s*\S/i, 'inline <script> body (blocked by CSP)'],
  ['no-javascript-url', /(href|src|action)\s*=\s*["']\s*javascript:/i, 'javascript: URL'],
  ['no-cleartext-url', /(href|src|action)\s*=\s*["']http:\/\//i, 'cleartext http:// URL'],
  ['no-unsafe-csp', /'unsafe-(inline|eval)'|script-src[^;"]*\*/i, 'unsafe CSP directive']
];

const SECRET_RULES = [
  ['secret-private-key', /-----BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY-----/],
  ['secret-github-token', /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ['secret-aws-key', /\bAKIA[0-9A-Z]{16}\b/],
  ['secret-generic', /\b(api[_-]?key|secret|token|passwd|password)\b\s*[:=]\s*['"][A-Za-z0-9_\-]{16,}['"]/i]
];

export function scanText(kind, name, text) {
  const rules = kind === 'html' ? HTML_RULES : kind === 'js' ? JS_RULES : [];
  const findings = [];
  const lines = text.split('\n');
  for (const [id, re, msg] of rules) {
    lines.forEach((line, i) => {
      if (/^\s*(\/\/|\*|\/\*)/.test(line) && kind === 'js') return; // comments
      if (re.test(line)) findings.push({ file: name, line: i + 1, rule: id, message: msg });
    });
  }
  return findings;
}

export function scanSecrets(name, text) {
  const findings = [];
  for (const [id, re] of SECRET_RULES) {
    if (re.test(text)) findings.push({ file: name, line: 0, rule: id, message: 'possible committed secret' });
  }
  return findings;
}

export function duplicateIds(html) {
  const seen = new Set();
  const dups = [];
  for (const m of html.matchAll(/\sid="([^"]+)"/g)) {
    if (seen.has(m[1])) dups.push(m[1]); else seen.add(m[1]);
  }
  return dups;
}

function walk(dir, skip = new Set(['node_modules', '.git', 'android', 'dist'])) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (skip.has(entry)) continue;
    const p = join(dir, entry);
    const st = statSync(p);
    if (st.isDirectory()) out.push(...walk(p, skip)); else out.push(p);
  }
  return out;
}

export function lintProject(root = ROOT) {
  const findings = [];
  const files = walk(root);
  const textExt = new Set(['.js', '.mjs', '.html', '.json', '.webmanifest', '.md', '.yml', '.yaml', '.py', '.css', '.svg', '.txt']);
  for (const f of files) {
    const rel = relative(root, f);
    const ext = extname(f);
    const isText = textExt.has(ext) || rel === '_headers' || rel === '.gitignore';
    if (!isText) continue;
    const text = readFileSync(f, 'utf8');
    const shipped = rel.startsWith('www/');
    if (ext === '.js' && shipped) findings.push(...scanText('js', rel, text));
    if (ext === '.html' && shipped) {
      findings.push(...scanText('html', rel, text));
      for (const d of duplicateIds(text)) findings.push({ file: rel, line: 0, rule: 'duplicate-id', message: `duplicate id "${d}"` });
    }
    if (ext === '.json' || ext === '.webmanifest') {
      try { JSON.parse(text); } catch (e) { findings.push({ file: rel, line: 0, rule: 'invalid-json', message: e.message }); }
    }
    if (!rel.startsWith('tests/') && rel !== 'scripts/lint.mjs') findings.push(...scanSecrets(rel, text));
    if ((ext === '.js' || ext === '.mjs') && !rel.startsWith('android/')) {
      const r = spawnSync(process.execPath, ['--check', f], { encoding: 'utf8' });
      if (r.status !== 0) findings.push({ file: rel, line: 0, rule: 'syntax', message: (r.stderr || '').split('\n').slice(0, 3).join(' ') });
    }
    if (shipped && /[ \t]+$/m.test(text) && ext !== '.png') {
      findings.push({ file: rel, line: 0, rule: 'trailing-whitespace', message: 'trailing whitespace' });
    }
  }
  return findings;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const findings = lintProject();
  if (findings.length) {
    for (const f of findings) console.error(`${f.file}${f.line ? ':' + f.line : ''}  [${f.rule}]  ${f.message}`);
    console.error(`\nLint failed: ${findings.length} problem(s).`);
    process.exit(1);
  }
  console.log('Lint passed.');
}
