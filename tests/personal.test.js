// Pestaña Personal: cifrado, carga rápida, cuotas exactas, números del mes, duplicados, rarezas y calendario.
const assert = require('assert');
const P = require('../src/personal.js');
let n = 0;
async function t(name, fn) { try { await fn(); n++; console.log('ok  ' + name); } catch (e) { console.error('FAIL ' + name + '\n  ' + (e.stack || e.message)); process.exitCode = 1; } }
const HOY = '2026-11-10';

(async () => {
  await t('código de recuperación: ida y vuelta, tolera minúsculas y espacios, y detecta un error de tipeo', () => {
    const k = P.nuevaClave(), cod = P.codigoDe(k);
    assert.ok(/^([A-Z2-9]{4}-){13}[A-Z2-9]$/.test(cod), cod);
    assert.deepStrictEqual(Array.from(P.claveDeCodigo(cod)), Array.from(k));
    assert.deepStrictEqual(Array.from(P.claveDeCodigo(' ' + cod.toLowerCase().replace(/-/g, ' ') + ' ')), Array.from(k));
    const mal = cod.slice(0, 2) + (cod[2] === 'A' ? 'B' : 'A') + cod.slice(3);
    assert.strictEqual(P.claveDeCodigo(mal), null);
    assert.strictEqual(P.claveDeCodigo('hola'), null);
  });
  await t('cifra y descifra; con otra clave o un bloque tocado no devuelve nada', async () => {
    const k = P.nuevaClave(), ev = { id: 'p1', t: 'g', f: '2026-11-01', d: 'Terapia', c: 5000000, m: 'ARS', k: 'salud' };
    const blob = await P.cifrar(k, ev);
    assert.ok(!/Terapia|5000000/.test(blob) && /^[A-Za-z0-9+/=]{16,12000}$/.test(blob), 'ilegible y apto para el backend');
    assert.deepStrictEqual(await P.descifrar(k, blob), ev);
    assert.strictEqual(await P.descifrar(P.nuevaClave(), blob), null);
    const rota = blob.slice(0, 30) + (blob[30] === 'A' ? 'B' : 'A') + blob.slice(31);
    assert.strictEqual(await P.descifrar(k, rota), null);
    assert.notStrictEqual(await P.cifrar(k, ev), blob, 'cada bloque lleva su propio IV');
  });
  await t('carga rápida: monto, moneda, día y categoría', () => {
    const a = P.leer('almuerzo 4.500', HOY); assert.deepStrictEqual([a.desc, a.cents, a.cur, a.fecha, a.cuotas], ['Almuerzo', 450000, 'ARS', HOY, 0]);
    assert.strictEqual(P.leer('uber 3200,50 ayer', HOY).fecha, '2026-11-09');
    assert.strictEqual(P.leer('uber 3200 anteayer', HOY).fecha, '2026-11-08');
    const d = P.leer('netflix u$s 10', HOY); assert.deepStrictEqual([d.cents, d.cur, d.cat], [1000, 'USD', 'streaming']);
    const c = P.leer('tele 120000 en 6 cuotas', HOY); assert.deepStrictEqual([c.cents, c.cuotas, c.desc], [12000000, 6, 'Tele']);
    assert.strictEqual(P.leer('3 c', HOY), null);
    assert.strictEqual(P.leer('nada', HOY), null);
    assert.strictEqual(P.leer('mate 500 en 1 cuota', HOY).cuotas, 0);
  });
  await t('cuotas: suman exacto el total, un mes cada una y el 31 no se rompe', () => {
    for (const total of [10000, 10001, 10002, 99999, 7]) for (const nn of [2, 3, 6, 12]) {
      const l = P.armarGasto({ desc: 'X', cents: total, cur: 'ARS', cat: 'otros', fecha: '2026-01-31', cuotas: nn }, 'b');
      assert.strictEqual(l.reduce((s, g) => s + g.c, 0), total);
      assert.strictEqual(l.length, nn);
      assert.ok(Math.max(...l.map(g => g.c)) - Math.min(...l.map(g => g.c)) <= 1);
    }
    const f = P.armarGasto({ desc: 'X', cents: 300, cur: 'ARS', cat: 'otros', fecha: '2026-01-31', cuotas: 3 }, 'b').map(g => g.f);
    assert.deepStrictEqual(f, ['2026-01-31', '2026-02-28', '2026-03-31']);
    assert.deepStrictEqual(P.armarGasto({ desc: 'X', cents: 300, cur: 'ARS', cat: 'otros', fecha: HOY, cuotas: 0 }, 'z').map(g => g.id), ['z']);
  });
  await t('estado: anular, topes (el último gana) y metas con aportes', () => {
    const ev = [
      { id: 'a', t: 'g', f: '2026-11-02', d: 'Cine', c: 1000, m: 'ARS', k: 'ocio' }, { id: 'b', t: 'g', f: '2026-11-03', d: 'Cine', c: 2000, m: 'ARS', k: 'ocio' },
      { id: 'x1', t: 'x', ref: 'a' },
      { id: 'p1', t: 'p', k: 'ocio', c: 5000, m: 'ARS', ts: 1 }, { id: 'p2', t: 'p', k: 'ocio', c: 3000, m: 'ARS', ts: 2 }, { id: 'p3', t: 'p', k: 'ropa', c: 0, m: 'ARS', ts: 1 },
      { id: 'm1', t: 'm', n: 'Viaje', c: 100000, m: 'ARS' }, { id: 'a1', t: 'a', meta: 'm1', c: 20000, f: HOY }, { id: 'a2', t: 'a', meta: 'm1', c: 5000, f: HOY }, { id: 'x2', t: 'x', ref: 'a2' }
    ];
    const st = P.armar(ev);
    assert.deepStrictEqual(st.gastos.map(g => g.id), ['b']);
    assert.strictEqual(st.presup.ocio.c, 3000); assert.ok(!st.presup.ropa);
    assert.deepStrictEqual([st.metas[0].aportado, st.metas.length], [20000, 1]);
    assert.strictEqual(P.armar(P.unir(ev, ev)).gastos.length, 1, 'unir repetidos no duplica');
    assert.deepStrictEqual(P.armar([{ id: 'o1', t: 'o', ref: 'zz' }]).vistos, { zz: true });
  });
  await t('números del mes: semáforo, ritmo, cuotas que vienen y cuánto queda por día', () => {
    const ev = [].concat(
      P.armarGasto({ desc: 'Tele', cents: 6000000, cur: 'ARS', cat: 'casa', fecha: '2026-11-01', cuotas: 3 }, 't'),
      [{ id: 'c', t: 'g', f: '2026-11-04', d: 'Cine', c: 450000, m: 'ARS', k: 'ocio' }, { id: 'd', t: 'g', f: '2026-11-05', d: 'Uber', c: 100000, m: 'USD', k: 'transporte' },
       { id: 'p', t: 'p', k: 'ocio', c: 500000, m: 'ARS', ts: 1 }, { id: 'p2', t: 'p', k: 'casa', c: 4000000, m: 'ARS', ts: 1 }]);
    const s = P.statsMes(P.armar(ev), '2026-11', 'ARS', 30000000, HOY);
    assert.strictEqual(s.total, 2450000); assert.strictEqual(s.count, 2);
    assert.strictEqual(s.cuotasFuturas, 4000000);
    assert.deepStrictEqual([s.tope.ocio.estado, s.tope.ocio.pct, s.tope.casa.estado], ['cerca', 90, 'ok']);
    assert.strictEqual(s.alertas.length, 1);
    assert.strictEqual(s.proyeccion, Math.round(2450000 / 10 * 30));
    assert.deepStrictEqual([s.libre, s.diasRestantes, s.porDia], [27550000, 21, Math.floor(27550000 / 21)]);
    assert.strictEqual(P.statsMes(P.armar(ev), '2026-11', 'USD', 0, HOY).total, 100000, 'cada moneda por su lado');
    assert.strictEqual(P.statsMes(P.armar([]), '2026-11', 'ARS', 0, '2026-11-02').proyeccion, null, 'muy temprano: no proyecta');
    const pasado = P.statsMes(P.armar([{ id: 'p', t: 'p', k: 'ocio', c: 100, m: 'ARS' }, { id: 'a', t: 'g', f: '2026-11-02', d: 'x', c: 150, m: 'ARS', k: 'ocio' }]), '2026-11', 'ARS', 0, HOY);
    assert.strictEqual(pasado.tope.ocio.estado, 'pasado');
  });
  await t('duplicados: mismo monto y comercio pegados sí; cuotas y gastos distintos no', () => {
    const g = (id, f, d, c) => ({ id, t: 'g', f, d, c, m: 'ARS', k: 'comida' });
    const d = P.duplicados([g('1', '2026-11-05', 'Pizzería Don Luis', 800000), g('2', '2026-11-06', 'Pizzería Don Luis', 800000), g('3', '2026-11-05', 'Kiosco', 800000), g('4', '2026-11-20', 'Pizzería Don Luis', 800000)]);
    assert.deepStrictEqual(d.map(p => p.map(x => x.id).join('+')), ['1+2']);
    assert.strictEqual(P.duplicados(P.armarGasto({ desc: 'Tele', cents: 600, cur: 'ARS', cat: 'casa', fecha: '2026-11-01', cuotas: 2 }, 'b')).length, 0);
  });
  await t('rarezas: avisa un gasto 3 veces mayor a lo habitual, solo con historia', () => {
    const base = [1, 2, 3, 4, 5, 6].map(i => ({ id: 'h' + i, t: 'g', f: '2026-10-0' + i, d: 'Café', c: 200000, m: 'ARS', k: 'comida' }));
    const raro = { id: 'r', t: 'g', f: '2026-11-08', d: 'Cena', c: 900000, m: 'ARS', k: 'comida' };
    assert.deepStrictEqual(P.rarezas(base.concat(raro), HOY).map(x => x.g.id), ['r']);
    assert.deepStrictEqual(P.rarezas(base.slice(0, 3).concat(raro), HOY), []);
  });
  await t('.ics: eventos mensuales con aviso, texto escapado y líneas de hasta 75', () => {
    const s = P.ics([{ id: 'r1', titulo: 'Alquiler, noviembre\; ¡ojo!', fecha: '2026-11-05', nota: 'Pagar a Ana' }], '2026-11-10T12:00:00.000Z');
    assert.ok(s.startsWith('BEGIN:VCALENDAR\r\n') && s.endsWith('END:VCALENDAR\r\n'));
    for (const k of ['DTSTART;VALUE=DATE:20261105', 'DTEND;VALUE=DATE:20261106', 'RRULE:FREQ=MONTHLY', 'TRIGGER:-P1D', 'UID:r1@cuba-gastos', 'DTSTAMP:20261110T120000Z']) assert.ok(s.includes(k), k);
    assert.ok(s.includes('Alquiler\\, noviembre\\; ¡ojo!'));
    s.split('\r\n').forEach(l => assert.ok(Buffer.byteLength(l) <= 80, l));
  });
  console.log(n + ' pruebas de Personal');
})();

