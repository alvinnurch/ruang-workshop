#!/usr/bin/env node
/* Pulihkan peserta yang hilang dari cadangan — TANPA menghapus data terbaru.
   Pakai:  sudo node deploy/pulihkan-peserta.js            (lihat cadangan yang ada)
           sudo node deploy/pulihkan-peserta.js <berkas>   (pulihkan dari berkas itu)
   Hentikan layanan dulu: sudo systemctl stop ruang */
const fs = require('fs'), path = require('path');
const DATA = process.env.DATA_FILE || '/opt/ruang/data/data.json';
const muat = f => JSON.parse(fs.readFileSync(f, 'utf8'));
const hitung = st => (st.meta || []).map(m => ({ id: m.id, title: m.title, n: ((st.data || {})[m.id] || {}).participants ? st.data[m.id].participants.length : 0 }));
const lokasi = [path.join(path.dirname(DATA), 'riwayat'), '/opt/ruang/backup', '/opt/ruang-workshop/backup', path.dirname(DATA)];
const target = process.argv[2];
const kini = muat(DATA);

/* Mode: rekonstruksi dari catatan pembayaran + log server.
   sudo journalctl -u ruang --no-pager | sudo node deploy/pulihkan-peserta.js --dari-pembayaran [--tulis] */
if (target === '--dari-pembayaran') {
  const tulis = process.argv.includes('--tulis');
  const log = fs.readFileSync(0, 'utf8');
  /* [bayar] lunas via X · <ref> · Nama <email> */
  const dariRef = {};
  log.split('\n').forEach(l => {
    const m = l.match(/\[bayar\] lunas via [^·]*· ([^ ·]+) · (.+?) <([^>]*)>/);
    if (m) dariRef[m[1]] = { name: m[2].trim(), email: m[3].trim() };
  });
  /* [email] tiket KODE ... ke email */
  const kodeEmail = {};
  log.split('\n').forEach(l => {
    const m = l.match(/\[email\] tiket ([A-Z0-9-]+) (?:terkirim|GAGAL) ke ([^\s:]+)/i);
    if (m) kodeEmail[m[2].toLowerCase()] = m[1].toUpperCase();
  });
  fs.copyFileSync(DATA, DATA + '.sebelum-pulih-' + Date.now());
  let total = 0;
  Object.keys(kini.data || {}).forEach(wid => {
    const d = kini.data[wid], judul = ((kini.meta || []).find(m => m.id === wid) || {}).title || wid;
    d.participants = d.participants || [];
    const ada = new Set(d.participants.map(x => x.id));
    const kodeAda = new Set(d.participants.map(x => String(x.code || '').toUpperCase()));
    const lunas = Object.values(d.payments || {}).filter(b => b.status === 'lunas' && b.participantId && !ada.has(b.participantId));
    const per = {};
    lunas.forEach(b => { if (!per[b.participantId]) per[b.participantId] = b; });
    Object.values(per).forEach(b => {
      const info = dariRef[b.ref] || {};
      let code = info.email ? (kodeEmail[info.email.toLowerCase()] || '') : '';
      if (!code || kodeAda.has(code)) { do { code = 'WS-' + Math.random().toString(36).toUpperCase().slice(2, 6); } while (kodeAda.has(code)); }
      kodeAda.add(code);
      const ps = {
        id: b.participantId, name: info.name || '(nama tidak tercatat — ref ' + b.ref + ')', code,
        email: info.email || '', phone: '', org: '', group: '', status: 'aktif',
        paidAt: b.paidAt || b.createdAt, registeredAt: b.createdAt, harga: b.amount, pulihDari: 'pembayaran'
      };
      console.log((tulis ? '+ ' : '  ') + judul + ' · ' + ps.name + ' <' + ps.email + '> · ' + ps.code + (info.name ? '' : '  ⚠ nama tidak ditemukan di log'));
      if (tulis) { d.participants.push(ps); total++; }
    });
  });
  if (tulis) { fs.writeFileSync(DATA, JSON.stringify(kini)); console.log('\nSelesai: ' + total + ' peserta dipulihkan.\nJalankan: sudo systemctl start ruang'); }
  else console.log('\nBelum ada yang diubah. Bila daftar di atas benar, ulangi perintah dengan --tulis di akhir.');
  process.exit(0);
}
if (!target) {
  console.log('Sekarang:'); hitung(kini).forEach(x => console.log('   ' + String(x.n).padStart(4) + '  ' + x.title));
  console.log('\nCadangan (terbaru di bawah):');
  const daftar = [];
  lokasi.forEach(d => { try { fs.readdirSync(d).filter(f => /\.json$/.test(f) && f !== 'data.json').forEach(f => daftar.push(path.join(d, f))); } catch (e) {} });
  try { fs.readdirSync('/opt/ruang').filter(f => /^data-cadangan-/.test(f)).forEach(f => daftar.push(path.join('/opt/ruang', f, 'data.json'))); } catch (e) {}
  daftar.map(f => { try { return { f, t: fs.statSync(f).mtimeMs, st: muat(f) }; } catch (e) { return null; } }).filter(Boolean)
    .sort((a, b) => a.t - b.t).slice(-25).forEach(x => {
      console.log('\n' + new Date(x.t).toLocaleString('id-ID', { timeZone: 'Asia/Jakarta' }) + '  ' + x.f);
      hitung(x.st).forEach(y => console.log('   ' + String(y.n).padStart(4) + '  ' + y.title));
    });
  console.log('\nPilih berkas yang jumlah pesertanya paling lengkap, lalu jalankan:\n  sudo node deploy/pulihkan-peserta.js <berkas>');
  process.exit(0);
}
const lama = muat(target);
fs.copyFileSync(DATA, DATA + '.sebelum-pulih-' + Date.now());
let total = 0;
Object.keys(lama.data || {}).forEach(wid => {
  const a = (lama.data[wid].participants || []), b = ((kini.data || {})[wid] || {});
  if (!kini.data[wid]) return;
  b.participants = b.participants || [];
  const ada = new Set(b.participants.map(x => x.id));
  const balik = a.filter(x => !ada.has(x.id));
  if (balik.length) { b.participants = b.participants.concat(balik); total += balik.length; console.log('+' + balik.length + '  ' + ((kini.meta.find(m => m.id === wid) || {}).title || wid) + ': ' + balik.map(x => x.name).join(', ')); }
  ['payments', 'pendaftar'].forEach(k => { if (lama.data[wid][k] && typeof lama.data[wid][k] === 'object') {
    if (Array.isArray(lama.data[wid][k])) { const ids = new Set((b[k] || []).map(x => x.id)); b[k] = (b[k] || []).concat(lama.data[wid][k].filter(x => !ids.has(x.id))); }
    else b[k] = Object.assign({}, lama.data[wid][k], b[k] || {});
  } });
});
fs.writeFileSync(DATA, JSON.stringify(kini));
console.log('\nSelesai: ' + total + ' peserta dipulihkan. Salinan sebelum pemulihan disimpan di sebelah data.json.\nJalankan: sudo systemctl start ruang');
