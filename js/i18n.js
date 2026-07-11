// ============================================================================
//  i18n.js  —  Language support (English default, Vietnamese option).
//  The choice is persisted in localStorage and applied on load: UI strings via
//  t()/applyStaticTranslations(), and the body dataset (names, types,
//  descriptions, info tables, facts) by overlaying Vietnamese onto SUN/PLANETS/
//  MOONS/VOYAGERS/BLACK_HOLES before the scene and UI are built.
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
    eclTitleFallback: 'Eclipse',
    eclExit: '✕ Exit eclipse view',
    eclAbout: 'ABOUT',
    eclViewFromEarth: "VIEW FROM EARTH'S SURFACE",
    eclTimeline: 'Eclipse timeline',
    eclModeTotal: 'Total',
    eclModeAnnular: 'Annular',
    eclSolarDetailTitle: 'Solar Eclipse',
    eclSolarDetailType: 'The Moon hides the Sun',
    eclSolarDescHtml: `
      <p>A <b>solar eclipse</b> happens when the <b>Moon passes directly between
      the Sun and the Earth</b>, casting its shadow onto Earth's surface and
      blocking the Sun's light for observers underneath.</p>
      <h3>The shadow has two parts</h3>
      <ul>
        <li><b>Umbra</b> — the dark inner cone. Observers here see a <b>total</b>
        eclipse: the Sun is completely covered and its pearly <b>corona</b> appears.</li>
        <li><b>Penumbra</b> — the lighter outer cone. Observers here see only a
        <b>partial</b> eclipse.</li>
      </ul>
      <h3>Total vs. Annular</h3>
      <p>When the Moon is near perigee (closest) it looks slightly larger than the
      Sun → <b>total eclipse</b>. Near apogee it looks smaller, leaving a bright
      <b>"ring of fire"</b> → <b>annular eclipse</b>. Try the toggle below.</p>
      <h3>Why is it rare?</h3>
      <p>The Moon's orbit is tilted about <b>5°</b> to Earth's orbit, so a perfect
      line-up only occurs at the orbital <i>nodes</i> — roughly twice a year.</p>
      <p class="ecl-warn">⚠ Never look directly at the Sun without certified eclipse
      glasses — only the few minutes of <i>totality</i> are safe to view unaided.</p>`,
    eclLunarDetailTitle: 'Lunar Eclipse',
    eclLunarDetailType: 'The Earth hides the Sun from the Moon',
    eclLunarDescHtml: `
      <p>A <b>lunar eclipse</b> happens when the <b>Earth passes between the Sun
      and a full Moon</b>, so Earth's shadow falls across the Moon.</p>
      <h3>Why does the Moon turn red? 🔴</h3>
      <p>Even inside the umbra the Moon doesn't go black. Sunlight grazing the edge
      of Earth is <b>refracted (bent) through our atmosphere</b>, which scatters
      away blue light and bends the remaining <b>red light</b> onto the Moon — the
      same effect that makes sunsets red. The result is the famous
      <b>"Blood Moon"</b>.</p>
      <h3>Phases</h3>
      <ul>
        <li><b>Penumbral</b> — the Moon dims subtly.</li>
        <li><b>Partial</b> — a dark, curved bite (the umbra) crosses the Moon.</li>
        <li><b>Totality</b> — the whole Moon glows coppery red.</li>
      </ul>
      <h3>Good to know</h3>
      <p>A lunar eclipse is <b>completely safe</b> to watch with the naked eye, can
      last <b>over an hour</b>, and is visible from the entire night side of Earth
      at once.</p>`,
    eclPctCovered: '{pct}% covered',
    eclPctInUmbra: '{pct}% in umbra',
    eclPhaseSolarTotal: '🌑 Totality — corona visible',
    eclPhaseSolarAnnular: '💍 Annularity — “ring of fire”',
    eclPhaseBeforeAfter: 'Before / after eclipse',
    eclPhasePartialBeginning: 'Partial phase (beginning)',
    eclPhasePartialEnding: 'Partial phase (ending)',
    eclPhaseSolarMaxAnnular: '💍 Maximum (annular)',
    eclPhaseSolarMaxTotal: '🌑 Maximum (totality)',
    eclPhaseLunarTotal: '🔴 Totality — Blood Moon',
    eclPhaseLunarPartial: '🌗 Partial (umbral) phase',
    eclPhaseLunarPenumbral: '🌘 Penumbral phase',
    viewOptions: 'VIEW OPTIONS',
    tgOrbits: 'Orbit paths', tgLabels: 'Labels', tgMoons: 'Moons', tgDwarfs: 'Dwarf planets',
    tgBelts: 'Asteroid & Kuiper belts', tgBloom: 'Sun glow (bloom)', tgFullscreen: 'Fullscreen',
    tgSpacecraft: 'Spacecraft (Voyagers)', tgBlackHoles: 'Black holes',
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
    navSpacecraft: '🛰 Spacecraft', navBlackHoles: '◎ Black holes',
    typeStar: 'Star', typeMoon: 'Natural Satellite', typeBlackHole: 'Black-hole system',
    sources: 'Sources & provenance', source: 'Source', sourceEpoch: 'Epoch',
    evidenceMeasured: 'Measured', evidenceDerived: 'Derived', evidenceModel: 'Model assumption',
    bhSourceId: 'Gaia source ID', bhSourceCatalog: 'Source catalog', bhCoordinateFrame: 'Coordinate frame', bhCoordinateEpoch: 'Coordinate epoch',
    bhRightAscension: 'Right ascension', bhDeclination: 'Declination', bhParallax: 'Parallax',
    bhBlackHoleMass: 'Black-hole mass', bhCompanionMass: 'Companion mass', bhCompanionRadius: 'Companion radius',
    bhCompanionTemperature: 'Companion temperature', bhCompanionLuminosity: 'Companion luminosity',
    bhOrbitalPeriod: 'Orbital period', bhEccentricity: 'Eccentricity', bhInclination: 'Inclination',
    bhAscendingNode: 'Longitude of ascending node', bhArgumentPeriastron: 'Argument of periastron',
    bhPeriastronEpoch: 'Periastron epoch', bhSpin: 'Spin', bhSpinUnknown: 'Not measured',
    bhDistance: 'Distance from parallax', bhSemiMajorAxis: 'Relative semi-major axis',
    bhPeriapsis: 'Periastron distance', bhApoapsis: 'Apastron distance',
    bhEventHorizon: 'Event-horizon radius', bhPhotonSphere: 'Photon-sphere radius',
    bhShadowDiameter: 'Distant shadow diameter', bhAngularShadow: 'Shadow diameter from Earth',
    bhAccretionEvidence: 'Accretion evidence', bhNoAccretionDetected: 'No accretion emission detected',
    bhCloseupModel: 'Spacetime model', bhSchwarzschildAssumption: 'Schwarzschild (a*=0 assumed; spin unknown)',
    bhCompactObjectModel: 'Dark-component model',
    bhSingleObjectAssumption: 'One 9.27 M☉ compact object; a tight inner BH+BH pair (P_inner ≲ 1.5 days) is not fully excluded.',
    bhCompactObjectCaveat: 'The close-up assumes one 9.27 M☉ compact object. The favored two-body fit does not fully exclude a tight inner BH+BH pair (P_inner ≲ 1.5 days).',
    bhLocatorScale: 'Interstellar placement', bhDirectionOnly: 'Screen locator · 3D anchor at nominal parallax distance (floating origin)',
    bhUnitDay: 'days',
    bhViewTitle: 'Gaia BH1 · Relativistic view', bhViewSubtitle: 'Detached binary · Schwarzschild close-up',
    bhTravelTitle: 'Navigating the true 3D baseline',
    bhTravelNominal: 'Nominal parallax distance', bhTravelRemaining: 'Remaining camera distance',
    bhTravelNote: 'The camera speed is logarithmically accelerated for navigation. This is not a physical spacecraft speed or elapsed travel-time simulation.',
    bhOverviewTab: 'Binary overview', bhCloseupTab: 'Schwarzschild close-up',
    bhExit: '✕ Exit Gaia BH1', bhResetView: 'Reset view',
    bhPresetEarth: 'From Solar System', bhPresetEinstein: 'Einstein-ring alignment', bhPresetFree: 'Free orbit',
    bhCameraPreset: 'Camera preset', bhSeparation: 'Current separation',
    bhOrbitalPhase: 'Observed orbital phase', bhScale: 'Scene ruler', bhFieldOfView: 'Vertical field of view',
    bhSources: 'Sources & provenance',
    bhOverviewPurposeTitle: 'What this view shows',
    bhOverviewPurpose: 'At the selected observation date, the luminous companion and the unseen compact object orbit their shared centre of mass. After navigating to its nominal parallax-distance anchor, this view resolves the local Gaia BH1 system on the same true AU ruler.',
    bhOverviewEvidence: 'The black hole is not seen directly here: its evidence is the measured motion of the luminous star around a 9.27 M☉ dark mass.',
    bhOverviewLegend: 'Diagram legend', bhLegendCompanion: 'Companion star · physical radius',
    bhLegendBlackHole: 'Dark component · black-hole position', bhLegendBarycentre: 'Shared barycentre',
    bhLegendOrbits: 'Barycentric orbit paths', bhScreenScale: 'On-screen scale at the barycentre',
    bhScreenScaleHint: 'Updates as you zoom; measured at the barycentre.',
    bhSceneBlackHole: 'Black hole · open close-up', bhSceneCompanion: 'G-type companion',
    bhSceneBarycentre: 'Barycentre', bhOpenCloseup: 'Open Schwarzschild close-up',
    bhQuality: 'Render quality', bhQualityAuto: 'Auto', bhQualityHigh: 'High · 1.0×',
    bhQualityMedium: 'Medium · 0.75×', bhQualityLow: 'Low · 0.5×',
    bhObserverZoom: 'Observer radius · scroll/pinch to zoom',
    bhObserverZoomHint: 'Physical dolly range covered by the geodesic table: 6.09–99.91 GM/c².',
    bhObserverDistance: 'Observer distance', bhTimeDilation: 'Proper-time rate dτ/dt',
    bhShadowAngularDiameter: 'Local shadow diameter',
    bhStaticObserverWarning: 'Hypothetical static observer: remaining at this radius requires continuous thrust.',
    bhSkyCaveat: 'ESA Gaia is a display-mapped reference sky seen from the Solar System—not calibrated photometry or the exact local sky at Gaia BH1.',
    bhLoadingLut: 'Loading Schwarzschild ray-mapping table…',
    bhLutReady: 'Null-geodesic ray map ready · ESA/Gaia/DPAC reference sky',
    bhWebgl2Required: 'WebGL2 is unavailable', bhAssetError: 'Unable to load local lensing assets',
    bhWebglFallback: 'Interactive WebGL2 lensing is unavailable. Showing a static frame generated by the same solver.',
    bhOverviewScaleNote: 'The companion, orbit and event horizon share one true-scale ruler. The horizon is rendered at physical size; the locator is needed because it is normally sub-pixel.',
    bhObservedPhaseNote: 'Phase follows the observed ephemeris received in the Solar System, not a simultaneous “now” at Gaia BH1.',
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
      '<b>Focus &amp; follow:</b> double-click a body or its label, choose it in the list, or press <b>Focus &amp; follow</b>. Label double-click also works in fullscreen.',
      '<b>Pause / resume:</b> press <b>Space</b>. <b>Esc</b> stops following.',
      '<b>Time:</b> use the slider, presets, or <b>Now</b>; reverse with ◄◄.',
    ],
    helpAboutText: 'Planet positions are computed from real <b>NASA/JPL J2000 Keplerian orbital elements</b>, so the alignment of the planets matches the chosen date. Axial tilts and rotation periods are physically accurate. The default <i>Compressed</i> view shrinks the distances so every planet is visible together; <i>Realistic</i> and <i>Accurate · live</i> show the Solar System fully <b>true to scale</b> — bodies and the gulfs between them share one ruler, so the Sun becomes a dot and the planets vanish into mostly-empty space (Earth orbits about 107 Sun-widths from the Sun). Use Compressed for an easy overview and Realistic to grasp the real scale.',
    credits: 'Planetary & star textures © Solar System Scope (CC BY 4.0). Pluto & major-moon maps: NASA/JHUAPL/SwRI & USGS Astrogeology (public domain). Orbital elements: NASA/JPL (J2000.0). Voyager model/data: NASA/VTAD & NASA/JPL HORIZONS. Gaia reference sky: ESA/Gaia/DPAC. Schwarzschild beam-tracing method: Eric Bruneton (BSD-3-Clause). Built with three.js.',
  },
  vi: {
    loadingTextures: 'Đang tải texture…',
    brandTitle: 'HỆ MẶT TRỜI', brandSub: 'Mô hình 3D tương tác',
    btnEclipses: '🌒 Nhật/Nguyệt thực', btnView: '⚙ Hiển thị', btnHelp: '? Trợ giúp', btnReset: '⟲ Đặt lại góc nhìn',
    eclipsesTitle: 'Chế độ nhật/nguyệt thực', viewTitle: 'Tùy chọn hiển thị', helpTitle2: 'Trợ giúp', resetTitle: 'Đặt lại camera',
    explore: 'KHÁM PHÁ', collapse: 'Thu gọn', expand: 'Mở rộng chi tiết',
    eclSolarTitle: 'Nhật thực', eclSolarSub: 'Mặt Trăng che khuất Mặt Trời',
    eclLunarTitle: 'Nguyệt thực', eclLunarSub: 'Bóng Trái Đất phủ lên Mặt Trăng',
    eclTitleFallback: 'Nhật/Nguyệt thực',
    eclExit: '✕ Thoát chế độ nhật/nguyệt thực',
    eclAbout: 'GIỚI THIỆU',
    eclViewFromEarth: 'GÓC NHÌN TỪ BỀ MẶT TRÁI ĐẤT',
    eclTimeline: 'Dòng thời gian nhật/nguyệt thực',
    eclModeTotal: 'Toàn phần',
    eclModeAnnular: 'Hình khuyên',
    eclSolarDetailTitle: 'Nhật thực',
    eclSolarDetailType: 'Mặt Trăng che khuất Mặt Trời',
    eclSolarDescHtml: `
      <p><b>Nhật thực</b> xảy ra khi <b>Mặt Trăng đi thẳng giữa Mặt Trời
      và Trái Đất</b>, đổ bóng lên bề mặt Trái Đất và che ánh sáng Mặt Trời
      đối với người quan sát bên dưới.</p>
      <h3>Bóng có hai phần</h3>
      <ul>
        <li><b>Umbra</b> (bóng tối) — nón bóng tối ở giữa. Người quan sát trong
        vùng này thấy <b>nhật thực toàn phần</b>: Mặt Trời bị che hoàn toàn và
        <b>vành nhật hoa</b> sáng ngọc hiện ra.</li>
        <li><b>Penumbra</b> (bóng nửa tối) — nón bóng nhạt bên ngoài. Người quan
        sát ở đây chỉ thấy <b>nhật thực một phần</b>.</li>
      </ul>
      <h3>Toàn phần và hình khuyên</h3>
      <p>Khi Mặt Trăng gần cận địa (gần Trái Đất nhất), nó trông hơi lớn hơn
      Mặt Trời → <b>nhật thực toàn phần</b>. Khi gần viễn địa, nó trông nhỏ hơn,
      để lại một vòng sáng <b>"vòng lửa"</b> → <b>nhật thực hình khuyên</b>.
      Hãy thử nút chuyển bên dưới.</p>
      <h3>Vì sao hiện tượng này hiếm?</h3>
      <p>Quỹ đạo Mặt Trăng nghiêng khoảng <b>5°</b> so với quỹ đạo Trái Đất,
      nên sự thẳng hàng hoàn hảo chỉ xảy ra tại các <i>nút quỹ đạo</i> —
      khoảng hai lần mỗi năm.</p>
      <p class="ecl-warn">⚠ Không bao giờ nhìn trực tiếp vào Mặt Trời nếu không
      có kính xem nhật thực đạt chuẩn — chỉ vài phút <i>toàn phần</i> mới an toàn
      để nhìn bằng mắt thường.</p>`,
    eclLunarDetailTitle: 'Nguyệt thực',
    eclLunarDetailType: 'Trái Đất che ánh sáng Mặt Trời khỏi Mặt Trăng',
    eclLunarDescHtml: `
      <p><b>Nguyệt thực</b> xảy ra khi <b>Trái Đất nằm giữa Mặt Trời và
      trăng tròn</b>, khiến bóng Trái Đất quét qua Mặt Trăng.</p>
      <h3>Vì sao Mặt Trăng chuyển đỏ? 🔴</h3>
      <p>Ngay cả trong vùng umbra, Mặt Trăng không tối đen. Ánh sáng Mặt Trời
      lướt qua rìa Trái Đất bị <b>khúc xạ (bẻ cong) qua khí quyển</b>; khí quyển
      tán xạ bớt ánh sáng xanh và bẻ phần <b>ánh sáng đỏ</b> còn lại lên
      Mặt Trăng — cùng hiệu ứng làm hoàng hôn có màu đỏ. Kết quả là hiện tượng
      <b>"Trăng máu"</b> nổi tiếng.</p>
      <h3>Các pha</h3>
      <ul>
        <li><b>Nửa tối</b> — Mặt Trăng mờ đi rất nhẹ.</li>
        <li><b>Một phần</b> — một mảng tối cong (umbra) quét qua Mặt Trăng.</li>
        <li><b>Toàn phần</b> — toàn bộ Mặt Trăng ánh đỏ màu đồng.</li>
      </ul>
      <h3>Điều nên biết</h3>
      <p>Nguyệt thực <b>hoàn toàn an toàn</b> khi quan sát bằng mắt thường, có thể
      kéo dài <b>hơn một giờ</b>, và nhìn thấy đồng thời từ toàn bộ nửa Trái Đất
      đang là ban đêm.</p>`,
    eclPctCovered: '{pct}% bị che khuất',
    eclPctInUmbra: '{pct}% trong bóng tối',
    eclPhaseSolarTotal: '🌑 Toàn phần — thấy vành nhật hoa',
    eclPhaseSolarAnnular: '💍 Hình khuyên — “vòng lửa”',
    eclPhaseBeforeAfter: 'Trước / sau thực',
    eclPhasePartialBeginning: 'Pha một phần (bắt đầu)',
    eclPhasePartialEnding: 'Pha một phần (kết thúc)',
    eclPhaseSolarMaxAnnular: '💍 Cực đại (hình khuyên)',
    eclPhaseSolarMaxTotal: '🌑 Cực đại (toàn phần)',
    eclPhaseLunarTotal: '🔴 Toàn phần — Trăng máu',
    eclPhaseLunarPartial: '🌗 Pha một phần (vùng bóng tối)',
    eclPhaseLunarPenumbral: '🌘 Pha nửa tối',
    viewOptions: 'TÙY CHỌN HIỂN THỊ',
    tgOrbits: 'Đường quỹ đạo', tgLabels: 'Nhãn tên', tgMoons: 'Vệ tinh', tgDwarfs: 'Hành tinh lùn',
    tgBelts: 'Vành đai tiểu hành tinh & Kuiper', tgBloom: 'Quầng sáng Mặt Trời', tgFullscreen: 'Toàn màn hình',
    tgSpacecraft: 'Tàu vũ trụ (Voyager)', tgBlackHoles: 'Hố đen',
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
    navSpacecraft: '🛰 Tàu vũ trụ', navBlackHoles: '◎ Hố đen',
    typeStar: 'Ngôi sao', typeMoon: 'Vệ tinh tự nhiên', typeBlackHole: 'Hệ chứa hố đen',
    sources: 'Nguồn & xuất xứ dữ liệu', source: 'Nguồn', sourceEpoch: 'Kỷ nguyên',
    evidenceMeasured: 'Đo được', evidenceDerived: 'Suy ra', evidenceModel: 'Giả định mô hình',
    bhSourceId: 'Mã nguồn Gaia', bhSourceCatalog: 'Danh mục nguồn', bhCoordinateFrame: 'Hệ tọa độ', bhCoordinateEpoch: 'Kỷ nguyên tọa độ',
    bhRightAscension: 'Xích kinh', bhDeclination: 'Xích vĩ', bhParallax: 'Thị sai',
    bhBlackHoleMass: 'Khối lượng hố đen', bhCompanionMass: 'Khối lượng sao đồng hành', bhCompanionRadius: 'Bán kính sao đồng hành',
    bhCompanionTemperature: 'Nhiệt độ sao đồng hành', bhCompanionLuminosity: 'Độ sáng sao đồng hành',
    bhOrbitalPeriod: 'Chu kỳ quỹ đạo', bhEccentricity: 'Độ lệch tâm', bhInclination: 'Độ nghiêng',
    bhAscendingNode: 'Kinh độ nút lên', bhArgumentPeriastron: 'Đối số cận điểm',
    bhPeriastronEpoch: 'Kỷ nguyên cận điểm', bhSpin: 'Tham số spin', bhSpinUnknown: 'Chưa đo được',
    bhDistance: 'Khoảng cách suy ra từ thị sai', bhSemiMajorAxis: 'Bán trục lớn tương đối',
    bhPeriapsis: 'Khoảng cách cận điểm', bhApoapsis: 'Khoảng cách viễn điểm',
    bhEventHorizon: 'Bán kính chân trời sự kiện', bhPhotonSphere: 'Bán kính quang cầu',
    bhShadowDiameter: 'Đường kính bóng khi quan sát từ xa', bhAngularShadow: 'Đường kính góc của bóng từ Trái Đất',
    bhAccretionEvidence: 'Bằng chứng bồi tụ', bhNoAccretionDetected: 'Chưa phát hiện phát xạ bồi tụ',
    bhCloseupModel: 'Mô hình không-thời gian', bhSchwarzschildAssumption: 'Schwarzschild (giả định a*=0; chưa biết spin)',
    bhCompactObjectModel: 'Mô hình thành phần tối',
    bhSingleObjectAssumption: 'Một vật thể đặc 9,27 M☉; chưa loại trừ hoàn toàn một cặp BH+BH rất sít (P_inner ≲ 1,5 ngày).',
    bhCompactObjectCaveat: 'Cận cảnh giả định một vật thể đặc 9,27 M☉. Nghiệm hai vật thể được ưu tiên nhưng chưa loại trừ hoàn toàn một cặp BH+BH rất sít (P_inner ≲ 1,5 ngày).',
    bhLocatorScale: 'Vị trí liên sao', bhDirectionOnly: 'Locator trên màn hình · neo 3D ở khoảng cách thị sai danh định (floating origin)',
    bhUnitDay: 'ngày',
    bhViewTitle: 'Gaia BH1 · Góc nhìn tương đối tính', bhViewSubtitle: 'Hệ đôi tách rời · cận cảnh Schwarzschild',
    bhTravelTitle: 'Đang di chuyển trên khoảng cách 3D đúng tỉ lệ',
    bhTravelNominal: 'Khoảng cách thị sai danh định', bhTravelRemaining: 'Khoảng cách camera còn lại',
    bhTravelNote: 'Tốc độ camera được tăng theo log để điều hướng. Đây không phải vận tốc tàu vũ trụ hay mô phỏng thời gian bay vật lý.',
    bhOverviewTab: 'Tổng quan hệ đôi', bhCloseupTab: 'Cận cảnh Schwarzschild',
    bhExit: '✕ Thoát Gaia BH1', bhResetView: 'Đặt lại góc nhìn',
    bhPresetEarth: 'Từ Hệ Mặt Trời', bhPresetEinstein: 'Thẳng hàng vòng Einstein', bhPresetFree: 'Quỹ đạo tự do',
    bhCameraPreset: 'Góc camera cài sẵn', bhSeparation: 'Khoảng cách hiện tại',
    bhOrbitalPhase: 'Pha quỹ đạo quan sát được', bhScale: 'Thước đo scene', bhFieldOfView: 'Trường nhìn dọc',
    bhSources: 'Nguồn & xuất xứ dữ liệu',
    bhOverviewPurposeTitle: 'Sơ đồ này cho biết gì?',
    bhOverviewPurpose: 'Ở ngày quan sát đã chọn, sao đồng hành phát sáng và vật thể đặc không nhìn thấy cùng quay quanh khối tâm chung. Sau khi di chuyển tới neo ở khoảng cách thị sai danh định, góc nhìn này phân giải hệ Gaia BH1 cục bộ trên cùng thước AU thật.',
    bhOverviewEvidence: 'Hố đen không được nhìn thấy trực tiếp ở đây: bằng chứng là chuyển động đã đo của ngôi sao sáng quanh một khối lượng tối 9,27 M☉.',
    bhOverviewLegend: 'Chú giải sơ đồ', bhLegendCompanion: 'Sao đồng hành · bán kính vật lý',
    bhLegendBlackHole: 'Thành phần tối · vị trí hố đen', bhLegendBarycentre: 'Khối tâm chung',
    bhLegendOrbits: 'Quỹ đạo quanh khối tâm', bhScreenScale: 'Thước màn hình tại khối tâm',
    bhScreenScaleHint: 'Tự đổi khi zoom; đo tại khối tâm.',
    bhSceneBlackHole: 'Hố đen · mở cận cảnh', bhSceneCompanion: 'Sao đồng hành loại G',
    bhSceneBarycentre: 'Khối tâm', bhOpenCloseup: 'Mở cận cảnh Schwarzschild',
    bhQuality: 'Chất lượng dựng hình', bhQualityAuto: 'Tự động', bhQualityHigh: 'Cao · 1,0×',
    bhQualityMedium: 'Trung bình · 0,75×', bhQualityLow: 'Thấp · 0,5×',
    bhObserverZoom: 'Bán kính người quan sát · lăn/chụm để zoom',
    bhObserverZoomHint: 'Miền dolly vật lý của bảng tia trắc địa: 6,09–99,91 GM/c².',
    bhObserverDistance: 'Khoảng cách người quan sát', bhTimeDilation: 'Tốc độ thời gian riêng dτ/dt',
    bhShadowAngularDiameter: 'Đường kính góc cục bộ của bóng',
    bhStaticObserverWarning: 'Người quan sát đứng yên là giả định: để giữ vị trí ở bán kính này cần lực đẩy liên tục.',
    bhSkyCaveat: 'Bầu trời ESA Gaia là ảnh tham chiếu đã ánh xạ hiển thị từ Hệ Mặt Trời—không phải phép đo quang chuẩn hay bầu trời cục bộ chính xác tại Gaia BH1.',
    bhLoadingLut: 'Đang tải bảng ánh xạ tia Schwarzschild…',
    bhLutReady: 'Bản đồ tia trắc địa ánh sáng đã sẵn sàng · bầu trời tham chiếu ESA/Gaia/DPAC',
    bhWebgl2Required: 'Không có WebGL2', bhAssetError: 'Không thể tải tài nguyên lensing cục bộ',
    bhWebglFallback: 'Không có lensing WebGL2 tương tác. Đang hiển thị khung hình tĩnh được tạo bởi cùng bộ giải.',
    bhOverviewScaleNote: 'Sao đồng hành, quỹ đạo và chân trời sự kiện dùng chung một thước đo thật. Chân trời được dựng đúng kích thước vật lý; locator vẫn cần thiết vì nó thường nhỏ hơn một pixel.',
    bhObservedPhaseNote: 'Pha theo ephemeris quan sát được tại Hệ Mặt Trời, không phải trạng thái “hiện tại” đồng thời ở Gaia BH1.',
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
      '<b>Lấy nét &amp; bám theo:</b> nhấn đúp vào thiên thể hoặc nhãn tên của nó, chọn trong danh sách, hoặc nhấn <b>Lấy nét &amp; bám theo</b>. Nhấn đúp nhãn tên dùng được cả trong chế độ toàn màn hình.',
      '<b>Tạm dừng / tiếp tục:</b> nhấn <b>Space</b>. <b>Esc</b> để dừng bám theo.',
      '<b>Thời gian:</b> dùng thanh trượt, nút cài sẵn, hoặc <b>Hiện tại</b>; tua ngược bằng ◄◄.',
    ],
    helpAboutText: 'Vị trí các hành tinh được tính từ <b>tham số quỹ đạo Kepler J2000 thật của NASA/JPL</b>, nên sự sắp xếp của các hành tinh khớp với ngày đã chọn. Độ nghiêng trục và chu kỳ tự quay đều chính xác về mặt vật lý. Chế độ <i>Nén lại</i> mặc định thu nhỏ khoảng cách để mọi hành tinh cùng nằm trong tầm nhìn; còn <i>Thực tế</i> và <i>Chính xác · trực tiếp</i> hiển thị Hệ Mặt Trời <b>đúng tỉ lệ thật hoàn toàn</b> — kích thước thiên thể và khoảng cách giữa chúng dùng chung một thước đo, nên Mặt Trời thành một chấm và các hành tinh biến mất giữa khoảng không gần như trống rỗng (Trái Đất cách Mặt Trời khoảng 107 lần đường kính Mặt Trời). Dùng Nén lại để xem tổng quan, dùng Thực tế để cảm nhận tỉ lệ thật.',
    credits: 'Texture hành tinh & sao © Solar System Scope (CC BY 4.0). Bản đồ Sao Diêm Vương & các vệ tinh lớn: NASA/JHUAPL/SwRI & USGS Astrogeology (phạm vi công cộng). Tham số quỹ đạo: NASA/JPL (J2000.0). Mô hình/dữ liệu Voyager: NASA/VTAD & NASA/JPL HORIZONS. Bầu trời Gaia: ESA/Gaia/DPAC. Phương pháp beam tracing Schwarzschild: Eric Bruneton (BSD-3-Clause). Dựng bằng three.js.',
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
  'gaia-bh1': 'Gaia BH1',
  // Ceres, Haumea, Makemake, Eris, Io, Europa, Ganymede, Callisto, Titan, Triton — proper names kept.
};
const TYPES = {
  'Star': 'Ngôi sao', 'Terrestrial Planet': 'Hành tinh đất đá',
  'Gas Giant': 'Hành tinh khí khổng lồ', 'Ice Giant': 'Hành tinh băng khổng lồ',
  'Dwarf Planet': 'Hành tinh lùn', 'Natural Satellite': 'Vệ tinh tự nhiên',
  'Interstellar Probe': 'Tàu thăm dò liên sao',
  'Black-hole system': 'Hệ chứa hố đen',
  'Dormant black-hole binary': 'Hệ đôi chứa hố đen đang ngủ',
  'Dormant stellar-mass black hole binary': 'Hệ đôi chứa hố đen khối lượng sao đang ngủ',
  'Black Hole Binary': 'Hệ đôi chứa hố đen',
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
  'Status': 'Trạng thái', 'Gaia DR3 source': 'Nguồn Gaia DR3',
  'Direction (ICRS, J2016.0)': 'Hướng (ICRS, J2016.0)', 'Distance': 'Khoảng cách',
  'Companion': 'Sao đồng hành', 'Accretion': 'Bồi tụ', 'Orrery locator': 'Locator trong orrery',
  'Source ID': 'Mã nguồn', 'Coordinates': 'Tọa độ', 'Coordinate epoch': 'Kỷ nguyên tọa độ',
  'Right ascension': 'Xích kinh', 'Declination': 'Xích vĩ', 'Parallax': 'Thị sai',
  'Black-hole mass': 'Khối lượng hố đen', 'Black hole mass': 'Khối lượng hố đen',
  'Companion mass': 'Khối lượng sao đồng hành', 'Companion radius': 'Bán kính sao đồng hành',
  'Companion temperature': 'Nhiệt độ sao đồng hành', 'Companion luminosity': 'Độ sáng sao đồng hành',
  'Inclination': 'Độ nghiêng', 'Longitude of ascending node': 'Kinh độ nút lên',
  'Argument of periastron': 'Đối số cận điểm', 'Periastron epoch': 'Kỷ nguyên cận điểm',
  'Relative semi-major axis': 'Bán trục lớn tương đối', 'Periastron distance': 'Khoảng cách cận điểm',
  'Apastron distance': 'Khoảng cách viễn điểm', 'Event-horizon radius': 'Bán kính chân trời sự kiện',
  'Event horizon radius': 'Bán kính chân trời sự kiện', 'Photon-sphere radius': 'Bán kính quang cầu',
  'Photon sphere radius': 'Bán kính quang cầu', 'Distant shadow diameter': 'Đường kính bóng khi quan sát từ xa',
  'Spin': 'Tham số spin', 'Accretion evidence': 'Bằng chứng bồi tụ', 'Locator scale': 'Tỉ lệ locator',
  'Close-up model': 'Mô hình cận cảnh',
};

