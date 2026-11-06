(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.CubaArt = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  // Cuba, el doberman. Ilustración vectorial propia; moods: idle | happy | alert | sleepy.
  function cuba(mood, size) {
    var eyes, brows, mouth;
    var tan = '#c9843f', ink = '#1d1d22';
    if (mood === 'sleepy') {
      eyes = '<path d="M68 99q9 7 18 0M114 99q9 7 18 0" stroke="#0e0e10" stroke-width="3" fill="none" stroke-linecap="round"/>';
      brows = '<ellipse cx="77" cy="86" rx="5" ry="3.2" fill="' + tan + '"/><ellipse cx="123" cy="86" rx="5" ry="3.2" fill="' + tan + '"/>';
      mouth = '<path d="M86 139Q100 146 114 139" stroke="#0e0e10" stroke-width="2.6" fill="none" stroke-linecap="round"/>';
    } else if (mood === 'alert') {
      eyes = '<circle cx="78" cy="98" r="6.5" fill="#2a1a12"/><circle cx="122" cy="98" r="6.5" fill="#2a1a12"/><circle cx="80" cy="96" r="2" fill="#fff"/><circle cx="124" cy="96" r="2" fill="#fff"/>';
      brows = '<ellipse cx="76" cy="81" rx="5.5" ry="3.6" fill="' + tan + '" transform="rotate(-14 76 81)"/><ellipse cx="124" cy="81" rx="5.5" ry="3.6" fill="' + tan + '" transform="rotate(14 124 81)"/>';
      mouth = '<path d="M88 140Q100 138 112 140" stroke="#0e0e10" stroke-width="2.6" fill="none" stroke-linecap="round"/><ellipse cx="100" cy="145" rx="6" ry="4" fill="#7a2d34"/>';
    } else {
      eyes = '<circle cx="78" cy="98" r="6" fill="#2a1a12"/><circle cx="122" cy="98" r="6" fill="#2a1a12"/><circle cx="80" cy="96" r="1.9" fill="#fff"/><circle cx="124" cy="96" r="1.9" fill="#fff"/>';
      brows = '<ellipse cx="77" cy="84" rx="5" ry="3.4" fill="' + tan + '"/><ellipse cx="123" cy="84" rx="5" ry="3.4" fill="' + tan + '"/>';
      mouth = '<path d="M82 138Q100 154 118 138" stroke="#0e0e10" stroke-width="2.6" fill="none" stroke-linecap="round"/><path d="M94 146Q100 162 106 146Z" fill="#e8707a"/>';
    }
    return '<span class="cuba" style="display:inline-block;line-height:0"><svg width="' + size + '" height="' + Math.round(size * 1.05) + '" viewBox="0 0 200 210" role="img" aria-label="Cuba, el doberman">' +
      '<path d="M50 210Q54 158 100 150Q146 158 150 210Z" fill="' + ink + '"/>' +
      '<ellipse cx="84" cy="192" rx="7" ry="10" fill="' + tan + '"/><ellipse cx="116" cy="192" rx="7" ry="10" fill="' + tan + '"/>' +
      '<polygon points="56,88 44,10 96,58" fill="' + ink + '"/><polygon points="59,78 53,34 85,60" fill="#3b2c2c"/>' +
      '<polygon points="144,88 156,10 104,58" fill="' + ink + '"/><polygon points="141,78 147,34 115,60" fill="#3b2c2c"/>' +
      '<path d="M48 100Q46 54 100 52Q154 54 152 100Q152 144 100 154Q48 144 48 100Z" fill="' + ink + '"/>' +
      '<path d="M70 118Q100 104 130 118Q134 148 100 153Q66 148 70 118Z" fill="' + tan + '"/>' +
      brows + eyes +
      '<ellipse cx="100" cy="121" rx="12" ry="8" fill="#0e0e10"/><ellipse cx="96" cy="118.5" rx="4" ry="2" fill="#fff" opacity=".35"/>' +
      '<path d="M100 129V137" stroke="#0e0e10" stroke-width="2.4" stroke-linecap="round"/>' + mouth +
      '<rect x="64" y="150" width="72" height="14" rx="7" fill="#b3322a"/><circle cx="100" cy="171" r="8.5" fill="#e4b53c"/><text x="100" y="175" text-anchor="middle" font-size="10" font-weight="800" fill="#6b4a05" font-family="sans-serif">C</text>' +
      '</svg></span>';
  }

  return { cuba: cuba };
});
