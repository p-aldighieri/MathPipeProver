#!/usr/bin/env node
/**
 * cdp_audit_chat_sources.mjs — report which files and tools a finished chat used.
 *
 * Why: in the 2026-09 UI a Pro chat inside a project can call an account-wide
 * file tool (`api_tool` → /files/list, /files/search, /files/read) that
 * reaches EVERY file ever uploaded to the account — other projects' sources
 * and attachments included. For a clean-slate run that is contamination, and
 * nothing in the chat UI shows it. This script reads the chat's conversation
 * record and lists the tool calls, the files read, and the files that search
 * results surfaced, so the orchestrator can verify a role stayed inside its
 * allowed inputs.
 *
 * Usage:
 *   node cdp_audit_chat_sources.mjs --chat-url URL [--port PORT]
 *     [--allow "name1.md,name2.pdf,..."] [--json]
 *
 * --allow   file names the role may read (project sources + attachments).
 *           Names match after stripping ChatGPT's " (n)" / "(n)" duplicate
 *           suffixes. Without --allow every library read is reported.
 *
 * Exit codes: 0 no disallowed reads; 5 the chat read files outside --allow;
 *             1 transport/auth error.
 *
 * How it reads the record: inside the logged-in chatgpt.com tab it requests
 * the conversation JSON the web app itself loads (same-origin, using the
 * page's own session). Only tool names, resource paths and file names leave
 * the page; the session token is never returned, printed or stored.
 */
import { attachCDP } from './lib/browser.mjs';
import { extractChatId } from './lib/poll.mjs';

const args = process.argv.slice(2);
let chatUrl = '', port = 9222, allow = [], asJson = false;
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--chat-url') chatUrl = args[++i];
  else if (args[i] === '--port') port = parseInt(args[++i], 10);
  else if (args[i] === '--allow') allow = args[++i].split(',').map((s) => s.trim()).filter(Boolean);
  else if (args[i] === '--json') asJson = true;
}
const chatId = extractChatId(chatUrl);
if (!chatId) { console.error('Need --chat-url with a /c/<id> chat URL'); process.exit(1); }

const normalize = (name) => name.trim().replace(/\s*\(\d+\)(?=\.[A-Za-z0-9]+$)/, '').toLowerCase();
const allowed = new Set(allow.map(normalize));

let close = async () => {};
try {
  const att = await attachCDP({ port });
  close = att.close;
  const page = att.context.pages().find((p) => p.url().startsWith('https://chatgpt.com')) || await att.context.newPage();
  if (!page.url().startsWith('https://chatgpt.com')) {
    await page.goto('https://chatgpt.com/', { waitUntil: 'domcontentloaded' });
  }
  const record = await page.evaluate(async (id) => {
    const session = await fetch('/api/auth/session', { credentials: 'include' }).then((r) => r.json());
    const res = await fetch(`/backend-api/conversation/${id}`, {
      headers: { Authorization: `Bearer ${session.accessToken}` }, credentials: 'include',
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const convo = await res.json();
    const fileNames = (text) => [...new Set((text.match(/[\w .,()'&+-]{2,100}\.(md|pdf|tex|txt|docx|lean|py|json|csv)/gi) || [])
      .map((s) => s.trim()))];
    const msgs = Object.values(convo.mapping || {}).filter((n) => n.message).map((n) => n.message);
    const tools = {};
    const reads = [];
    const surfaced = new Set();
    const webDomains = new Set();
    for (const m of msgs) {
      const name = m.author?.name || '';
      if (m.author?.role === 'assistant' && m.recipient && m.recipient !== 'all') {
        tools[m.recipient] = (tools[m.recipient] || 0) + 1;
      }
      if (name === 'api_tool.call_tool') {
        const uri = String(m.metadata?.invoked_resource?.resource_uri || '').replace(/[?#].*/, '');
        const kind = uri.replace(/^.*\/files\//, 'files/');
        tools[kind] = (tools[kind] || 0) + 1;
        const parts = m.content?.parts || [];
        const text = parts.map((p) => (typeof p === 'string' ? p : (p && (p.text || JSON.stringify(p))))).join(' ');
        if (/files\/read/.test(kind)) reads.push(...fileNames(text));
        else for (const f of fileNames(text)) surfaced.add(f);
      }
      for (const g of (m.metadata?.search_result_groups || [])) if (g.domain) webDomains.add(g.domain);
    }
    return { tools, reads: [...new Set(reads)], surfaced: [...surfaced], webDomains: [...webDomains] };
  }, chatId);
  if (record.error) throw new Error(record.error);

  const disallowedReads = record.reads.filter((f) => !allowed.has(normalize(f)));
  const report = { chat: chatId, ...record, disallowedReads };
  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`Tool calls: ${JSON.stringify(record.tools)}`);
    console.log(`Files read: ${record.reads.join(' | ') || '(none)'}`);
    console.log(`Files surfaced by search: ${record.surfaced.join(' | ') || '(none)'}`);
    console.log(`Web domains: ${record.webDomains.join(', ') || '(none)'}`);
    console.log(disallowedReads.length
      ? `DISALLOWED READS: ${disallowedReads.join(' | ')}`
      : 'No reads outside the allowed inputs.');
  }
  await close();
  process.exit(disallowedReads.length ? 5 : 0);
} catch (e) {
  console.error(`ERROR: ${e.message}`);
  await close();
  process.exit(1);
}
