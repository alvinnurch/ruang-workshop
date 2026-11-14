/* Pengirim WhatsApp otomatis (tidak resmi, lewat WhatsApp Web / Baileys).
   Opsional: bila paket belum dipasang, server tetap jalan dan fitur ini nonaktif.
   Pasang sekali di server:  npm install @whiskeysockets/baileys@6 pino
   Sesi login disimpan di folder WA_AUTH_DIR (bawaan: data/wa-auth). */
const path = require('path');
const fs = require('fs');

let B = null;
try { B = require('@whiskeysockets/baileys'); } catch (e) { B = null; }

const state = {
  available: !!B, status: B ? 'mati' : 'belum-dipasang', qr: '', me: '', error: '',
  job: null, log: []
};
let sock = null, authDir = '', starting = false;

const tidur = ms => new Promise(r => setTimeout(r, ms));
const catat = t => { state.log.unshift({ at: new Date().toISOString(), t }); state.log = state.log.slice(0, 60); };
function nomor(h) {
  let d = String(h || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '62' + d.slice(1); else if (d.startsWith('8')) d = '62' + d;
  return d.length >= 10 && d.length <= 15 ? d : '';
}

async function mulai(dir) {
  if (!B || starting || (sock && state.status === 'tersambung')) return;
  starting = true; authDir = dir || authDir;
  try {
    fs.mkdirSync(authDir, { recursive: true });
    const { state: auth, saveCreds } = await B.useMultiFileAuthState(authDir);
    let pino = null; try { pino = require('pino')({ level: 'silent' }); } catch (e) {}
    const make = B.default || B.makeWASocket;
    sock = make({ auth, printQRInTerminal: false, logger: pino || undefined, browser: ['Ruang islami.co', 'Chrome', '1.0'], syncFullHistory: false, markOnlineOnConnect: false });
    state.status = 'menyambung'; state.error = '';
    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', u => {
      if (u.qr) { state.qr = u.qr; state.status = 'pindai-qr'; }
      if (u.connection === 'open') {
        state.status = 'tersambung'; state.qr = '';
        state.me = String((sock.user && sock.user.id) || '').split(':')[0].split('@')[0];
        catat('Tersambung sebagai +' + state.me);
      }
      if (u.connection === 'close') {
        const code = u.lastDisconnect && u.lastDisconnect.error && u.lastDisconnect.error.output && u.lastDisconnect.error.output.statusCode;
        const keluar = B.DisconnectReason && code === B.DisconnectReason.loggedOut;
        sock = null; state.qr = '';
        if (keluar) {
          state.status = 'mati'; state.me = '';
          try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
          catat('Nomor keluar dari perangkat tertaut. Pindai QR lagi untuk menyambung.');
        } else {
          state.status = 'menyambung';
          setTimeout(() => mulai(authDir), 4000);
        }
      }
    });
  } catch (e) {
    state.status = 'galat'; state.error = e.message; catat('Gagal memulai: ' + e.message);
  } finally { starting = false; }
}

async function keluar() {
  if (state.job) state.job.stop = true;
  try { if (sock) await sock.logout(); } catch (e) {}
  sock = null; state.status = 'mati'; state.me = ''; state.qr = '';
  try { fs.rmSync(authDir, { recursive: true, force: true }); } catch (e) {}
  catat('Nomor pengirim diputus.');
}

/* items: [{ id, name, phone, text }] — dikirim berurutan dengan jeda acak & batas per jam. */
function kirimSemua(items, opsi, onSent) {
  if (state.status !== 'tersambung' || !sock) return { ok: false, error: 'Nomor pengirim belum tersambung. Pindai QR dulu.' };
  if (state.job && !state.job.done) return { ok: false, error: 'Masih ada kiriman yang berjalan.' };
  const jedaMin = Math.max(15, Number(opsi.jedaMin) || 30), jedaMax = Math.max(jedaMin + 5, Number(opsi.jedaMax) || 90);
  const perJam = Math.max(5, Math.min(120, Number(opsi.perJam) || 40));
  const antre = items.map(x => Object.assign({}, x, { phone: nomor(x.phone) })).filter(x => x.phone && x.text);
  const job = state.job = { total: antre.length, sent: 0, failed: 0, done: false, stop: false, next: null, ws: opsi.ws || '', startedAt: Date.now(), last: '' };
  catat('Mulai mengirim ' + antre.length + ' pesan · jeda ' + jedaMin + '–' + jedaMax + ' dtk · maks ' + perJam + '/jam');
  (async () => {
    const jejak = [];
    let gagalBeruntun = 0;
    for (const it of antre) {
      if (job.stop) { catat('Dihentikan panitia.'); break; }
      /* batas per jam */
      const sejam = Date.now() - 3600e3;
      while (jejak.filter(t => t > sejam).length >= perJam && !job.stop) { job.next = Date.now() + 60e3; await tidur(60e3); }
      if (job.stop) break;
      try {
        const jid = it.phone + '@s.whatsapp.net';
        const cek = await sock.onWhatsApp(jid).catch(() => null);
        if (Array.isArray(cek) && cek.length && cek[0].exists === false) throw new Error('nomor tidak terdaftar di WhatsApp');
        await sock.sendPresenceUpdate('composing', jid).catch(() => {});
        await tidur(1500 + Math.random() * 2500);
        await sock.sendMessage(jid, { text: it.text });
        job.sent++; gagalBeruntun = 0; jejak.push(Date.now()); job.last = it.name || it.phone;
        if (onSent) try { onSent(it.id, true); } catch (e) {}
      } catch (e) {
        job.failed++; gagalBeruntun++;
        catat('Gagal ke ' + (it.name || it.phone) + ': ' + e.message);
        if (onSent) try { onSent(it.id, false, e.message); } catch (er) {}
        if (gagalBeruntun >= 5) { catat('Berhenti otomatis: 5 kegagalan beruntun. Periksa nomor pengirim.'); break; }
      }
      const jeda = (jedaMin + Math.random() * (jedaMax - jedaMin)) * 1000;
      job.next = Date.now() + jeda;
      await tidur(jeda);
    }
    job.done = true; job.next = null;
    catat('Selesai: ' + job.sent + ' terkirim, ' + job.failed + ' gagal.');
  })();
  return { ok: true, data: { total: antre.length } };
}

function ringkas() {
  const j = state.job;
  return {
    available: state.available, status: state.status, qr: state.qr, me: state.me, error: state.error,
    job: j ? { total: j.total, sent: j.sent, failed: j.failed, done: j.done, next: j.next, last: j.last, ws: j.ws } : null,
    log: state.log.slice(0, 15)
  };
}

module.exports = { mulai, keluar, kirimSemua, ringkas, hentikan: () => { if (state.job) state.job.stop = true; }, tersedia: () => state.available };
