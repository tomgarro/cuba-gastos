(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubaArt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Cuba, la doberman (hembra; homenaje a la Cuba real). Ilustración vectorial propia, estilo plano de contornos suaves.
  // Moods básicos: idle | happy | alert | sleepy. Con sus imágenes también: surprised | sad | party | mail | calc | gift | phone | trip | bbq | piggy | receipt | detective. Paleta: pelaje #242528, fuego #BE6C35, caracoles cauri #F2F0E7, contorno #4a4a4d.
  var FUR = '#242528', TAN = '#be6c35', LINE = '#4a4a4d', INK = '#141416', SHELL = '#f2f0e7', EYE = '#3a2418';

  // Cada oreja se dibuja a la izquierda y se espeja para la derecha (x → 200 − x).
  function ear(lift, turn) {
    return '<g transform="translate(0 ' + (-lift) + ') rotate(' + turn + ' 62 92)">' +
      '<path d="M58 92C30 86 14 56 20 26C22 18 30 18 36 22C60 36 82 54 94 74Z" fill="' + FUR + '" stroke="' + LINE + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M52 83C38 72 30 54 31 38C48 46 68 60 80 74Z" fill="' + TAN + '"/></g>';
  }
  function mirror(g) { return '<g transform="matrix(-1 0 0 1 200 0)">' + g + '</g>'; }

  // Caracoles cauri enhebrados en la base del cuello: óvalo crema con su abertura central.
  function collar() {
    var xs = [62, 76, 90, 100, 110, 124, 138], ys = [144, 154, 161, 164, 161, 154, 144], rs = [-40, -26, -12, 0, 12, 26, 40];
    var h = '<path d="M56 140Q100 180 144 140" stroke="#7a6a58" stroke-width="2" fill="none" stroke-linecap="round"/>';
    for (var i = 0; i < xs.length; i++) {
      h += '<g transform="translate(' + xs[i] + ' ' + ys[i] + ') rotate(' + rs[i] + ')">' +
        '<ellipse rx="7" ry="9.6" fill="' + SHELL + '" stroke="' + INK + '" stroke-width="1.5"/>' +
        '<path d="M0-6V6" stroke="' + INK + '" stroke-width="2" stroke-linecap="round"/>' +
        '</g>';
    }
    return h;
  }

  function face(mood) {
    var eyes, brows, mouth, tongue = '';
    var browY = mood === 'alert' ? 75 : mood === 'sleepy' ? 84 : 79;
    var tilt = mood === 'alert' ? 10 : mood === 'sleepy' ? -4 : 0;
    brows = '<ellipse cx="76" cy="' + browY + '" rx="7" ry="3.8" fill="' + TAN + '" transform="rotate(' + (-tilt) + ' 76 ' + browY + ')"/>' +
            '<ellipse cx="124" cy="' + browY + '" rx="7" ry="3.8" fill="' + TAN + '" transform="rotate(' + tilt + ' 124 ' + browY + ')"/>';
    if (mood === 'sleepy') {
      eyes = '<path d="M66 99Q77 108 88 99M112 99Q123 108 134 99" stroke="' + INK + '" stroke-width="3.4" fill="none" stroke-linecap="round"/>';
    } else {
      var r = mood === 'alert' ? 10.5 : 9.5, pr = mood === 'alert' ? 7.2 : 6.6;
      eyes = '<circle cx="77" cy="98" r="' + r + '" fill="' + EYE + '" stroke="' + INK + '" stroke-width="2"/><circle cx="123" cy="98" r="' + r + '" fill="' + EYE + '" stroke="' + INK + '" stroke-width="2"/>' +
        '<circle cx="77" cy="98" r="' + pr + '" fill="#1a1a1a"/><circle cx="123" cy="98" r="' + pr + '" fill="#1a1a1a"/>' +
        '<circle cx="80.5" cy="94.5" r="3.2" fill="#fff"/><circle cx="126.5" cy="94.5" r="3.2" fill="#fff"/><circle cx="74.5" cy="102" r="1.3" fill="#fff" opacity=".8"/><circle cx="120.5" cy="102" r="1.3" fill="#fff" opacity=".8"/>';
    }
    if (mood === 'happy') {
      mouth = '<path d="M80 134Q100 160 120 134Q100 140 80 134Z" fill="#4a1d22" stroke="' + INK + '" stroke-width="2.4" stroke-linejoin="round"/>';
      tongue = '<path d="M93 143Q100 162 107 143Q100 147 93 143Z" fill="#e8707a"/>';
    } else if (mood === 'alert') {
      mouth = '<path d="M90 137Q100 141 110 137" stroke="' + INK + '" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
    } else {
      mouth = '<path d="M82 135Q100 149 118 135" stroke="' + INK + '" stroke-width="2.8" fill="none" stroke-linecap="round"/>';
    }
    return brows + eyes +
      '<ellipse cx="100" cy="119" rx="12.5" ry="9" fill="' + INK + '"/><ellipse cx="95.5" cy="115.5" rx="4.4" ry="2.1" fill="#fff" opacity=".28"/>' +
      '<path d="M100 128V134" stroke="' + INK + '" stroke-width="2.6" stroke-linecap="round"/>' + mouth + tongue;
  }

  // Poses ilustradas (assets/cuba/*.webp, embebidas por build.py en CUBA_IMG). Sin ellas (tests, versiones viejas) se usa el dibujo vectorial.
  var POSE = { idle: 'tranquilo', happy: 'feliz', alert: 'alerta', sleepy: 'durmiendo',
    surprised: 'sorprendida', sad: 'triste', party: 'festejando', mail: 'sobre', calc: 'calculadora', gift: 'regalo',
    phone: 'celular', trip: 'valija', bbq: 'parrilla', piggy: 'alcancia', receipt: 'ticket', detective: 'lupa' };
  // Si falta la imagen de una pose nueva, se usa la de un humor básico (y sin imágenes, el vector).
  var FALLBACK = { surprised: 'alert', sad: 'sleepy', party: 'happy', mail: 'idle', calc: 'idle', gift: 'happy', phone: 'alert', trip: 'happy', bbq: 'happy', piggy: 'idle', receipt: 'idle', detective: 'alert' };

  // Aventuras: lo que Cuba hace de vez en cuando en Inicio. «solo» limita cuándo puede salir.
  var AVENTURAS = [
    { mood: 'trip', texto: '¡Me voy de viaje! Ya tengo la valija lista 🧳' },
    { mood: 'bbq', texto: 'Domingo de asado: yo cuido la parrilla 🔥' },
    { mood: 'detective', texto: 'Investigando gastos sospechosos 🔎' },
    { mood: 'piggy', texto: 'Guardando una moneda para el mes que viene 🐷' },
    { mood: 'phone', texto: '¡Ding! Te aviso apenas llegue un gasto 🔔' },
    { mood: 'gift', texto: 'Shhh… estoy preparando una sorpresa 🎁' },
    { mood: 'receipt', texto: 'Olfateando un ticket larguísimo 🧾' },
    { mood: 'mail', texto: 'Llegó correo: me fijo los vencimientos ✉️' },
    { mood: 'calc', texto: 'Sacando cuentas, centavo por centavo 🧮' },
    { mood: 'surprised', texto: '¡Guau! Eso no lo vi venir 😮' },
    { mood: 'party', texto: '¡Todo saldado! Hay fiesta 🎉', solo: 'amano' }
  ];
  // Elige una aventura distinta de la anterior (ult = índice o -1). r en [0,1). Las de «solo» salen únicamente si se cumple la condición.
  function elegir(ult, r, cond) {
    var ok = [];
    AVENTURAS.forEach(function (a, i) { if (i !== ult && (!a.solo || (cond && cond[a.solo]))) ok.push(i); });
    var i = ok[Math.min(ok.length - 1, Math.floor((r || 0) * ok.length))];
    return { i: i, mood: AVENTURAS[i].mood, texto: AVENTURAS[i].texto };
  }
  function hay(k) { return typeof CUBA_IMG !== 'undefined' && CUBA_IMG && CUBA_IMG[k]; }
  function sprite(mood, size, key) {
    var w = size, h = Math.round(size * 1.05), z = mood === 'sleepy' ? '<i class="zz" style="font-size:' + Math.max(10, Math.round(size * 0.17)) + 'px" aria-hidden="true">z<b>z</b></i>' : '';
    return '<span class="cuba pose-' + mood + '" style="display:inline-block;line-height:0;position:relative;width:' + w + 'px;height:' + h + 'px">' +
      '<img src="' + CUBA_IMG[key] + '" alt="Cuba, la doberman" draggable="false" style="width:100%;height:100%;object-fit:contain;object-position:50% 100%">' + z + '</span>';
  }
  function cuba(mood, size) {
    mood = mood || 'idle';
    if (!POSE[mood]) mood = 'idle';
    if (hay(POSE[mood])) return sprite(mood, size, POSE[mood]);
    mood = FALLBACK[mood] || mood;   // pose nueva sin imagen: la de un humor básico
    if (hay(POSE[mood])) return sprite(mood, size, POSE[mood]);
    var lift = mood === 'alert' ? 5 : 0, turn = mood === 'sleepy' ? 9 : mood === 'alert' ? -3 : 0;
    var leftEar = ear(lift, turn), rightEar = mirror(ear(lift, turn));
    return '<span class="cuba" style="display:inline-block;line-height:0"><svg width="' + size + '" height="' + Math.round(size * 1.05) + '" viewBox="0 0 200 210" role="img" aria-label="Cuba, la doberman">' +
      // cuerpo y manchas del pecho
      '<path d="M44 210C46 172 70 154 100 154C130 154 154 172 156 210Z" fill="' + FUR + '" stroke="' + LINE + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M82 178C72 178 66 187 71 197C77 203 90 197 92 187C93 181 89 178 82 178Z" fill="' + TAN + '"/>' +
      '<path d="M118 178C128 178 134 187 129 197C123 203 110 197 108 187C107 181 111 178 118 178Z" fill="' + TAN + '"/>' +
      collar() +
      // orejas, cabeza y hocico
      leftEar + rightEar +
      '<path d="M50 100C48 66 72 52 100 52C128 52 152 66 150 100C150 126 134 144 100 150C66 144 50 126 50 100Z" fill="' + FUR + '" stroke="' + LINE + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<path d="M62 104C72 100 86 108 91 124C96 130 104 130 109 124C114 108 128 100 138 104C140 128 126 146 100 150C74 146 60 128 62 104Z" fill="' + TAN + '"/>' +
      '<path d="M96 100C96 112 94 120 91 126L109 126C106 120 104 112 104 100Z" fill="' + FUR + '"/>' +
      face(mood) +
      '</svg></span>';
  }

  return { cuba: cuba, aventuras: AVENTURAS, elegir: elegir, imagen: function (m) { return POSE[m] || POSE.idle; }, moods: Object.keys(POSE) };
});