// ---- Mercado Pago: reporte CSV ----
{
  const P = require('../src/personal.js'), assert = require('assert');
  const csv = 'INITIAL_BALANCE;CREDITS;DEBITS;FINAL_BALANCE\n1,00;2,00;3,00;4,00\n\nRELEASE_DATE;TRANSACTION_TYPE;REFERENCE_ID;TRANSACTION_AMOUNT;PARTIAL_BALANCE\n' +
    '03-11-2026;Pago Coto Sucursal;1001;-7.066,67;10.000,00\n03-11-2026;Transferencia enviada Juan P;1002;-5.000,00;5.000,00\n04-11-2026;Ingreso de dinero;1003;1.000,00;6.000,00\n05-11-2026;Pago Farmacia;1004;-$ 1.234,5;4.000,00\n';
  const L = P.leerCSVMP(csv);
  assert.strictEqual(L.movs.length, 4); assert.strictEqual(L.movs[0].monto_centavos, 706667); assert.strictEqual(L.movs[3].monto_centavos, 123450);
  assert.deepStrictEqual(L.movs.map(m => m.sentido), ['pagado', 'pagado', 'recibido', 'pagado']);
  const st0 = P.armar([]), r = P.conciliarMP(L.movs, st0);
  assert.strictEqual(r.gastos.length, 2); assert.strictEqual(r.rev.length, 1); assert.strictEqual(r.ing, 1);
  // se sube de nuevo (o un reporte que se pisa): no duplica
  const ev = []; r.gastos.forEach(m => ev.push({ id: 'mp' + m.id, t: 'g', f: m.fecha, d: 'X', c: m.monto_centavos, m: 'ARS', k: 'otros', src: 'mp' }, { id: 'mpo-' + m.id, t: 'o', ref: 'mp' + m.id }));
  const st1 = P.armar(ev), r2 = P.conciliarMP(L.movs.concat([{ id: '1099', fecha: '2026-11-06', monto_centavos: 1000, moneda: 'ARS', sentido: 'pagado', tipo: 'regular_payment', descripcion: 'Kiosco' }]), st1);
  assert.deepStrictEqual([r2.antes, r2.gastos.length, r2.rev.length], [2, 1, 1], 'lo ya importado no vuelve');
  // otro formato: columnas en inglés, coma como separador, importes con punto, débito/crédito aparte
  const L2 = P.leerCSVMP('Date,Description,Net Debit Amount,Net Credit Amount\n2026-11-03T10:00:00.000-03:00,Subte,"700.50",\n2026-11-03,Subte,700.50,\n"2026-11-04","Cobro, venta",,"2,000.00"\n');
  assert.deepStrictEqual(L2.movs.map(m => [m.monto_centavos, m.sentido]), [[70050, 'pagado'], [70050, 'pagado'], [200000, 'recibido']]);
  assert.notStrictEqual(L2.movs[0].id, L2.movs[1].id, 'dos pagos iguales el mismo día son dos movimientos');
  assert.strictEqual(P.leerCSVMP('a;b\n1;2\n').error, 'cabecera');
  // parecido a un gasto cargado a mano: se marca como repetido, pero un pago importado antes no cuenta
  const man = P.armar([{ id: 'g1', t: 'g', f: '2026-11-03', d: 'Coto', c: 706667, m: 'ARS', k: 'super' }]);
  assert.strictEqual(P.conciliarMP(L.movs, man).ya.length, 1);
  // los eventos viejos de compras con amigos quedan dormidos y no rompen nada
  assert.strictEqual(P.armar([{ id: 'd1', t: 'd', f: '2026-11-01', w: 'Nacho', c: 5000 }, { id: 'r1', t: 'r', ref: 'd1', c: 1 }, { id: 'h1', t: 'h', v: 'x' }]).gastos.length, 0);
  // reporte de liberaciones (settlement) tal cual lo arma Mercado Pago, con datos inventados: JSON con comillas sueltas, detalle entre comillas dobles
  const H = 'EXTERNAL_REFERENCE,SOURCE_ID,USER_ID,TRANSACTION_TYPE,TRANSACTION_AMOUNT,TRANSACTION_CURRENCY,TRANSACTION_DATE,METADATA,PAYER_NAME,SALE_DETAIL,TIP_AMOUNT\n';
  const S1 = H + '"0109",9001,1,SETTLEMENT,-6873.75,ARS,2026-11-07T13:05:36.000-03:00,"[{"hide_payer_information":true}]",PERSONA UNO,"""Orden de Venta""",0.00\n' +
    ',9002,1,PAYOUTS,-10000.00,ARS,2026-11-07T11:42:08.000-03:00,"{}",,,0.00\n' + ',9003,1,SETTLEMENT,-2500.00,ARS,2026-11-06T21:44:08.000-03:00,"[{}]",PERSONA UNO,"""Varios""",0.00\n' +
    ',9004,1,SETTLEMENT,100000.00,ARS,2026-11-06T08:58:12.000-03:00,"[{}]",PERSONA DOS,"""Varios""",0.00\n' + ',9005,1,SETTLEMENT,-4600.00,ARS,2026-11-04T11:02:37.000-03:00,"[{}]",PERSONA UNO,"""Producto de Cafe Inventado""",0.00\n' +
    ',9006,1,SETTLEMENT,158.44,ARS,2026-11-05T01:39:33.000-03:00,"[{}]",,,0.00\n' + ',9006,1,SETTLEMENT,11.35,ARS,2026-11-05T01:39:33.000-03:00,"[{}]",,,0.00\n';
  const LS = P.leerCSVMP(S1), rs = P.conciliarMP(LS.movs, P.armar([]));
  assert.deepStrictEqual(rs.gastos.map(m => [m.id, m.monto_centavos, m.descripcion]), [['9001', 687375, 'Pago con QR'], ['9005', 460000, 'Cafe Inventado']]);
  assert.deepStrictEqual(rs.rev.map(m => [m.id, m.monto_centavos]), [['9002', 1000000], ['9003', 250000]], 'retiros y «Varios» quedan para revisar');
  assert.strictEqual(rs.ing, 3, 'los ingresos y rendimientos no son gastos');
  console.log('ok  Mercado Pago CSV: formatos, signos, sin duplicar entre reportes que se pisan');
}
