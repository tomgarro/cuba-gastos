// Simula el capability `db` (documentos, merge anidado, arrays reemplazan, onSnapshot) para probar el camino de datos compartidos.
const { chromium } = require('playwright');
const assert = require('assert');
const MOCK = `
(function(){
  const store = new Map(); const subs = [];
  const clone = x => JSON.parse(JSON.stringify(x));
  const merge = (a, b) => { const o = Object.assign({}, a); for (const k in b) { if (b[k] && typeof b[k]==='object' && !Array.isArray(b[k]) && o[k] && typeof o[k]==='object' && !Array.isArray(o[k])) o[k]=merge(o[k], b[k]); else o[k]=clone(b[k]); } return o; };
  const parent = p => p.split('/').slice(0,-1).join('/');
  const snapDoc = p => ({ id: p.split('/').pop(), exists: store.has(p), data: () => store.has(p)? clone(store.get(p)) : undefined, metadata:{fromCache:false,hasPendingWrites:false} });
  const notify = () => setTimeout(() => subs.forEach(s => s.fire()), 0);
  const docRef = p => ({ path:p, id:p.split('/').pop(),
    get: async () => snapDoc(p),
    set: async d => { window.__writes.push(['set',p]); store.set(p, clone(d)); notify(); },
    update: async d => { window.__writes.push(['update',p]); if(!store.has(p)){ const e=new Error('nf'); e.code='invalid_argument'; throw e; } store.set(p, merge(store.get(p), d)); notify(); },
    delete: async () => { store.delete(p); notify(); },
    onSnapshot: (next) => { const s={fire:()=>next(snapDoc(p))}; subs.push(s); setTimeout(s.fire,0); return ()=>{} } });
  const colRef = c => ({ path:c, doc:id=>docRef(c+'/'+id),
    onSnapshot: (next) => { const fire=()=>{ const docs=[...store.keys()].filter(k=>parent(k)===c).sort().map(snapDoc); next({docs,size:docs.length,empty:!docs.length,metadata:{fromCache:false}}) }; const s={fire}; subs.push(s); setTimeout(fire,0); return ()=>{} } });
  window.__writes=[]; window.__store=store;
  window.claude = { use: async n => n==='db' ? { doc: docRef, collection: colRef } : n==='user' ? { id: async()=> 'u1', can: ()=>true, isOwner:()=>true, canEdit:()=>true } : null };
})();`;
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
  await ctx.addInitScript(MOCK);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', e => errs.push(e.message));
  await p.route(/fonts\.(googleapis|gstatic)/, r => r.abort());
  await p.goto(require('url').pathToFileURL(require('path').resolve(__dirname, '..', 'index.html')).href);
  await p.waitForSelector('text=Soy Cuba');
  await p.click('[data-act=ob][data-v="1"]');
  await p.fill('[data-i="0"]', 'Tomi'); await p.fill('[data-i="1"]', 'Pau');
  await p.click('[data-act=ob][data-v="2"]'); await p.click('[data-act=obfinish][data-i="1"]');
  await p.waitForSelector('text=Todavía no hay gastos');
  // somos Pau
  assert.ok((await p.locator('.chip').innerText()).startsWith('Pau'));
  const me = await p.evaluate(() => window.__store.get('data/users/u1/me'));
  assert.ok(me && me.memberId);
  // dos gastos el mismo mes: no deben pisarse (merge anidado)
  for (const [d, a] of [['Luz', '8000'], ['Gas', '4000']]) {
    await p.click('.fab'); await p.fill('#fdesc', d); await p.fill('[data-in=amount]', a); await p.click('[data-act=save]'); await p.waitForTimeout(250);
  }
  const month = await p.evaluate(() => { const k=[...window.__store.keys()].filter(x=>x.startsWith('ledger/')); return k.map(x=>[x, Object.keys(window.__store.get(x).entries).length]); });
  assert.strictEqual(month.length, 1); assert.strictEqual(month[0][1], 2);
  const w = await p.evaluate(() => window.__writes.map(x=>x.join(' ')));
  assert.ok(w.includes('set ledger/' + month[0][0].split('/')[1]) && w.includes('update ledger/' + month[0][0].split('/')[1]), w.join(' | '));
  // editar cambiando de división igual -> exacta no deja claves viejas (arrays reemplazan)
  await p.click('.nav [data-v=gastos]'); await p.locator('.item', { hasText: 'Luz' }).click(); await p.click('[data-act=edit]');
  await p.locator('input[type=checkbox]').nth(1).uncheck(); await p.waitForTimeout(100);
  await p.click('[data-act=save]'); await p.waitForTimeout(300);
  const luz = await p.evaluate(() => { const e=Object.values([...window.__store.entries()].find(([k])=>k.startsWith('ledger/'))[1].entries).find(x=>x.desc==='Luz'); return e.sp; });
  assert.strictEqual(luz.length, 1); assert.strictEqual(luz[0][1], 800000);
  // el otro viewer escribe directo en la base -> la UI lo refleja en vivo
  await p.evaluate(() => { const k=[...window.__store.keys()].find(x=>x.startsWith('ledger/')); const d=window.__store.get(k); const g=window.__store.get('meta/group'); const t=g.members[0].id, pa=g.members[1].id; d.entries.zz={id:'zz',type:'expense',desc:'Compra remota',cents:100000,cur:'ARS',date:Object.values(d.entries)[0].date,paidBy:t,sp:[[t,50000],[pa,50000]],cat:'otros'}; window.__store.set(k,d); window.claude.use('db').then(db=>db.doc('meta/group').update({})); });
  await p.waitForTimeout(300);
  await p.click('.nav [data-v=gastos]');
  assert.ok((await p.locator('#list').innerText()).includes('Compra remota'));
  assert.deepStrictEqual(errs, [], errs.join('\n'));
  console.log('E2E DB OK');
  await b.close();
})().catch(e => { console.error('E2E DB FAIL:', e.message); process.exit(1); });
