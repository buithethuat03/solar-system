// ============================================================================
//  i18n.js  —  Language support (English default, Vietnamese option).
//  The choice is persisted in localStorage and applied on load: UI strings via
//  t()/applyStaticTranslations(), and the body dataset (names, types,
//  descriptions, info tables, facts) by overlaying Vietnamese onto SUN/PLANETS/
//  MOONS before the scene and UI are built.
// ============================================================================
import { BODIES_VI } from './i18n.bodies.js';

export const LANG = (localStorage.getItem('solar.lang') === 'vi') ? 'vi' : 'en';

// ---- UI strings ------------------------------------------------------------
const STRINGS = {
  en: {
    loadingTextures: 'Loading textures…',
    brandTitle: 'SOLAR SYSTEM', brandSub: 'Interactive 3D Orrery',
    btnEclipses: '🌒 Eclipses', btnView: '⚙ View', btnHelp: '? Help', btnReset: '⟲ Reset view',
    eclipsesTitle: 'Eclipse views', viewTitle: 'View options', helpTitle2: 'Help', resetTitle: 'Reset camera',
    explore: 'EXPLORE', collapse: 'Collapse', expand: 'Expand details',
    eclSolarTitle: 'Solar Eclipse', eclSolarSub: 'The Moon hides the Sun',
    eclLunarTitle: 'Lunar Eclipse', eclLunarSub: "Earth's shadow on the Moon",
    viewOptions: 'VIEW OPTIONS',
    tgOrbits: 'Orbit paths', tgLabels: 'Labels', tgMoons: 'Moons', tgDwarfs: 'Dwarf planets',
    tgBelts: 'Asteroid & Kuiper belts', tgBloom: 'Sun glow (bloom)',
    tgSpacecraft: 'Spacecraft (Voyagers)',
    distScale: 'Distance scale', distVisual: 'Compressed (visible)',
    distRealistic: 'Realistic (to scale)', distAccurate: 'Accurate · live (true positions)',
    texQuality: 'Texture quality', tex2k: '2K · standard', tex8k: '8K · high-res',
    language: 'Language', langEn: 'English', langVi: 'Tiếng Việt',
    focusFollow: '⌖ Focus & follow', stopFollowing: '■ Stop following',
    didYouKnow: 'Did you know?',
    now: 'Now', nowTitle: 'Jump to current date', goToDate: 'Go to date',
    play: 'Play', pause: 'Pause', reverseTitle: 'Reverse time',
    playingBack: 'Playing backward', playingFwd: 'Playing forward',
    navStar: '★ Star', navPlanets: '● Planets', navDwarfs: '◐ Dwarf Planets', navMoons: '◦ Major Moons',
    navSpacecraft: '🛰 Spacecraft',
    typeStar: 'Star', typeMoon: 'Natural Satellite',
    scDistance: 'Distance from Sun', scLightTime: 'One-way light time', scSpeed: 'Speed (rel. Sun)',
    scLaunched: 'Launched', scInterstellar: 'Entered interstellar space',
    scStatus: 'Status', scStatusActive: 'Operating in interstellar space',
    scStatusPrelaunch: 'Not yet launched', scStatusCruising: 'Exploring the Solar System',
    scHours: 'hours', scBillionKm: 'billion km',
    realtime: 'Real-time', unitHr: 'hr / s', unitDays: 'days / s', unitWeeks: 'weeks / s',
    unitMonths: 'months / s', unitYr: 'yr / s',
    preRealtime: 'Real-time', pre1hr: '1 hr/s', pre1day: '1 day/s', pre1wk: '1 wk/s', pre1mo: '1 mo/s', pre1yr: '1 yr/s',
    following: 'Following', live: '● LIVE', fps: 'FPS',
    distHintRealistic: 'True to scale: the Sun, the planets and the gaps between them all share one ruler — so the Sun is a tiny dot and the planets are specks lost in vast emptiness (Earth orbits ~107 Sun-widths out). Zoom or use Focus & follow to explore; switch to Compressed for an easy overview.',
    distHintAccurate: 'True NASA/JPL positions, to true scale. The whole system drifts through space, each planet leaving a motion trail. Orbit paths are hidden; press ▶ / raise the speed to watch it move.',
    helpHowTo: 'How to use', helpAbout: 'About the model',
    help: [
      '<b>Rotate:</b> click-drag with the left mouse button (one finger on touch).',
      '<b>Zoom:</b> scroll wheel, or <b>pinch with two fingers</b> on touch.',
      '<b>Pan:</b> right-click drag (two-finger drag on touch).',
      '<b>Fly the viewpoint:</b> <b>W A S D</b> or the <b>arrow keys</b> move through space; <b>R / F</b> move up / down. Speed adapts to how far you are zoomed in.',
      '<b>Select a body:</b> click it, click its label, or pick it from the left list.',
      '<b>Focus &amp; follow:</b> double-click a body, choose it in the list, or press <b>Focus &amp; follow</b>.',
      '<b>Pause / resume:</b> press <b>Space</b>. <b>Esc</b> stops following.',
      '<b>Time:</b> use the slider, presets, or <b>Now</b>; reverse with ◄◄.',
    ],
    helpAboutText: 'Planet positions are computed from real <b>NASA/JPL J2000 Keplerian orbital elements</b>, so the alignment of the planets matches the chosen date. Axial tilts and rotation periods are physically accurate. The default <i>Compressed</i> view shrinks the distances so every planet is visible together; <i>Realistic</i> and <i>Accurate · live</i> show the Solar System fully <b>true to scale</b> — bodies and the gulfs between them share one ruler, so the Sun becomes a dot and the planets vanish into mostly-empty space (Earth orbits about 107 Sun-widths from the Sun). Use Compressed for an easy overview and Realistic to grasp the real scale.',
    credits: 'Planetary & star textures © Solar System Scope (CC BY 4.0). Pluto & major-moon maps: NASA/JHUAPL/SwRI & USGS Astrogeology (public domain). Orbital elements: NASA/JPL (J2000.0). Voyager 3D model: NASA/VTAD (public domain). Voyager positions: NASA/JPL HORIZONS state vectors. Built with three.js.',
  },
  vi: {
    loadingTextures: 'Đang tải texture…',
    brandTitle: 'HỆ MẶT TRỜI', brandSub: 'Mô hình 3D tương tác',
    btnEclipses: '🌒 Nhật/Nguyệt thực', btnView: '⚙ Hiển thị', btnHelp: '? Trợ giúp', btnReset: '⟲ Đặt lại góc nhìn',
    eclipsesTitle: 'Chế độ nhật/nguyệt thực', viewTitle: 'Tùy chọn hiển thị', helpTitle2: 'Trợ giúp', resetTitle: 'Đặt lại camera',
    explore: 'KHÁM PHÁ', collapse: 'Thu gọn', expand: 'Mở rộng chi tiết',
    eclSolarTitle: 'Nhật thực', eclSolarSub: 'Mặt Trăng che khuất Mặt Trời',
    eclLunarTitle: 'Nguyệt thực', eclLunarSub: 'Bóng Trái Đất phủ lên Mặt Trăng',
    viewOptions: 'TÙY CHỌN HIỂN THỊ',
    tgOrbits: 'Đường quỹ đạo', tgLabels: 'Nhãn tên', tgMoons: 'Vệ tinh', tgDwarfs: 'Hành tinh lùn',
    tgBelts: 'Vành đai tiểu hành tinh & Kuiper', tgBloom: 'Quầng sáng Mặt Trời',
    tgSpacecraft: 'Tàu vũ trụ (Voyager)',
    distScale: 'Tỉ lệ khoảng cách', distVisual: 'Nén lại (dễ nhìn)',
    distRealistic: 'Thực tế (đúng tỉ lệ)', distAccurate: 'Chính xác · trực tiếp (vị trí thật)',
    texQuality: 'Chất lượng texture', tex2k: '2K · tiêu chuẩn', tex8k: '8K · độ phân giải cao',
    language: 'Ngôn ngữ', langEn: 'English', langVi: 'Tiếng Việt',
    focusFollow: '⌖ Lấy nét & bám theo', stopFollowing: '■ Dừng bám theo',
    didYouKnow: 'Có thể bạn chưa biết?',
    now: 'Hiện tại', nowTitle: 'Về thời điểm hiện tại', goToDate: 'Đến ngày',
    play: 'Phát', pause: 'Tạm dừng', reverseTitle: 'Tua ngược thời gian',
    playingBack: 'Đang chạy ngược', playingFwd: 'Đang chạy xuôi',
    navStar: '★ Ngôi sao', navPlanets: '● Hành tinh', navDwarfs: '◐ Hành tinh lùn', navMoons: '◦ Vệ tinh chính',
    navSpacecraft: '🛰 Tàu vũ trụ',
    typeStar: 'Ngôi sao', typeMoon: 'Vệ tinh tự nhiên',
    scDistance: 'Khoảng cách tới Mặt Trời', scLightTime: 'Thời gian ánh sáng (một chiều)', scSpeed: 'Tốc độ (so với Mặt Trời)',
    scLaunched: 'Ngày phóng', scInterstellar: 'Vào không gian liên sao',
    scStatus: 'Trạng thái', scStatusActive: 'Đang hoạt động trong không gian liên sao',
    scStatusPrelaunch: 'Chưa phóng', scStatusCruising: 'Đang khám phá Hệ Mặt Trời',
    scHours: 'giờ', scBillionKm: 'tỷ km',
    realtime: 'Thời gian thực', unitHr: 'giờ / s', unitDays: 'ngày / s', unitWeeks: 'tuần / s',
    unitMonths: 'tháng / s', unitYr: 'năm / s',
    preRealtime: 'Thời gian thực', pre1hr: '1 giờ/s', pre1day: '1 ngày/s', pre1wk: '1 tuần/s', pre1mo: '1 tháng/s', pre1yr: '1 năm/s',
    following: 'Đang bám', live: '● TRỰC TIẾP', fps: 'FPS',
    distHintRealistic: 'Đúng tỉ lệ thật: Mặt Trời, các hành tinh và khoảng cách giữa chúng dùng chung một thước đo — nên Mặt Trời chỉ là một chấm nhỏ và các hành tinh là những đốm li ti giữa khoảng không mênh mông (Trái Đất cách Mặt Trời ~107 lần đường kính Mặt Trời). Hãy thu phóng hoặc dùng Lấy nét & bám theo để khám phá; chuyển sang Nén lại để xem tổng quan dễ hơn.',
    distHintAccurate: 'Vị trí thật theo NASA/JPL, đúng tỉ lệ thật. Toàn bộ hệ trôi trong không gian, mỗi hành tinh để lại một vệt chuyển động. Đường quỹ đạo bị ẩn; nhấn ▶ / tăng tốc độ để xem nó chuyển động.',
    helpHowTo: 'Cách sử dụng', helpAbout: 'Về mô hình',
    help: [
      '<b>Xoay:</b> giữ chuột trái và kéo (một ngón tay trên cảm ứng).',
      '<b>Thu phóng:</b> lăn chuột, hoặc <b>chụm hai ngón tay</b> trên cảm ứng.',
      '<b>Di chuyển (pan):</b> giữ chuột phải và kéo (kéo hai ngón trên cảm ứng).',
      '<b>Bay góc nhìn:</b> <b>W A S D</b> hoặc các <b>phím mũi tên</b> để di chuyển trong không gian; <b>R / F</b> lên / xuống. Tốc độ thay đổi theo mức thu phóng.',
      '<b>Chọn thiên thể:</b> nhấn vào nó, nhấn nhãn tên, hoặc chọn từ danh sách bên trái.',
      '<b>Lấy nét &amp; bám theo:</b> nhấn đúp vào thiên thể, chọn trong danh sách, hoặc nhấn <b>Lấy nét &amp; bám theo</b>.',
      '<b>Tạm dừng / tiếp tục:</b> nhấn <b>Space</b>. <b>Esc</b> để dừng bám theo.',
      '<b>Thời gian:</b> dùng thanh trượt, nút cài sẵn, hoặc <b>Hiện tại</b>; tua ngược bằng ◄◄.',
    ],
    helpAboutText: 'Vị trí các hành tinh được tính từ <b>tham số quỹ đạo Kepler J2000 thật của NASA/JPL</b>, nên sự sắp xếp của các hành tinh khớp với ngày đã chọn. Độ nghiêng trục và chu kỳ tự quay đều chính xác về mặt vật lý. Chế độ <i>Nén lại</i> mặc định thu nhỏ khoảng cách để mọi hành tinh cùng nằm trong tầm nhìn; còn <i>Thực tế</i> và <i>Chính xác · trực tiếp</i> hiển thị Hệ Mặt Trời <b>đúng tỉ lệ thật hoàn toàn</b> — kích thước thiên thể và khoảng cách giữa chúng dùng chung một thước đo, nên Mặt Trời thành một chấm và các hành tinh biến mất giữa khoảng không gần như trống rỗng (Trái Đất cách Mặt Trời khoảng 107 lần đường kính Mặt Trời). Dùng Nén lại để xem tổng quan, dùng Thực tế để cảm nhận tỉ lệ thật.',
    credits: 'Texture hành tinh & sao © Solar System Scope (CC BY 4.0). Bản đồ Sao Diêm Vương & các vệ tinh lớn: NASA/JHUAPL/SwRI & USGS Astrogeology (phạm vi công cộng). Tham số quỹ đạo: NASA/JPL (J2000.0). Mô hình 3D Voyager: NASA/VTAD (phạm vi công cộng). Vị trí Voyager: vector trạng thái NASA/JPL HORIZONS. Dựng bằng three.js.',
  },
};

