/* GinN — device knowledge: SoC/CPU/GPU names, hardware class (tier) and FPS caps per tier.
 * Pure data + functions, no host calls. Every public function is defensive and never throws. */
window.GinN = window.GinN || {};

(function (G) {
  'use strict';

  function isNum(n) { return typeof n === 'number' && isFinite(n); }
  function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }

  /* ------------------------------------------------------------ SoC table */
  // [codes (lowercase), vendor, marketing name, score 0..100]
  var SOCS = [
    // Qualcomm
    [['sm8750'], 'Qualcomm', 'Snapdragon 8 Elite', 98],
    [['sm8650'], 'Qualcomm', 'Snapdragon 8 Gen 3', 95],
    [['sm8635'], 'Qualcomm', 'Snapdragon 8s Gen 3', 86],
    [['sm8550'], 'Qualcomm', 'Snapdragon 8 Gen 2', 90],
    [['sm8475'], 'Qualcomm', 'Snapdragon 8+ Gen 1', 86],
    [['sm8450'], 'Qualcomm', 'Snapdragon 8 Gen 1', 82],
    [['sm8350-ac'], 'Qualcomm', 'Snapdragon 888+', 78],
    [['sm8350'], 'Qualcomm', 'Snapdragon 888', 76],
    [['sm8250-ac'], 'Qualcomm', 'Snapdragon 870', 73],
    [['sm8250-ab'], 'Qualcomm', 'Snapdragon 865+', 71],
    [['sm8250'], 'Qualcomm', 'Snapdragon 865', 70],
    [['sm8150p'], 'Qualcomm', 'Snapdragon 860', 66],
    [['sm8150-ac'], 'Qualcomm', 'Snapdragon 855+', 65],
    [['sm8150'], 'Qualcomm', 'Snapdragon 855', 64],
    [['sdm845'], 'Qualcomm', 'Snapdragon 845', 55],
    [['sdm835', 'msm8998'], 'Qualcomm', 'Snapdragon 835', 46],
    [['sm7675'], 'Qualcomm', 'Snapdragon 7+ Gen 3', 82],
    [['sm7635'], 'Qualcomm', 'Snapdragon 7s Gen 3', 58],
    [['sm7550'], 'Qualcomm', 'Snapdragon 7 Gen 3', 64],
    [['sm7475'], 'Qualcomm', 'Snapdragon 7+ Gen 2', 76],
    [['sm7435'], 'Qualcomm', 'Snapdragon 7s Gen 2', 54],
    [['sm7450'], 'Qualcomm', 'Snapdragon 7 Gen 1', 60],
    [['sm7350'], 'Qualcomm', 'Snapdragon 780G', 62],
    [['sm7325'], 'Qualcomm', 'Snapdragon 778G', 60],
    [['sm7250'], 'Qualcomm', 'Snapdragon 765G', 50],
    [['sm7225'], 'Qualcomm', 'Snapdragon 750G', 48],
    [['sm7150'], 'Qualcomm', 'Snapdragon 730G', 44],
    [['sm7125'], 'Qualcomm', 'Snapdragon 720G', 44],
    [['sdm712'], 'Qualcomm', 'Snapdragon 712', 34],
    [['sdm710'], 'Qualcomm', 'Snapdragon 710', 32],
    [['sm6450'], 'Qualcomm', 'Snapdragon 6 Gen 1', 52],
    [['sm6375'], 'Qualcomm', 'Snapdragon 695', 42],
    [['sm6350'], 'Qualcomm', 'Snapdragon 690', 40],
    [['sm6225'], 'Qualcomm', 'Snapdragon 680', 30],
    [['sm6150', 'sdm675'], 'Qualcomm', 'Snapdragon 675', 32],
    [['sm6125'], 'Qualcomm', 'Snapdragon 665', 26],
    [['sm6115'], 'Qualcomm', 'Snapdragon 662', 25],
    [['sdm660'], 'Qualcomm', 'Snapdragon 660', 28],
    [['sdm636'], 'Qualcomm', 'Snapdragon 636', 22],
    [['sdm632'], 'Qualcomm', 'Snapdragon 632', 16],
    [['sm4450'], 'Qualcomm', 'Snapdragon 4 Gen 2', 32],
    [['sm4375'], 'Qualcomm', 'Snapdragon 4 Gen 1', 30],
    [['sm4350'], 'Qualcomm', 'Snapdragon 480', 28],
    [['sm4250'], 'Qualcomm', 'Snapdragon 460', 18],
    [['sdm450'], 'Qualcomm', 'Snapdragon 450', 12],
    [['sdm439'], 'Qualcomm', 'Snapdragon 439', 10],
    [['msm8953'], 'Qualcomm', 'Snapdragon 625', 14],
    // MediaTek
    [['mt6991'], 'MediaTek', 'Dimensity 9400', 98],
    [['mt6989'], 'MediaTek', 'Dimensity 9300', 94],
    [['mt6985'], 'MediaTek', 'Dimensity 9200', 88],
    [['mt6983'], 'MediaTek', 'Dimensity 9000', 82],
    [['mt6897'], 'MediaTek', 'Dimensity 8300', 78],
    [['mt6896'], 'MediaTek', 'Dimensity 8200', 72],
    [['mt6895'], 'MediaTek', 'Dimensity 8100', 70],
    [['mt6893'], 'MediaTek', 'Dimensity 1200/1300', 64],
    [['mt6891'], 'MediaTek', 'Dimensity 1100', 60],
    [['mt6889'], 'MediaTek', 'Dimensity 1000+', 58],
    [['mt6886'], 'MediaTek', 'Dimensity 7200', 58],
    [['mt6878'], 'MediaTek', 'Dimensity 7300', 56],
    [['mt6877'], 'MediaTek', 'Dimensity 900/1080/7050', 50],
    [['mt6855'], 'MediaTek', 'Dimensity 930/7020', 45],
    [['mt6853'], 'MediaTek', 'Dimensity 720', 36],
    [['mt6835'], 'MediaTek', 'Dimensity 6100+', 32],
    [['mt6833'], 'MediaTek', 'Dimensity 700', 35],
    [['mt6789'], 'MediaTek', 'Helio G99', 40],
    [['mt6781'], 'MediaTek', 'Helio G96', 34],
    [['mt6785'], 'MediaTek', 'Helio G90T/G95', 36],
    [['mt6779'], 'MediaTek', 'Helio P90', 30],
    [['mt6771'], 'MediaTek', 'Helio P60/P70', 22],
    [['mt6769'], 'MediaTek', 'Helio G85/G88', 24],
    [['mt6768'], 'MediaTek', 'Helio G85', 24],
    [['mt6765'], 'MediaTek', 'Helio G35/P35', 12],
    [['mt6762'], 'MediaTek', 'Helio P22', 10],
    [['mt6761'], 'MediaTek', 'Helio A22', 8],
    // Samsung
    [['s5e9945', 'exynos2400'], 'Samsung', 'Exynos 2400', 92],
    [['s5e9925', 'exynos2200'], 'Samsung', 'Exynos 2200', 80],
    [['s5e9840', 'exynos2100'], 'Samsung', 'Exynos 2100', 76],
    [['exynos990'], 'Samsung', 'Exynos 990', 62],
    [['exynos9825', 'exynos9820'], 'Samsung', 'Exynos 9820/9825', 55],
    [['exynos9810'], 'Samsung', 'Exynos 9810', 45],
    [['s5e8845', 'exynos1480'], 'Samsung', 'Exynos 1480', 58],
    [['s5e8835', 'exynos1380'], 'Samsung', 'Exynos 1380', 54],
    [['s5e8825', 'exynos1280'], 'Samsung', 'Exynos 1280', 46],
    [['s5e8535', 'exynos1330'], 'Samsung', 'Exynos 1330', 38],
    [['exynos9611'], 'Samsung', 'Exynos 9611', 24],
    [['s5e3830', 'exynos850'], 'Samsung', 'Exynos 850', 18],
    [['exynos7904'], 'Samsung', 'Exynos 7904', 12],
    [['exynos7884'], 'Samsung', 'Exynos 7884', 10],
    // Google
    [['gs101', 'tensor'], 'Google', 'Tensor G1', 70],
    [['gs201'], 'Google', 'Tensor G2', 74],
    [['zuma'], 'Google', 'Tensor G3', 82],
    [['zumapro'], 'Google', 'Tensor G4', 86],
    // HiSilicon
    [['kirin9000'], 'HiSilicon', 'Kirin 9000', 82],
    [['kirin990'], 'HiSilicon', 'Kirin 990', 62],
    [['kirin980'], 'HiSilicon', 'Kirin 980', 55],
    [['kirin970'], 'HiSilicon', 'Kirin 970', 40],
    [['kirin810'], 'HiSilicon', 'Kirin 810', 38],
    [['kirin710'], 'HiSilicon', 'Kirin 710', 24],
    // Unisoc
    [['t760'], 'Unisoc', 'Unisoc T760', 32],
    [['t700'], 'Unisoc', 'Unisoc T700', 22],
    [['t618'], 'Unisoc', 'Unisoc T618', 22],
    [['t616'], 'Unisoc', 'Unisoc T616', 20],
    [['t612'], 'Unisoc', 'Unisoc T612', 16],
    [['t610'], 'Unisoc', 'Unisoc T610', 16],
    [['t606'], 'Unisoc', 'Unisoc T606', 14],
    [['sc9863a'], 'Unisoc', 'Unisoc SC9863A', 6]
  ];

  // Qualcomm board codenames (Build.HARDWARE / ro.board.platform) -> SoC code
  var ALIAS = {
    sun: 'sm8750', pineapple: 'sm8650', kalama: 'sm8550', cape: 'sm8475', taro: 'sm8450', lahaina: 'sm8350',
    kona: 'sm8250', msmnile: 'sm8150', lito: 'sm7250', atoll: 'sm7125', yupik: 'sm7325', trinket: 'sm6125',
    bengal: 'sm6115', holi: 'sm4350'
  };

  var BY_CODE = {}, BY_NAME = {};
  function nameKey(s) { return String(s).toLowerCase().replace(/[^a-z0-9+]/g, ''); }
  SOCS.forEach(function (row) {
    var e = { codes: row[0], vendor: row[1], name: row[2], score: row[3] };
    row[0].forEach(function (c) { BY_CODE[c] = e; });
    var variants = row[2].split('/');
    var family = variants[0].replace(/\S+$/, '');
    variants.forEach(function (v, i) { BY_NAME[nameKey(i === 0 ? v : family + v)] = e; });
  });

  /** Normalised vendor display name: 'QTI' -> 'Qualcomm', 'Mediatek' -> 'MediaTek', 'GenuineIntel' -> 'Intel'… */
  function vendorName(v) {
    var s = String(v == null ? '' : v).trim();
    if (!s) return '';
    if (/^(qti|qcom|qualcomm)/i.test(s)) return 'Qualcomm';
    if (/mediatek|^mtk$/i.test(s)) return 'MediaTek';
    if (/samsung|exynos/i.test(s)) return 'Samsung';
    if (/google/i.test(s)) return 'Google';
    if (/unisoc|spreadtrum|^sprd/i.test(s)) return 'Unisoc';
    if (/hisilicon|huawei|kirin/i.test(s)) return 'HiSilicon';
    if (/intel/i.test(s)) return 'Intel';
    if (/^(authenticamd|amd|advanced micro)/i.test(s)) return 'AMD';
    return s;
  }

  /** Finds a SoC entry by raw code ('SM8650', 'MT6789V/CD', 's5e8845', 'kona') or marketing name. */
  function socLookup(code, vendor) {
    if (code == null) return null;
    var s = String(code).trim();
    if (!s) return null;
    var low = s.toLowerCase();
    if (ALIAS[low]) low = ALIAS[low];
    if (BY_CODE[low]) return BY_CODE[low];
    var m;
    if ((m = /(?:^|[^a-z0-9])(sm\d{4})(?:-?(a[a-z]|p))?/i.exec(s))) {
      var base = m[1].toLowerCase();
      var v = m[2] ? m[2].toLowerCase() : '';
      if (v && BY_CODE[base + (v === 'p' ? 'p' : '-' + v)]) return BY_CODE[base + (v === 'p' ? 'p' : '-' + v)];
      if (BY_CODE[base]) return BY_CODE[base];
    }
    if ((m = /(sdm\d{3}|msm\d{4})/i.exec(s)) && BY_CODE[m[1].toLowerCase()]) return BY_CODE[m[1].toLowerCase()];
    if ((m = /(mt\d{4})/i.exec(s)) && BY_CODE[m[1].toLowerCase()]) return BY_CODE[m[1].toLowerCase()];
    if ((m = /(s5e\d{4})/i.exec(s)) && BY_CODE[m[1].toLowerCase()]) return BY_CODE[m[1].toLowerCase()];
    if ((m = /exynos\s*(\d{3,4})/i.exec(s)) && BY_CODE['exynos' + m[1]]) return BY_CODE['exynos' + m[1]];
    if ((m = /kirin\s*(\d{3,4})/i.exec(s)) && BY_CODE['kirin' + m[1]]) return BY_CODE['kirin' + m[1]];
    if ((m = /\b(gs\d{3}|zumapro|zuma)\b/i.exec(s)) && BY_CODE[m[1].toLowerCase()]) return BY_CODE[m[1].toLowerCase()];
    if ((m = /^(?:unisoc\s*)?(t\d{3})$/i.exec(s)) || (/unisoc|spreadtrum/i.test(s + ' ' + (vendor || '')) && (m = /\b(t\d{3})\b/i.exec(s)))) {
      if (BY_CODE[m[1].toLowerCase()]) return BY_CODE[m[1].toLowerCase()];
    }
    if (/sc9863a/i.test(s)) return BY_CODE.sc9863a;
    var nk = nameKey(low.replace(/\((r|tm)\)|®|™/g, '')
      .replace(/qualcomm|technologies|mediatek|samsung|google|unisoc|hisilicon|\binc\b/g, ''));
    return BY_NAME[nk] || null;
  }

  /**
   * Marketing name of a mobile SoC without vendor: socName('Samsung','s5e8845') -> 'Exynos 1480',
   * socName('QTI','SM8650') -> 'Snapdragon 8 Gen 3'. Unknown -> the code as-is.
   */
  function socName(vendor, code) {
    var e = socLookup(code, vendor);
    if (e) return e.name;
    return typeof code === 'string' ? code.trim() : code;
  }

  function withVendor(vendor, name) {
    if (!vendor) return name;
    return name.toLowerCase().indexOf(vendor.toLowerCase()) >= 0 ? name : vendor + ' ' + name;
  }

  function cleanDesktopCpu(s) {
    return String(s || '')
      .replace(/\((R|TM|C)\)|®|™/gi, '')
      .replace(/\s+CPU\s*@.*$/i, '')
      .replace(/\s*@\s*[\d.,]+\s*[GM]Hz.*$/i, '')
      .replace(/\s+with\s+Radeon.*$/i, '')
      .replace(/^\s*\d+(st|nd|rd|th)\s+Gen\s+/i, '')
      .replace(/\s+(Processor|CPU)\s*$/i, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  }

  /**
   * Display name of a CPU/SoC. Accepts the Hardware.cpu object or a string.
   * {name:'s5e8845', vendor:'Samsung'} -> 'Samsung Exynos 1480'
   * 'AMD Ryzen 5 5600 6-Core Processor' -> 'AMD Ryzen 5 5600 6-Core'
   * 'Intel(R) Core(TM) i7-9700K CPU @ 3.60GHz' -> 'Intel Core i7-9700K'
   */
  function prettyCpu(cpu) {
    try {
      if (!cpu) return '';
      var name = typeof cpu === 'string' ? cpu : (cpu.name || cpu.model || '');
      var vendor = typeof cpu === 'string' ? '' : (cpu.vendor || '');
      var soc = socLookup(name, vendor);
      if (soc) return withVendor(soc.vendor, soc.name);
      var clean = cleanDesktopCpu(name);
      var v = vendorName(vendor);
      if (!clean) return v;
      return withVendor(v, clean);
    } catch (e) {
      return (cpu && cpu.name) || '';
    }
  }

  /* ------------------------------------------------------------ GPU names */

  function splitTop(s) {
    var out = [], depth = 0, cur = '';
    for (var i = 0; i < s.length; i++) {
      var ch = s.charAt(i);
      if (ch === '(') depth++;
      if (ch === ')') depth--;
      if (ch === ',' && depth === 0) { out.push(cur.trim()); cur = ''; } else cur += ch;
    }
    out.push(cur.trim());
    return out;
  }

  /**
   * Clean GPU name for display: unwraps 'ANGLE (…)', drops '(R)', '(TM)', device ids and API suffixes.
   * Software renderers (SwiftShader, llvmpipe…) -> null, because they say nothing about the real GPU.
   */
  function cleanGpu(raw) {
    if (raw == null) return null;
    var s = String(raw).trim();
    if (!s || /swiftshader|llvmpipe|softpipe|software|basic render|^webkit webgl$|^mozilla$/i.test(s)) return null;
    if (/^ANGLE\s*\(/i.test(s) && s.lastIndexOf(')') > s.indexOf('(')) {
      var inner = s.slice(s.indexOf('(') + 1, s.lastIndexOf(')'));
      var parts = splitTop(inner);
      s = parts.length >= 2 ? parts[1] : parts[0];
    }
    s = s.replace(/ANGLE Metal Renderer:\s*/i, '')
      .replace(/\s*\(0x[0-9a-f]+\)/ig, '')
      .replace(/\s+Direct3D.*$/i, '')
      .replace(/\s+vs_\d.*$/i, '')
      .replace(/\s+OpenGL.*$/i, '')
      .replace(/\/PCIe.*$/i, '')
      .replace(/\((R|TM)\)|®|™/gi, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
    return s || null;
  }

  var webglCache;
  /** GPU name from WebGL (WEBGL_debug_renderer_info), cleaned. null on any failure. Cached. */
  function gpuFromWebGL() {
    if (webglCache !== undefined) return webglCache;
    webglCache = null;
    try {
      if (typeof document === 'undefined' || !document.createElement) return null;
      var c = document.createElement('canvas');
      var gl = c.getContext && (c.getContext('webgl') || c.getContext('experimental-webgl'));
      if (!gl) return null;
      var ext = gl.getExtension('WEBGL_debug_renderer_info');
      var r = ext ? gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      webglCache = cleanGpu(r);
      var lose = gl.getExtension('WEBGL_lose_context');
      if (lose) lose.loseContext();
    } catch (e) {
      webglCache = null;
    }
    return webglCache;
  }

  /* --------------------------------------------------- PC CPU / GPU scores */

  var NV_RTX = {
    5090: 100, 5080: 96, '5070ti': 92, 5070: 88, '5060ti': 80, 5060: 76,
    4090: 99, '4080super': 96, 4080: 95, '4070tisuper': 91, '4070ti': 90, '4070super': 88, 4070: 85,
    '4060ti': 76, 4060: 72, 4050: 62,
    '3090ti': 90, 3090: 88, '3080ti': 87, 3080: 85, '3070ti': 80, 3070: 78, '3060ti': 72, 3060: 66, 3050: 52,
    '2080ti': 76, '2080super': 72, 2080: 70, '2070super': 68, 2070: 64, '2060super': 60, 2060: 56
  };
  var NV_GTX = {
    '1660ti': 50, '1660super': 49, 1660: 46, '1650super': 42, 1650: 36, 1630: 26,
    '1080ti': 62, 1080: 54, '1070ti': 50, 1070: 48, 1060: 40, '1050ti': 30, 1050: 26, 1030: 14,
    '980ti': 44, 980: 38, 970: 34, 960: 26, 950: 20, '750ti': 15, 750: 12
  };
  var AMD_RX = {
    '9070xt': 92, 9070: 88, '9060xt': 76,
    '7900xtx': 96, '7900xt': 92, '7900gre': 86, '7800xt': 84, '7700xt': 78, '7600xt': 68, 7600: 66,
    '6950xt': 88, '6900xt': 86, '6800xt': 84, 6800: 80, '6750xt': 74, '6700xt': 72, 6700: 70, '6650xt': 64,
    '6600xt': 63, 6600: 60, '6500xt': 38, 6400: 30,
    '5700xt': 60, 5700: 56, '5600xt': 52, '5500xt': 40, 5300: 30,
    590: 36, 580: 34, 570: 30, 560: 18, 550: 12, 480: 32, 470: 28
  };
  var ARC = { b580: 70, b570: 64, a770: 66, a750: 62, a580: 56, a380: 32, a310: 22 };
  var RADEON_IGPU = { 890: 36, 880: 32, 780: 30, 760: 26, 740: 18, 680: 28, 660: 22, 610: 8 };

  /** {score, integrated, known} for a PC GPU name. */
  function gpuInfo(name, vramMB) {
    var s = String(name || '').toLowerCase().replace(/\((r|tm)\)|®|™/g, ' ').replace(/\s+/g, ' ');
    var laptop = /laptop|mobile|max-q|\bm\b/.test(s) ? -8 : 0;
    var m, key;
    if ((m = /rtx\s*a?(\d{4})\s*(ti\s*super|ti|super)?/.exec(s))) {
      key = m[1] + (m[2] ? m[2].replace(/\s/g, '') : '');
      if (NV_RTX[key] || NV_RTX[m[1]]) return { score: (NV_RTX[key] || NV_RTX[m[1]]) + laptop, integrated: false, known: true };
    }
    if ((m = /gtx\s*(\d{3,4})\s*(ti|super)?/.exec(s))) {
      key = m[1] + (m[2] || '');
      if (NV_GTX[key] || NV_GTX[m[1]]) return { score: (NV_GTX[key] || NV_GTX[m[1]]) + laptop, integrated: false, known: true };
    }
    if ((m = /\bmx\s*(\d{3})/.exec(s))) return { score: Number(m[1]) >= 450 ? 22 : 14, integrated: false, known: true };
    if ((m = /\brx\s*(\d{3,4})\s*(xtx|xt|gre)?/.exec(s))) {
      key = m[1] + (m[2] || '');
      if (AMD_RX[key] || AMD_RX[m[1]]) return { score: (AMD_RX[key] || AMD_RX[m[1]]) + laptop, integrated: false, known: true };
    }
    if ((m = /arc\s*(?:\(tm\)\s*)?([ab]\d{3})/.exec(s)) && ARC[m[1]]) return { score: ARC[m[1]] + laptop, integrated: false, known: true };
    if (/arc/.test(s) && /intel/.test(s)) return { score: 30, integrated: true, known: true };
    if ((m = /radeon\s*(\d{3})m/.exec(s)) && RADEON_IGPU[m[1]]) return { score: RADEON_IGPU[m[1]], integrated: true, known: true };
    if ((m = /vega\s*(\d+)/.exec(s))) return { score: clamp(6 + Number(m[1]), 8, 18), integrated: true, known: true };
    if (/radeon\s*graphics|radeon\s*vega|radeon r[4-7]/.test(s)) return { score: 18, integrated: true, known: true };
    if (/iris\s*xe/.test(s)) return { score: 18, integrated: true, known: true };
    if (/iris/.test(s)) return { score: 12, integrated: true, known: true };
    if (/uhd/.test(s)) return { score: 8, integrated: true, known: true };
    if (/hd graphics|intel.*graphics/.test(s)) return { score: 6, integrated: true, known: true };
    var v = isNum(vramMB) ? vramMB : 0;
    var guess = v >= 12000 ? 70 : v >= 8000 ? 60 : v >= 6000 ? 50 : v >= 4000 ? 36 : v >= 2000 ? 22 : 25;
    return { score: guess, integrated: false, known: false };
  }

  /** {score, known} for a PC CPU (name parsing: Ryzen / Core iN / Core Ultra / others). */
  function cpuInfo(cpu) {
    var c = cpu || {};
    var s = cleanDesktopCpu(c.name || '').toLowerCase();
    var m;
    if ((m = /ryzen\s*ai\s*(\d)\s*(?:pro\s*)?(?:hx\s*)?(\d{3})/.exec(s))) {
      return { score: clamp(80 + (Number(m[1]) - 7) * 4, 60, 95), known: true };
    }
    if ((m = /ryzen\s*(?:threadripper\s*)?(\d)?\s*(?:pro\s*)?(\d)(\d{3})(x3d|xt|x|ge|g|hx|hs|h|u)?\b/.exec(s))) {
      var GEN = { 1: 28, 2: 33, 3: 48, 4: 52, 5: 64, 6: 66, 7: 78, 8: 76, 9: 86 };
      var SER = { 3: -10, 5: 0, 7: 6, 9: 10 };
      var suf = { x3d: 12, xt: 3, x: 2, g: -3, ge: -5, u: -10, h: 0, hs: -2, hx: 3 }[m[4] || ''] || 0;
      return { score: clamp((GEN[m[2]] || 45) + (SER[m[1]] || 0) + suf, 5, 98), known: true };
    }
    if ((m = /core\s*ultra\s*([579])\s*(\d)(\d{2})([a-z]*)/.exec(s))) {
      var base = m[2] === '1' ? 72 : 80;
      var sfx = /u|v/.test(m[4]) ? -8 : /k|hx/.test(m[4]) ? 6 : 0;
      return { score: clamp(base + (Number(m[1]) - 5) * 3 + sfx, 40, 95), known: true };
    }
    if ((m = /\bi([3579])-(\d{4,5})([a-z]\d?[a-z]*)?/.exec(s))) {
      var digits = m[2], gen;
      if (digits.length === 5) gen = Number(digits.slice(0, 2));
      else if (digits.charAt(0) === '1') gen = Number(digits.slice(0, 2));
      else gen = Number(digits.charAt(0));
      var IG = { 2: 14, 3: 17, 4: 21, 5: 23, 6: 27, 7: 30, 8: 38, 9: 42, 10: 46, 11: 52, 12: 66, 13: 74, 14: 78 };
      var IS = { 3: -12, 5: 0, 7: 6, 9: 10 };
      var sf = m[3] || '';
      var adj = /^k/.test(sf) ? 3 : /^hx/.test(sf) ? 3 : /^(u|y|g\d)/.test(sf) ? -12 : /^p/.test(sf) ? -6 : /^t/.test(sf) ? -5 : 0;
      return { score: clamp((IG[gen] || 40) + (IS[m[1]] || 0) + adj, 5, 95), known: true };
    }
    if (/\bcore\s*[357]\s*\d{3}/.test(s)) return { score: 55, known: true };
    if (/celeron|pentium|atom|athlon|\bn\d{3}\b|\bn100\b|\bn200\b/.test(s)) return { score: 12, known: true };
    if (/xeon|threadripper|epyc/.test(s)) return { score: 50, known: true };
    if (/\bfx-/.test(s)) return { score: 18, known: true };
    var threads = isNum(c.threads) ? c.threads : (isNum(c.cores) ? c.cores : 4);
    var mhz = isNum(c.maxMHz) ? c.maxMHz : 3000;
    return { score: clamp(Math.round(threads * 3 + (mhz - 2000) / 50), 10, 70), known: false };
  }

  /* -------------------------------------------------------------- classify */

  var TIER_NAMES = { 1: 'Начальный', 2: 'Средний', 3: 'Высокий', 4: 'Флагман' };
  var THRESH = { android: [40, 65, 85], windows: [30, 58, 82] };

  /** 'android' | 'windows' from an explicit platform or from the hardware object. */
  function platformOf(hw, platform) {
    var p = String(platform || '').toLowerCase();
    if (p === 'windows' || p === 'pc' || p === 'desktop' || p === 'win') return 'windows';
    if (p === 'android' || p === 'mobile' || p === 'phone') return 'android';
    var h = hw || {};
    var os = h.os && h.os.name ? String(h.os.name) : '';
    if (/windows/i.test(os)) return 'windows';
    if (/android/i.test(os)) return 'android';
    var t = h.device && h.device.type;
    if (t === 'desktop' || t === 'laptop') return 'windows';
    return 'android';
  }

  function classifyAndroid(h) {
    var notes = [];
    var cpu = h.cpu || {};
    var soc = socLookup(cpu.name, cpu.vendor) || socLookup(cpu.model, cpu.vendor);
    var ramGB = h.ram && isNum(h.ram.totalMB) ? h.ram.totalMB / 1024 : null;
    var mhz = isNum(cpu.maxMHz) ? cpu.maxMHz : null;
    var refresh = h.display ? (h.display.maxRefreshHz || h.display.refreshHz) : null;
    var score;
    if (soc) {
      score = soc.score;
    } else if (mhz) {
      score = mhz >= 3200 ? 80 : mhz >= 3000 ? 70 : mhz >= 2800 ? 58 : mhz >= 2400 ? 45 : mhz >= 2000 ? 30 : 18;
      if (isNum(cpu.cores) && cpu.cores < 8) score -= 5;
      notes.push('Чипа нет в нашей базе — оценка по частоте процессора');
    } else {
      score = 45;
      notes.push('Нет данных о процессоре — оценка примерная');
    }
    if (ramGB != null) {
      if (ramGB < 3) score -= 12;
      else if (ramGB < 4) score -= 8;
      else if (ramGB < 5.5) score -= 3;
      else if (ramGB >= 11) score += 4;
      else if (ramGB >= 7) score += 2;
      if (ramGB < 4) notes.push('Мало оперативной памяти — перед игрой жми «Ускорение»');
    }
    if (isNum(refresh)) {
      if (refresh >= 144) score += 3;
      else if (refresh >= 120) score += 1;
      else if (refresh <= 60) { score -= 2; notes.push('Экран 60 Гц — больше 60 FPS глазом не увидеть'); }
    }
    return { score: score, notes: notes, maxTier: 4 };
  }

  function classifyPc(h) {
    var notes = [];
    var cpu = cpuInfo(h.cpu);
    var gname = (h.gpu && h.gpu.name) || null;
    if (!gname) gname = gpuFromWebGL();
    var gpu = gpuInfo(gname, h.gpu && h.gpu.vramMB);
    var ramGB = h.ram && isNum(h.ram.totalMB) ? h.ram.totalMB / 1024 : null;
    var ramScore = ramGB == null ? 45 : ramGB >= 31 ? 100 : ramGB >= 23 ? 88 : ramGB >= 15 ? 75 : ramGB >= 11 ? 60 : ramGB >= 7 ? 45 : ramGB >= 5 ? 25 : 10;
    var score = gpu.score * 0.6 + cpu.score * 0.3 + ramScore * 0.1;
    var maxTier = 4;
    if (gpu.integrated) {
      notes.push('Встроенная графика — ставь низкие настройки в играх');
      if (gpu.score < 25) maxTier = 1;
    }
    if (!gname || !gpu.known) notes.push('Видеокарты нет в нашей базе — оценка примерная');
    if (!cpu.known) notes.push('Процессора нет в нашей базе — оценка примерная');
    if (ramGB != null && ramGB < 7) {
      maxTier = Math.min(maxTier, 2);
      notes.push('Мало оперативной памяти — закрывай браузер перед игрой');
    }
    var b = h.battery;
    if (h.device && h.device.type === 'laptop' && b && b.present !== false && b.charging === false) {
      notes.push('Ноутбук работает от батареи — с зарядкой игры пойдут быстрее');
    }
    return { score: score, notes: notes, maxTier: maxTier };
  }

  function tierFromScore(score, th) {
    return score >= th[2] ? 4 : score >= th[1] ? 3 : score >= th[0] ? 2 : 1;
  }
  function tierRange(tier, th) {
    return tier === 1 ? [0, th[0] - 1] : tier === 2 ? [th[0], th[1] - 1] : tier === 3 ? [th[1], th[2] - 1] : [th[2], 100];
  }

  /**
   * Hardware class. classify(hw, platform?) ->
   * {tier:1..4, tierName:'Начальный'|'Средний'|'Высокий'|'Флагман', score:0..100, notes:string[], platform}
   * Uses hw.tier when the host provided it. Never throws.
   */
  function classify(hw, platform) {
    var plat = 'android';
    try {
      var h = hw && typeof hw === 'object' ? hw : {};
      plat = platformOf(h, platform);
      var th = THRESH[plat];
      var r = plat === 'windows' ? classifyPc(h) : classifyAndroid(h);
      var score = clamp(Math.round(r.score), 0, 100);
      var tier = Math.min(tierFromScore(score, th), r.maxTier || 4);
      var given = Number(h.tier);
      if (given >= 1 && given <= 4 && Math.floor(given) === given) tier = given;
      var range = tierRange(tier, th);
      score = clamp(score, range[0], range[1]);
      return { tier: tier, tierName: TIER_NAMES[tier], score: score, notes: r.notes, platform: plat };
    } catch (e) {
      return { tier: 2, tierName: TIER_NAMES[2], score: 50, notes: ['Не удалось оценить железо — считаем его средним'], platform: plat };
    }
  }

  G.devices = {
    /** Max FPS per hardware tier. */
    tierCaps: { android: { 1: 60, 2: 90, 3: 120, 4: 144 }, windows: { 1: 75, 2: 165, 3: 300, 4: 1000 } },
    tierNames: TIER_NAMES,
    socName: socName,
    /** Full SoC entry or null: {codes, vendor, name, score}. */
    socInfo: function (code, vendor) { try { return socLookup(code, vendor); } catch (e) { return null; } },
    vendorName: vendorName,
    prettyCpu: prettyCpu,
    cleanGpu: function (raw) { try { return cleanGpu(raw); } catch (e) { return null; } },
    gpuFromWebGL: gpuFromWebGL,
    /** PC GPU score {score, integrated, known}. */
    gpuInfo: function (name, vramMB) { try { return gpuInfo(name, vramMB); } catch (e) { return { score: 25, integrated: false, known: false }; } },
    /** PC CPU score {score, known}. */
    cpuInfo: function (cpu) { try { return cpuInfo(cpu); } catch (e) { return { score: 40, known: false }; } },
    platformOf: platformOf,
    classify: classify
  };
})(window.GinN);
