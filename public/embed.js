/* Ruang islami.co — penyesuai tinggi iframe embed.
   Tempel sekali di halaman; semua iframe Ruang di halaman itu ikut menyesuaikan. */
(function () {
  if (window.__ruangEmbed) return; window.__ruangEmbed = true;
  window.addEventListener('message', function (e) {
    var d = e.data;
    if (!d || !d.ruangEmbed || !d.height) return;
    var frames = document.querySelectorAll('iframe');
    for (var i = 0; i < frames.length; i++) {
      if (frames[i].contentWindow === e.source) { frames[i].style.height = Math.max(160, d.height) + 'px'; break; }
    }
  });
})();