export function t(key) {
  const tbl = STRINGS[LANG] || STRINGS.en;
  return (tbl[key] != null) ? tbl[key] : (STRINGS.en[key] != null ? STRINGS.en[key] : key);
}

// Date labels used by ui.js's date formatter.
export const DAYS = LANG === 'vi'
  ? ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7']
  : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const MONTHS = LANG === 'vi'
  ? ['Th1', 'Th2', 'Th3', 'Th4', 'Th5', 'Th6', 'Th7', 'Th8', 'Th9', 'Th10', 'Th11', 'Th12']
  : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// ---- Body dataset glossary (Vietnamese) ------------------------------------
const NAMES = {
  sun: 'Mặt Trời', mercury: 'Sao Thủy', venus: 'Sao Kim', earth: 'Trái Đất',
  mars: 'Sao Hỏa', jupiter: 'Sao Mộc', saturn: 'Sao Thổ', uranus: 'Sao Thiên Vương',
  neptune: 'Sao Hải Vương', pluto: 'Sao Diêm Vương', moon: 'Mặt Trăng',
  // Ceres, Haumea, Makemake, Eris, Io, Europa, Ganymede, Callisto, Titan, Triton — proper names kept.
};
const TYPES = {
  'Star': 'Ngôi sao', 'Terrestrial Planet': 'Hành tinh đất đá',
  'Gas Giant': 'Hành tinh khí khổng lồ', 'Ice Giant': 'Hành tinh băng khổng lồ',
  'Dwarf Planet': 'Hành tinh lùn', 'Natural Satellite': 'Vệ tinh tự nhiên',
  'Interstellar Probe': 'Tàu thăm dò liên sao',
};
const INFO_KEYS = {
  'Type': 'Loại', 'Diameter': 'Đường kính', 'Mass': 'Khối lượng',
  'Surface gravity': 'Trọng lực bề mặt', 'Mean density': 'Mật độ trung bình',
  'Core temperature': 'Nhiệt độ lõi', 'Surface temperature': 'Nhiệt độ bề mặt',
  'Rotation period': 'Chu kỳ tự quay', 'Composition': 'Thành phần', 'Age': 'Tuổi',
  'Distance from Sun': 'Khoảng cách tới Mặt Trời', 'Orbital period': 'Chu kỳ quỹ đạo',
  'Axial tilt': 'Độ nghiêng trục', 'Orbital velocity': 'Vận tốc quỹ đạo',
  'Eccentricity': 'Độ lệch tâm', 'Orbital inclination': 'Độ nghiêng quỹ đạo',
  'Surface temp.': 'Nhiệt độ bề mặt', 'Moons': 'Số vệ tinh', 'Atmosphere': 'Khí quyển',
  'Cloud-top temp.': 'Nhiệt độ đỉnh mây', 'Location': 'Vị trí', 'Discovered': 'Phát hiện',
  'Rings': 'Vành đai', 'Distance from Earth': 'Khoảng cách tới Trái Đất', 'Notable': 'Đặc điểm nổi bật',
};

