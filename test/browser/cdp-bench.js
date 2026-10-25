#!/usr/bin/env node
// Drive a headless Chromium-based browser over CDP to run test/browser/bench.html.
//   node test/browser/cdp-bench.js URL [--port 9333]
// Start the browser first, e.g.:
//   flatpak run com.brave.Browser --headless=new --remote-debugging-port=9333 about:blank
const url = process.argv[2];
const port = process.argv.includes('--port') ? process.argv[process.argv.indexOf('--port') + 1] : '9333';
const targets = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
const page = targets.find(t => t.type === 'page');
const ws = new WebSocket(page.webSocketDebuggerUrl);
await new Promise(r => ws.addEventListener('open', r, { once: true }));
let id = 0;
const pending = new Map();
ws.addEventListener('message', ev => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled') console.log('[console]', msg.params.args.map(a => a.value ?? a.description).join(' '));
  if (msg.method === 'Runtime.exceptionThrown') console.log('[exception]', msg.params.exceptionDetails.exception?.description);
});
const send = (method, params = {}) => new Promise(r => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
await send('Runtime.enable');
await send('Page.navigate', { url });
for (let i = 0; i < 600; i++) {
  await new Promise(r => setTimeout(r, 500));
  const r = await send('Runtime.evaluate', { expression: 'JSON.stringify(window.benchResult ?? null)', returnByValue: true });
  const v = JSON.parse(r.result?.result?.value ?? 'null');
  if (v) { console.log(JSON.stringify(v, null, 2)); ws.close(); process.exit(v.error ? 1 : 0); }
}
console.log('timeout'); process.exit(1);