// Overlay Vietnamese onto the shared body objects (mutates in place). No-op for English.
export function applyBodyTranslations(sun, planets = [], moons = [], voyagers = [], blackHoles = []) {
  if (LANG !== 'vi') return;
  const all = [sun, ...planets, ...moons, ...voyagers, ...blackHoles].filter(Boolean);
  for (const b of all) {
    if (NAMES[b.id]) b.name = NAMES[b.id];
    const tr = BODIES_VI[b.id];
    if (b.type && tr && tr.type) b.type = tr.type;
    else if (b.type && TYPES[b.type]) b.type = TYPES[b.type];
    if (tr) {
      if (tr.description) b.description = tr.description;
      if (tr.facts) b.facts = tr.facts;
    }
    if (b.info) {
      const ni = {};
      for (const [k, v] of Object.entries(b.info)) {
        const nk = INFO_KEYS[k] || k;
        let nv = (tr && tr.info && tr.info[k] != null) ? tr.info[k] : v;
        // Rich info entries carry numerical values, uncertainty and provenance.
        // Keep those machine-readable fields and add a localized display value.
        if (v && typeof v === 'object' && !Array.isArray(v) && nv !== v) {
          nv = (nv && typeof nv === 'object' && !Array.isArray(nv))
            ? { ...v, ...nv }
            : { ...v, display: nv };
        }
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
  lbl('tg-black-holes', 'tgBlackHoles');
  lbl('tg-belts', 'tgBelts'); lbl('tg-bloom', 'tgBloom'); lbl('tg-fullscreen', 'tgFullscreen');

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