// Overlay Vietnamese onto the shared body objects (mutates in place). No-op for English.
export function applyBodyTranslations(sun, planets, moons, voyagers = []) {
  if (LANG !== 'vi') return;
  const all = [sun, ...planets, ...moons, ...voyagers];
  for (const b of all) {
    if (NAMES[b.id]) b.name = NAMES[b.id];
    if (b.type && TYPES[b.type]) b.type = TYPES[b.type];
    const tr = BODIES_VI[b.id];
    if (tr) {
      if (tr.description) b.description = tr.description;
      if (tr.facts) b.facts = tr.facts;
    }
    if (b.info) {
      const ni = {};
      for (const [k, v] of Object.entries(b.info)) {
        const nk = INFO_KEYS[k] || k;
        const nv = (tr && tr.info && tr.info[k] != null) ? tr.info[k] : v;
        ni[nk] = nv;
      }
      b.info = ni;
    }
  }
}

// Translate the static HTML chrome. No-op for English (the markup is English).
export function applyStaticTranslations() {
  if (LANG !== 'vi') return;
  const $ = (s) => document.querySelector(s);
  const setText = (sel, val) => { const el = $(sel); if (el && val != null) el.textContent = val; };
  const setTitle = (sel, val) => { const el = $(sel); if (el && val != null) el.title = val; };
  const labelOf = (inputId) => { const i = document.getElementById(inputId); return i ? i.parentElement.querySelector('span') : null; };

  document.documentElement.lang = 'vi';
  setText('.brand-title', t('brandTitle'));
  setText('.brand-sub', t('brandSub'));
  setText('#btn-eclipse', t('btnEclipses')); setTitle('#btn-eclipse', t('eclipsesTitle'));
  setText('#btn-view', t('btnView')); setTitle('#btn-view', t('viewTitle'));
  setText('#btn-help', t('btnHelp')); setTitle('#btn-help', t('helpTitle2'));
  setText('#btn-reset-view', t('btnReset')); setTitle('#btn-reset-view', t('resetTitle'));
  setText('#nav-panel .panel-head span', t('explore'));
  setTitle('#btn-nav-toggle', t('collapse'));
  setTitle('#btn-info-toggle', t('collapse'));

  const sB = $('#ecl-go-solar b'), sS = $('#ecl-go-solar small');
  if (sB) sB.textContent = t('eclSolarTitle'); if (sS) sS.textContent = t('eclSolarSub');
  const lB = $('#ecl-go-lunar b'), lS = $('#ecl-go-lunar small');
  if (lB) lB.textContent = t('eclLunarTitle'); if (lS) lS.textContent = t('eclLunarSub');

  setText('#toggles .panel-head span', t('viewOptions'));
  const lbl = (id, key) => { const s = labelOf(id); if (s) s.textContent = ' ' + t(key); };
  lbl('tg-orbits', 'tgOrbits'); lbl('tg-labels', 'tgLabels'); lbl('tg-moons', 'tgMoons');
  lbl('tg-dwarfs', 'tgDwarfs'); lbl('tg-spacecraft', 'tgSpacecraft');
  lbl('tg-belts', 'tgBelts'); lbl('tg-bloom', 'tgBloom');

  // select-row label spans (the <span> that is the first child of each .select-row)
  const rows = document.querySelectorAll('#toggles .select-row > span:first-child');
  if (rows[0]) rows[0].textContent = t('distScale');
  if (rows[1]) rows[1].textContent = t('texQuality');
  if (rows[2]) rows[2].textContent = t('language');
  const distOpts = document.querySelectorAll('#dist-mode option');
  if (distOpts[0]) distOpts[0].textContent = t('distVisual');
  if (distOpts[1]) distOpts[1].textContent = t('distRealistic');
  if (distOpts[2]) distOpts[2].textContent = t('distAccurate');
  const texOpts = document.querySelectorAll('#tex-res option');
  if (texOpts[0]) texOpts[0].textContent = t('tex2k');
  if (texOpts[1]) texOpts[1].textContent = t('tex8k');

  setText('#info-facts-wrap h3', t('didYouKnow'));
  setText('#btn-now', t('now')); setTitle('#btn-now', t('nowTitle'));
  const dateLabel = $('.date-pick');
  if (dateLabel && dateLabel.firstChild && dateLabel.firstChild.nodeType === 3) dateLabel.firstChild.nodeValue = t('goToDate') + ' ';

  // Help panel
  setText('.help-card h2', t('helpHowTo'));
  const hAbout = document.querySelectorAll('.help-card h3');
  if (hAbout[0]) hAbout[0].textContent = t('helpAbout');
  const lis = document.querySelectorAll('.help-card ul li');
  t('help').forEach((html, i) => { if (lis[i]) lis[i].innerHTML = html; });
  const paras = document.querySelectorAll('.help-card > p');
  if (paras[0]) paras[0].innerHTML = t('helpAboutText');
}
