// DOM builders. Every untrusted string goes through textContent; there is no
// innerHTML / insertAdjacentHTML anywhere in this app. `doc` is injected so the
// same code can be exercised by tests with a minimal fake DOM.
import { safeExternalUrl } from './lib.js';
import { SOURCES, STRINGS, t } from './i18n.js';

export function el(doc, tag, { text, cls, attrs } = {}) {
  const node = doc.createElement(tag);
  if (cls) node.className = cls;
  if (text !== undefined) node.textContent = String(text ?? '');
  if (attrs) for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** External link, or null when the URL is not an allowlisted https URL. */
export function makeLink(doc, url, label) {
  const safe = safeExternalUrl(url);
  if (!safe) return null;
  return el(doc, 'a', {
    text: label,
    attrs: { href: safe, target: '_blank', rel: 'noopener noreferrer', referrerpolicy: 'no-referrer' }
  });
}

export function showMessage(doc, container, message, type = 'info') {
  container.replaceChildren();
  container.className = `result ${type}`;
  container.append(el(doc, 'p', { text: message }));
}

export function renderEmailBreaches(doc, container, { title, note, names, foot, linkLabel }) {
  container.replaceChildren();
  container.className = 'result warning';
  const list = el(doc, 'ul');
  for (const name of names) list.append(el(doc, 'li', { text: name }));
  const nodes = [el(doc, 'h3', { text: title }), el(doc, 'p', { text: note }), list, el(doc, 'p', { text: foot })];
  const link = makeLink(doc, 'https://xposedornot.com/', linkLabel);
  if (link) nodes.push(link);
  container.append(...nodes);
}

export function renderSources(doc, container, lang) {
  container.replaceChildren();
  for (const s of SOURCES) {
    const card = el(doc, 'article', { cls: 'source' });
    const top = el(doc, 'div', { cls: 'source-top' });
    top.append(
      el(doc, 'b', { text: t(lang, s.n) }),
      el(doc, 'span', { cls: `source-badge ${s.integrated ? 'integrated' : 'manual'}`, text: t(lang, s.integrated ? 'badgeIntegrated' : 'badgeManual') })
    );
    card.append(top, el(doc, 'small', { text: t(lang, s.k) }), el(doc, 'p', { text: t(lang, s.b) }));
    const link = makeLink(doc, s.url, t(lang, 'srcOpen'));
    if (link) card.append(link);
    container.append(card);
  }
}

export function renderLearn(doc, container, lang) {
  container.replaceChildren();
  const items = (STRINGS[lang] ?? STRINGS.en).learn;
  for (const [title, body] of items) {
    const d = el(doc, 'details', { cls: 'learn-item' });
    d.append(el(doc, 'summary', { text: title }), el(doc, 'p', { text: body }));
    container.append(d);
  }
}
