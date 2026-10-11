/* GÖLGE MUHAFIZLARI — static content & constants (owner: data).  Namespace: GM.D
 *
 * Pure data + a few tiny pure helpers. No DOM, no calls into other modules.
 * Every id / field name here follows SPEC.md §2 to the letter; extra fields (lore, colours, per-level
 * number tables, helpers) are additive and optional for other modules.
 */
(function (GM) {
  'use strict';

  var D = {};
  D.VERSION = 1;

  /* ============================================================================================
   * 2.1 Palette (same hexes as css/base.css)
   * ========================================================================================== */
  D.PAL = {
    bg0: '#09070D', bg1: '#120E19', bg2: '#1A1424', bg3: '#241B31', line: '#3B2E50', tx: '#F4EEFF',
    tx2: '#BDB1D6', gold: '#FFCB57', gold2: '#E39A2D', blood: '#E8394D', ember: '#FF7A2F', violet: '#9D6BFF',
    teal: '#3EDBC8', green: '#5BD16E', blue: '#4BA3FF', outline: '#120C18'
  };

  /* ============================================================================================
   * 2.2 Rarities (index = rarity number)
   * ========================================================================================== */
  D.RARITIES = [
    { id: 'siradan',  n: 'Sıradan',  col: '#A7ADB7', dark: '#5D6370', mult: 1.00, maxLv: 10, subs: 0, glow: 0 },
    { id: 'iyi',      n: 'İyi',      col: '#5BD16E', dark: '#2C7A3A', mult: 1.30, maxLv: 20, subs: 1, glow: 0 },
    { id: 'nadir',    n: 'Nadir',    col: '#4BA3FF', dark: '#1F5DA8', mult: 1.70, maxLv: 30, subs: 2, glow: 0.3 },
    { id: 'destansi', n: 'Destansı', col: '#B565FF', dark: '#6A2BB0', mult: 2.25, maxLv: 40, subs: 3, glow: 0.6 },
    { id: 'efsanevi', n: 'Efsanevi', col: '#FFB020', dark: '#A8620A', mult: 3.00, maxLv: 50, subs: 3, glow: 0.85 },
    { id: 'mitik',    n: 'Mitik',    col: '#FF3D4F', dark: '#8E1324', mult: 4.00, maxLv: 60, subs: 4, glow: 1.0 }
  ];

  /* ============================================================================================
   * 2.3 Equipment slots (UI order).  main value = base * RARITIES[rar].mult * (1 + grow * (lvl - 1))
   * ========================================================================================== */
  D.SLOTS = [
    { id: 'silah',    n: 'Silah',    poss: 'Silahı',     group: 'silah', main: 'atk',    base: 30,    grow: 0.12 },
    { id: 'kafa',     n: 'Miğfer',   poss: 'Miğferi',    group: 'zirh',  main: 'hp',     base: 90,    grow: 0.10 },
    { id: 'yuz',      n: 'Maske',    poss: 'Maskesi',    group: 'taki',  main: 'crit',   base: 0.015, grow: 0.04 },
    { id: 'boyun',    n: 'Kolye',    poss: 'Kolyesi',    group: 'taki',  main: 'atk',    base: 12,    grow: 0.12 },
    { id: 'omuz',     n: 'Omuzluk',  poss: 'Omuzluğu',   group: 'zirh',  main: 'def',    base: 8,     grow: 0.10 },
    { id: 'gogus',    n: 'Göğüslük', poss: 'Göğüslüğü',  group: 'zirh',  main: 'hp',     base: 140,   grow: 0.10 },
    { id: 'kol',      n: 'Kolluk',   poss: 'Kolluğu',    group: 'zirh',  main: 'def',    base: 6,     grow: 0.10 },
    { id: 'eldiven',  n: 'Eldiven',  poss: 'Eldiveni',   group: 'zirh',  main: 'atk',    base: 10,    grow: 0.12 },
    { id: 'kemer',    n: 'Kemer',    poss: 'Kemeri',     group: 'zirh',  main: 'hp',     base: 70,    grow: 0.10 },
    { id: 'pantolon', n: 'Pantolon', poss: 'Pantolonu',  group: 'zirh',  main: 'hp',     base: 100,   grow: 0.10 },
    { id: 'dizlik',   n: 'Dizlik',   poss: 'Dizliği',    group: 'zirh',  main: 'def',    base: 7,     grow: 0.10 },
    { id: 'ayak',     n: 'Çizme',    poss: 'Çizmesi',    group: 'zirh',  main: 'spdPct', base: 0.03,  grow: 0.03 }
  ];
  D.SLOT_IDS = D.SLOTS.map(function (s) { return s.id; });
  D.ARMOR_SLOTS = D.SLOT_IDS.filter(function (id) { return id !== 'silah'; });
  /* scroll groups (GM.S.p.scrolls keys) */
  D.SCROLL_GROUPS = {
    silah: { id: 'silah', n: 'Silah Parşömeni', col: '#FF7A2F' },
    zirh:  { id: 'zirh',  n: 'Zırh Parşömeni',  col: '#4BA3FF' },
    taki:  { id: 'taki',  n: 'Takı Parşömeni',  col: '#B565FF' }
  };

  /* ============================================================================================
   * 2.4 Weapon types — every hero can use every type
   * ========================================================================================== */
  D.WEAPONS = {
    kilic: { id: 'kilic', n: 'Kılıç', desc: 'Önündeki yayda geniş bir kesik atar.',        range: 95,  cd: 0.75, kind: 'melee',  icon: 'sword' },
    yay:   { id: 'yay',   n: 'Yay',   desc: 'En yakın düşmana delip geçen oklar atar.',     range: 520, cd: 0.60, kind: 'ranged', icon: 'bow' },
    orak:  { id: 'orak',  n: 'Orak',  desc: 'Etrafında tam tur dönen ağır bir savuruş.',     range: 115, cd: 1.30, kind: 'melee',  icon: 'scythe' },
    asa:   { id: 'asa',   n: 'Asa',   desc: 'Hedef arayan, patlayan büyü küreleri.',         range: 480, cd: 0.90, kind: 'ranged', icon: 'staff' }
  };
  D.WEAPON_IDS = ['kilic', 'yay', 'orak', 'asa'];

  /* item display names by weapon type × rarity */
  D.WEAPON_NAMES = {
    kilic: ['Paslı Kılıç',    'Demir Kılıç',  'Gece Kılıcı',   'Kor Kılıç',  'Ejder Dişi',    'Kıyamet'],
    yay:   ['Budaklı Yay',    'Avcı Yayı',    'Baykuş Yayı',   'Kor Yay',    'Ejder Kanadı',  'Ay Tutulması'],
    orak:  ['Kırık Orak',     'Demir Orak',   'Mezar Orağı',   'Kan Orağı',  'Ölüm Hasadı',   'Ecel'],
    asa:   ['Budaklı Değnek', 'Çırak Asası',  'Fırtına Asası', 'Kor Asa',    'Yıldız Kalbi',  'Sonsuzluk']
  };

  /* ============================================================================================
   * 2.5 Armor sets (the set gives the shape/motif). Bonus counts armor slots only.
   * ========================================================================================== */
  D.SETS = {
    kurt:  { id: 'kurt',  n: 'Kurt Postu',   motif: 'leather+fur, brown/tan',                 bonus: { 4: { hpPct: 0.08 },    8: { spdPct: 0.06 } },
             col: '#8A5A3A', lore: 'Kara Orman avcılarının sıcak, sağlam kürk zırhı.' },
    gece:  { id: 'gece',  n: 'Gece Bekçisi', motif: 'dark steel + navy cloth, rivets',        bonus: { 4: { defPct: 0.10 },   8: { crit: 0.05 } },
             col: '#2E3F66', lore: 'Sur nöbetçilerinin perçinli, lacivert çelik takımı.' },
    kor:   { id: 'kor',   n: 'Kor Şövalye',  motif: 'blackened plate, glowing ember cracks',  bonus: { 4: { atkPct: 0.08 },   8: { e_ates: 0.20 } },
             col: '#FF7A2F', lore: 'Kor Dağı’nda dövülmüş; çatlaklarından hâlâ kor sızan kara plaka.' },
    ejder: { id: 'ejder', n: 'Ejder Pulu',   motif: 'crimson scales + gold trim, small horns', bonus: { 4: { critDmg: 0.25 }, 8: { skillDmg: 0.15 } },
             col: '#C8283C', lore: 'Kızıl ejder pullarından örülmüş, altın işlemeli efsanevi zırh.' },
    golge: { id: 'golge', n: 'Gölge Kralı',  motif: 'obsidian, violet/red runes, smoke wisps', bonus: { 4: { lifesteal: 0.04 }, 8: { atkPct: 0.15 } },
             col: '#9D6BFF', lore: 'Obsidyenden yontulmuş, rünleri nabız gibi atan lanetli kraliyet zırhı.' }
  };
  D.SET_IDS = ['kurt', 'gece', 'kor', 'ejder', 'golge'];
  D.SET_BY_RARITY = [['kurt'], ['kurt', 'gece'], ['gece', 'kor'], ['kor', 'ejder'], ['ejder', 'golge'], ['golge']];

  /* ============================================================================================
   * 2.7 Stat keys + labels (the ONLY modifier keys allowed anywhere)
   * ========================================================================================== */
  D.STAT_KEYS = [
    'atk', 'hp', 'def',
    'atkPct', 'hpPct', 'defPct',
    'crit', 'critDmg', 'spdPct', 'cdr', 'lifesteal', 'regen', 'pickup', 'xpGain', 'goldGain', 'area',
    'projCount', 'pierce', 'dur', 'eliteDmg', 'bossDmg', 'skillDmg',
    'w_kilic', 'w_yay', 'w_orak', 'w_asa',
    'e_ates', 'e_buz', 'e_yildirim', 'e_zehir', 'e_golge',
    'dodge', 'ultCharge', 'ultDmg', 'revive', 'startLvl', 'execute', 'thorns', 'shieldStart', 'killHeal'
  ];
  /* n = UI label, fmt = 'pct' (fraction shown as %) | 'flat' | 'int', u = optional unit suffix, d = tooltip */
  D.STAT_LABELS = {
    atk:         { n: 'Saldırı',            fmt: 'flat', d: 'Bütün hasarın temeli.' },
    hp:          { n: 'Can',                fmt: 'flat', d: 'En yüksek can.' },
    def:         { n: 'Savunma',            fmt: 'flat', d: 'Alınan hasarı azaltır.' },
    atkPct:      { n: 'Saldırı %',          fmt: 'pct',  d: 'Toplam saldırıyı yüzde olarak artırır.' },
    hpPct:       { n: 'Can %',              fmt: 'pct',  d: 'Toplam canı yüzde olarak artırır.' },
    defPct:      { n: 'Savunma %',          fmt: 'pct',  d: 'Toplam savunmayı yüzde olarak artırır.' },
    crit:        { n: 'Kritik Şansı',       fmt: 'pct',  d: 'Temel %5’e eklenir.' },
    critDmg:     { n: 'Kritik Hasarı',      fmt: 'pct',  d: 'Temel %150 kritik çarpanına eklenir.' },
    spdPct:      { n: 'Hareket Hızı',       fmt: 'pct',  d: 'Savaşta daha hızlı koşarsın.' },
    cdr:         { n: 'Bekleme Azaltma',    fmt: 'pct',  d: 'Silah ve yetenek bekleme süreleri kısalır (en fazla %50).' },
    lifesteal:   { n: 'Can Çalma',          fmt: 'pct',  d: 'Verdiğin hasarın bir kısmı can olarak döner (en fazla %20).' },
    regen:       { n: 'Can Yenileme',       fmt: 'flat', u: '/sn', d: 'Her saniye yenilenen can.' },
    pickup:      { n: 'Toplama Alanı',      fmt: 'pct',  d: 'Tecrübe taşlarını ve altını daha uzaktan çekersin.' },
    xpGain:      { n: 'Tecrübe Kazancı',    fmt: 'pct',  d: 'Savaşta daha hızlı seviye atlarsın.' },
    goldGain:    { n: 'Altın Kazancı',      fmt: 'pct',  d: 'Toplanan altın artar.' },
    area:        { n: 'Etki Alanı',         fmt: 'pct',  d: 'Bütün alan, yay ve yarıçap boyutları büyür.' },
    projCount:   { n: 'Mermi Sayısı',       fmt: 'int',  d: 'Silahın ve mermi atan yeteneklerin ek mermi fırlatır.' },
    pierce:      { n: 'Delip Geçme',        fmt: 'int',  d: 'Mermiler ek düşmanları delip geçer.' },
    dur:         { n: 'Etki Süresi',        fmt: 'pct',  d: 'Yetenek etkileri daha uzun sürer.' },
    eliteDmg:    { n: 'Elit Hasarı',        fmt: 'pct',  d: 'Elit düşmanlara verilen hasar.' },
    bossDmg:     { n: 'Boss Hasarı',        fmt: 'pct',  d: 'Bosslara verilen hasar.' },
    skillDmg:    { n: 'Yetenek Hasarı',     fmt: 'pct',  d: 'Bütün savaş yeteneklerinin hasarı.' },
    w_kilic:     { n: 'Kılıç Hasarı',       fmt: 'pct',  d: 'Ana silah kılıçken verilen hasar.' },
    w_yay:       { n: 'Yay Hasarı',         fmt: 'pct',  d: 'Ana silah yayken verilen hasar.' },
    w_orak:      { n: 'Orak Hasarı',        fmt: 'pct',  d: 'Ana silah orakken verilen hasar.' },
    w_asa:       { n: 'Asa Hasarı',         fmt: 'pct',  d: 'Ana silah asayken verilen hasar.' },
    e_ates:      { n: 'Ateş Hasarı',        fmt: 'pct',  d: 'Ateş yeteneklerinin hasarı.' },
    e_buz:       { n: 'Buz Hasarı',         fmt: 'pct',  d: 'Buz yeteneklerinin hasarı.' },
    e_yildirim:  { n: 'Yıldırım Hasarı',    fmt: 'pct',  d: 'Yıldırım yeteneklerinin hasarı.' },
    e_zehir:     { n: 'Zehir Hasarı',       fmt: 'pct',  d: 'Zehir yeteneklerinin hasarı.' },
    e_golge:     { n: 'Gölge Hasarı',       fmt: 'pct',  d: 'Gölge yeteneklerinin hasarı.' },
    dodge:       { n: 'Kaçınma',            fmt: 'pct',  d: 'Bir saldırıdan tamamen kaçma şansı (en fazla %40).' },
    ultCharge:   { n: 'Nihai Dolum Hızı',   fmt: 'pct',  d: 'Nihai güç daha hızlı dolar.' },
    ultDmg:      { n: 'Nihai Hasarı',       fmt: 'pct',  d: 'Nihai gücün hasarı.' },
    revive:      { n: 'Diriliş',            fmt: 'int',  d: 'Ölünce canının %50’siyle ayağa kalkarsın.' },
    startLvl:    { n: 'Başlangıç Seviyesi', fmt: 'int',  d: 'Savaşa bedava seviye atlamalarıyla başlarsın.' },
    execute:     { n: 'İnfaz Eşiği',        fmt: 'pct',  d: 'Canı bu oranın altına düşen (boss olmayan) düşmanlar anında ölür.' },
    thorns:      { n: 'Diken Hasarı',       fmt: 'pct',  d: 'Aldığın hasarın bu kadarı saldırana geri döner.' },
    shieldStart: { n: 'Başlangıç Kalkanı',  fmt: 'flat', d: 'Savaşa bu kadar kalkanla başlarsın.' },
    killHeal:    { n: 'Öldürünce Can',      fmt: 'flat', d: 'Her öldürmede yenilenen can.' }
  };

  /* elements of run skills (e_<el> keys) */
  D.ELEMENTS = {
    none:     { id: 'none',     n: 'Fiziksel', col: '#C9CED8' },
    ates:     { id: 'ates',     n: 'Ateş',     col: '#FF7A2F' },
    buz:      { id: 'buz',      n: 'Buz',      col: '#7FD8FF' },
    yildirim: { id: 'yildirim', n: 'Yıldırım', col: '#FFE45C' },
    zehir:    { id: 'zehir',    n: 'Zehir',    col: '#8BE04E' },
    golge:    { id: 'golge',    n: 'Gölge',    col: '#9D6BFF' }
  };

  /* ============================================================================================
   * 2.6 Substats — rolled once on item creation, count = RARITIES[rar].subs, distinct keys,
   * uniform in [min[rar], max[rar]].  Fractions for pct keys; regen is flat HP/s.
   * ========================================================================================== */
  D.SUBSTATS = [
    { k: 'atkPct',    n: 'Saldırı %',       fmt: 'pct',  min: [0.020, 0.030, 0.040, 0.050, 0.070, 0.090], max: [0.030, 0.050, 0.060, 0.080, 0.100, 0.130] },
    { k: 'hpPct',     n: 'Can %',           fmt: 'pct',  min: [0.020, 0.030, 0.040, 0.050, 0.070, 0.090], max: [0.040, 0.050, 0.070, 0.090, 0.120, 0.150] },
    { k: 'defPct',    n: 'Savunma %',       fmt: 'pct',  min: [0.020, 0.030, 0.050, 0.060, 0.080, 0.100], max: [0.040, 0.060, 0.080, 0.100, 0.130, 0.160] },
    { k: 'crit',      n: 'Kritik Şansı',    fmt: 'pct',  min: [0.005, 0.010, 0.015, 0.020, 0.025, 0.030], max: [0.010, 0.015, 0.020, 0.030, 0.040, 0.050] },
    { k: 'critDmg',   n: 'Kritik Hasarı',   fmt: 'pct',  min: [0.030, 0.050, 0.070, 0.090, 0.120, 0.150], max: [0.050, 0.080, 0.110, 0.140, 0.180, 0.240] },
    { k: 'spdPct',    n: 'Hareket Hızı',    fmt: 'pct',  min: [0.010, 0.015, 0.020, 0.025, 0.030, 0.040], max: [0.020, 0.025, 0.030, 0.040, 0.050, 0.060] },
    { k: 'cdr',       n: 'Bekleme Azaltma', fmt: 'pct',  min: [0.010, 0.015, 0.020, 0.025, 0.030, 0.040], max: [0.015, 0.025, 0.030, 0.040, 0.050, 0.060] },
    { k: 'lifesteal', n: 'Can Çalma',       fmt: 'pct',  min: [0.003, 0.005, 0.007, 0.010, 0.012, 0.015], max: [0.006, 0.008, 0.011, 0.014, 0.018, 0.022] },
    { k: 'pickup',    n: 'Toplama Alanı',   fmt: 'pct',  min: [0.040, 0.060, 0.080, 0.100, 0.130, 0.160], max: [0.070, 0.100, 0.130, 0.160, 0.200, 0.250] },
    { k: 'xpGain',    n: 'Tecrübe Kazancı', fmt: 'pct',  min: [0.020, 0.030, 0.040, 0.050, 0.060, 0.080], max: [0.040, 0.050, 0.060, 0.080, 0.100, 0.120] },
    { k: 'goldGain',  n: 'Altın Kazancı',   fmt: 'pct',  min: [0.030, 0.040, 0.050, 0.070, 0.090, 0.110], max: [0.050, 0.070, 0.090, 0.110, 0.140, 0.180] },
    { k: 'skillDmg',  n: 'Yetenek Hasarı',  fmt: 'pct',  min: [0.020, 0.030, 0.040, 0.050, 0.070, 0.090], max: [0.030, 0.050, 0.060, 0.080, 0.100, 0.130] },
    { k: 'eliteDmg',  n: 'Elit Hasarı',     fmt: 'pct',  min: [0.030, 0.040, 0.060, 0.080, 0.100, 0.130], max: [0.050, 0.070, 0.090, 0.120, 0.150, 0.190] },
    { k: 'bossDmg',   n: 'Boss Hasarı',     fmt: 'pct',  min: [0.030, 0.040, 0.060, 0.080, 0.100, 0.130], max: [0.050, 0.070, 0.090, 0.120, 0.150, 0.190] },
    { k: 'regen',     n: 'Can Yenileme',    fmt: 'flat', min: [0.3, 0.5, 0.8, 1.2, 1.8, 2.5],             max: [0.6, 0.9, 1.3, 1.9, 2.7, 3.6] }
  ];

  /* ============================================================================================
   * 2.8 Heroes + talent trees
   * Talent node row helper:  [name, max, effPerRank, reqIndexes(1-based, same branch), row, col, icon, capstoneText?]
   * A row with capstoneText becomes { big:true, max:1, text }.
   * ========================================================================================== */
  function branch(hero, key, prefix, n, col, icon, desc, rows) {
    var nodes = rows.map(function (r, i) {
      var o = {
        id: hero + '_' + prefix + (i + 1), n: r[0], max: r[1], eff: r[2],
        req: r[3].map(function (k) { return hero + '_' + prefix + k; }),
        row: r[4], col: r[5], icon: r[6]
      };
      if (r[7]) { o.big = true; o.max = 1; o.text = r[7]; }
      return o;
    });
    return { id: hero + '_' + key, n: n, col: col, icon: icon, desc: desc, nodes: nodes };
  }

  D.HEROES = [
    /* ---------------------------------------------------------------- BORA */
    {
      id: 'bora', n: 'Bora', cls: 'Savaşçı', rar: 2, weapon: 'kilic', unlock: { type: 'start' },
      title: 'Kuzey Kalkanı', role: 'Yakın dövüş · Dayanıklı',
      desc: 'Kuzey sınır kalesinin son muhafızı. Metin taşları gökten düştüğü gece bütün bölüğünü gölge vebasına kurban verdi; o geceden beri kılıcını kınına sokmadı. Kalın derisi, inatçı yüreği ve kocaman kılıcıyla ön safların vazgeçilmezi.',
      quote: '“Arkamda durun. Bu gece kimse düşmeyecek.”',
      lines: { start: 'Kalkanlar yukarı!', win: 'Kuzey hâlâ ayakta!', lose: 'Bir dahaki sefere…', ult: 'KASIRGA!' },
      base: { atk: 24, hp: 420, def: 12, spd: 1.0 },
      passive: { w_kilic: 0.30, hpPct: 0.15, defPct: 0.08 },
      passiveText: ['Kılıç hasarı +%30', 'Can +%15', 'Savunma +%8'],
      ult: { id: 'kasirga', n: 'Kasırga', dur: 4, col: '#C9CED8',
        desc: 'Bora kılıcıyla birlikte dönen çelik bir kasırgaya dönüşür: 4 sn boyunca etrafındaki bütün düşmanları biçer, onları geri savurur ve bu sürede hızla ilerler.' },
      look: { skin: '#F2C7A5', hair: '#5A3424', cloth: '#8E2F2F', accent: '#C9CED8', eye: '#3A2A20', extra: 'headband' },
      talents: [
        branch('bora', 'saldiri', 's', 'Saldırı', '#E8394D', 'sword', 'Kılıç hasarı, kritik vuruşlar ve zayıflamış düşmanları infaz.', [
          ['Keskin Kenar',   3, { w_kilic: 0.03 },  [],     0, 1, 'sword'],
          ['Demir Bilek',    5, { atkPct: 0.02 },   [1],    1, 0, 'fist'],
          ['Avcı Gözü',      5, { crit: 0.01 },     [1],    1, 2, 'eye'],
          ['Savaş Çığlığı',  3, { eliteDmg: 0.05 }, [2],    2, 0, 'crown'],
          ['Geniş Savuruş',  1, { area: 0.10 },     [2, 3], 2, 1, 'sword'],
          ['Yarık Açan',     3, { critDmg: 0.06 },  [3],    2, 2, 'skull'],
          ['Kılıç Ustası',   3, { w_kilic: 0.05 },  [5],    3, 1, 'sword'],
          ['Dev Avcısı',     3, { bossDmg: 0.06 },  [4, 7], 4, 0, 'crown'],
          ['Hız Kesmeyen',   3, { cdr: 0.02 },      [6, 7], 4, 2, 'clock'],
          ['Cellat',         1, { execute: 0.10 },  [8, 9], 5, 1, 'skull',
            'Canı %10’un altına düşen (boss olmayan) düşmanlar tek vuruşta ölür.']
        ]),
        branch('bora', 'savunma', 'v', 'Savunma', '#4BA3FF', 'shield', 'Çelik gibi bir beden: can, zırh ve saldırana geri dönen hasar.', [
          ['Kalın Deri',     3, { hp: 40 },         [],     0, 1, 'heart'],
          ['Çelik Pul',      5, { defPct: 0.03 },   [1],    1, 0, 'shield'],
          ['Ayı Yüreği',     5, { hpPct: 0.03 },    [1],    1, 2, 'heart'],
          ['Sarsılmaz',      5, { def: 3 },         [2, 3], 2, 1, 'shield'],
          ['Yara Sarma',     3, { regen: 0.6 },     [4],    3, 0, 'drop'],
          ['Dikenli Zırh',   3, { thorns: 0.06 },   [4],    3, 2, 'shield'],
          ['Son Siper',      3, { shieldStart: 40 },[5],    4, 0, 'shield'],
          ['Kaya Gibi',      3, { dodge: 0.02 },    [6],    4, 2, 'wing'],
          ['Demir Kale',     1, { thorns: 0.40, defPct: 0.10 }, [7, 8], 5, 1, 'shield',
            'Aldığın hasarın %40’ı saldırana geri döner. Savunma +%10.']
        ]),
        branch('bora', 'liderlik', 'l', 'Liderlik', '#FFCB57', 'crown', 'Sancağın altında toplananlara güç: altın, tecrübe ve ölümsüzlük.', [
          ['Sancaktar',      3, { goldGain: 0.04 }, [],     0, 1, 'crown'],
          ['Tecrübeli',      5, { xpGain: 0.03 },   [1],    1, 0, 'star'],
          ['Savaş Disiplini',5, { cdr: 0.015 },     [1],    1, 2, 'clock'],
          ['Savaş Narası',   3, { ultCharge: 0.06 },[2],    2, 0, 'bolt'],
          ['Ganimet Payı',   3, { pickup: 0.08 },   [3],    2, 2, 'eye'],
          ['Komutan',        3, { atkPct: 0.03 },   [4, 5], 3, 1, 'fist'],
          ['Uzun Nöbet',     3, { dur: 0.05 },      [6],    4, 0, 'clock'],
          ['Kasırga Ustası', 3, { ultDmg: 0.10 },   [6],    4, 2, 'wing'],
          ['Ölümsüz Sancak', 1, { revive: 1, atkPct: 0.05 }, [7, 8], 5, 1, 'crown',
            'Savaş başına bir kez ölümden döner, canının %50’siyle ayağa kalkarsın. Saldırı +%5.']
        ])
      ]
    },

    /* ---------------------------------------------------------------- ELA */
    {
      id: 'ela', n: 'Ela', cls: 'Okçu', rar: 3, weapon: 'yay', unlock: { type: 'start' },
      title: 'Kara Orman’ın Gözcüsü', role: 'Uzak menzil · Kritik',
      desc: 'Kara Orman’ın son gözcüsü. Lanetli taşlar düştüğünde ağaçlar çığlık attı; Ela o çığlığı hâlâ duyuyor. Rüzgârı okur, tek nefeste üç ok çeker ve hiçbir avı kaçırmaz. Sevimli gülüşüne aldanma: oku senden önce davranır.',
      quote: '“Rüzgâr bana nereye nişan alacağımı fısıldıyor.”',
      lines: { start: 'Av başlasın.', win: 'Tam on ikiden!', lose: 'Rüzgâr döndü…', ult: 'OK YAĞMURU!' },
      base: { atk: 26, hp: 340, def: 8, spd: 1.08 },
      passive: { w_yay: 0.30, crit: 0.10, spdPct: 0.05 },
      passiveText: ['Yay hasarı +%30', 'Kritik şansı +%10', 'Hareket hızı +%5'],
      ult: { id: 'okYagmuru', n: 'Ok Yağmuru', dur: 3, col: '#FFB020',
        desc: 'Ela gökyüzüne yüzlerce ok fırlatır: 3 sn boyunca ekrandaki bütün düşmanların üstüne ok yağar ve her ok kritik vurma şansı taşır.' },
      look: { skin: '#F5D2B8', hair: '#C46A2B', cloth: '#2F6B4A', accent: '#D9B26A', eye: '#2F7A4F', extra: 'feathers' },
      talents: [
        branch('ela', 'nisanci', 'n', 'Nişancı', '#FFB020', 'bow', 'Kusursuz nişan: yay hasarı, kritik ve delip geçen oklar.', [
          ['Sabit El',       3, { w_yay: 0.03 },    [],     0, 1, 'bow'],
          ['Kartal Gözü',    5, { crit: 0.01 },     [1],    1, 0, 'eye'],
          ['Gergin Kiriş',   5, { atkPct: 0.02 },   [1],    1, 2, 'bow'],
          ['Zayıf Nokta',    3, { critDmg: 0.08 },  [2],    2, 0, 'skull'],
          ['Delici Uç',      1, { pierce: 1 },      [2, 3], 2, 1, 'bow'],
          ['Hızlı Çekiş',    3, { cdr: 0.02 },      [3],    2, 2, 'clock'],
          ['Usta Okçu',      3, { w_yay: 0.05 },    [5],    3, 1, 'bow'],
          ['Kalbe Nişan',    3, { critDmg: 0.06 },  [4, 7], 4, 0, 'heart'],
          ['Uzak Menzil',    3, { bossDmg: 0.06 },  [6, 7], 4, 2, 'crown'],
          ['Çifte Kiriş',    1, { projCount: 1, pierce: 1 }, [8, 9], 5, 1, 'bow',
            'Silahın ve mermi atan bütün yeteneklerin +1 mermi fırlatır, mermiler +1 düşmanı delip geçer.']
        ]),
        branch('ela', 'avci', 'a', 'Avcı', '#5BD16E', 'skull', 'Avın kokusunu alan avcı: elit ve boss avı, can ve ganimet.', [
          ['İz Sürücü',      3, { spdPct: 0.02 },   [],     0, 1, 'boot'],
          ['Tuzakçı',        5, { eliteDmg: 0.04 }, [1],    1, 0, 'skull'],
          ['Av Payı',        5, { goldGain: 0.03 }, [1],    1, 2, 'crown'],
          ['Sabırlı Avcı',   5, { hpPct: 0.03 },    [2, 3], 2, 1, 'heart'],
          ['Kurt Kanı',      3, { lifesteal: 0.006 },[4],   3, 0, 'drop'],
          ['Toplayıcı',      3, { pickup: 0.10 },   [4],    3, 2, 'eye'],
          ['Boss Avcısı',    3, { bossDmg: 0.07 },  [5],    4, 0, 'crown'],
          ['Zehirli Uç',     3, { e_zehir: 0.08 },  [6],    4, 2, 'drop'],
          ['Avcının Ziyafeti', 1, { killHeal: 3, eliteDmg: 0.20 }, [7, 8], 5, 1, 'heart',
            'Her öldürme 3 can yeniler. Elit düşmanlara +%20 hasar.']
        ]),
        branch('ela', 'ruzgar', 'r', 'Rüzgâr', '#3EDBC8', 'wing', 'Rüzgârla bir olmak: hız, kaçınma ve fırtına gibi bir nihai güç.', [
          ['Hafif Adım',     3, { dodge: 0.01 },    [],     0, 1, 'wing'],
          ['Rüzgâr Koşucusu',5, { spdPct: 0.02 },   [1],    1, 0, 'boot'],
          ['Esinti',         5, { cdr: 0.012 },     [1],    1, 2, 'clock'],
          ['Kasırga Oku',    3, { area: 0.05 },     [2],    2, 0, 'wing'],
          ['Gökyüzü Kızı',   3, { ultCharge: 0.06 },[3],    2, 2, 'star'],
          ['Yaprak Gibi',    3, { dodge: 0.015 },   [4, 5], 3, 1, 'wing'],
          ['Fırtına Kanadı', 3, { e_yildirim: 0.06 },[6],   4, 0, 'bolt'],
          ['Ok Seli',        3, { ultDmg: 0.10 },   [6],    4, 2, 'bow'],
          ['Fırtınanın Gözü',1, { dodge: 0.10, ultCharge: 0.30 }, [7, 8], 5, 1, 'eye',
            'Saldırıların %10’undan rüzgâr gibi sıyrılırsın. Ok Yağmuru %30 daha hızlı dolar.']
        ])
      ]
    },

    /* ---------------------------------------------------------------- YAMAN */
    {
      id: 'yaman', n: 'Yaman', cls: 'Sura', rar: 3, weapon: 'orak', unlock: { type: 'gems', cost: 500 },
      title: 'Lanet Taşıyıcı', role: 'Yakın dövüş · Can çalma',
      desc: 'Bir zamanlar tapınak muhafızıydı. Gölge vebasına yakalandı ama ölmedi; laneti kendi kanına hapsetti. Şimdi karanlıkla savaşmak için karanlığı kullanıyor. Her savuruşu düşmanlarının canını emer — ama içindeki gölge her gün biraz daha acıkıyor.',
      quote: '“Gölge benim zincirim… ve benim silahım.”',
      lines: { start: 'Karanlık aç.', win: 'Gölge doydu.', lose: 'Lanet… beni çağırıyor…', ult: 'GÖLGE, UYAN!' },
      base: { atk: 27, hp: 380, def: 10, spd: 1.02 },
      passive: { w_orak: 0.30, lifesteal: 0.05, e_golge: 0.15 },
      passiveText: ['Orak hasarı +%30', 'Can çalma +%5', 'Gölge hasarı +%15'],
      ult: { id: 'golgePatlama', n: 'Gölge Patlaması', dur: 4, col: '#9D6BFF',
        desc: 'Yaman içindeki gölgeyi serbest bırakır: ekranı kaplayan karanlık bir patlama bütün düşmanlara ağır hasar verir, ardından 4 sn boyunca verdiği hasarın büyük kısmı can olarak geri döner.' },
      look: { skin: '#D8AE8E', hair: '#20172B', cloth: '#3B1E4E', accent: '#E8394D', eye: '#B565FF', extra: 'scar' },
      talents: [
        branch('yaman', 'lanet', 'l', 'Lanet', '#5BD16E', 'eye', 'Düşmanlarını lanetle: gölge ve zehir hasarı, uzun süren laneti ve ölüm fermanı.', [
          ['Kara Fısıltı',   3, { e_golge: 0.04 },  [],     0, 1, 'eye'],
          ['Uğursuz Damga',  5, { skillDmg: 0.02 }, [1],    1, 0, 'skull'],
          ['Orak Bileği',    5, { w_orak: 0.03 },   [1],    1, 2, 'scythe'],
          ['Çürüme',         3, { e_zehir: 0.06 },  [2],    2, 0, 'drop'],
          ['Lanet Halkası',  1, { area: 0.10 },     [2, 3], 2, 1, 'eye'],
          ['Ruh Yarığı',     3, { critDmg: 0.07 },  [3],    2, 2, 'scythe'],
          ['Kara Ayin',      3, { e_golge: 0.06 },  [5],    3, 1, 'skull'],
          ['Uzun Lanet',     3, { dur: 0.06 },      [4, 7], 4, 0, 'clock'],
          ['Seçilmiş Kurban',3, { eliteDmg: 0.07 }, [6, 7], 4, 2, 'crown'],
          ['Ölüm Fermanı',   1, { execute: 0.08, e_golge: 0.20 }, [8, 9], 5, 1, 'skull',
            'Canı %8’in altına düşen (boss olmayan) düşmanlar lanetle yok olur. Gölge hasarı +%20.']
        ]),
        branch('yaman', 'kan', 'k', 'Kan', '#E8394D', 'drop', 'Kan kanı çeker: can çalma, dayanıklılık ve kanlı bir bedel.', [
          ['Kan Susuzluğu',  3, { lifesteal: 0.005 },[],    0, 1, 'drop'],
          ['Kalın Damar',    5, { hpPct: 0.03 },    [1],    1, 0, 'heart'],
          ['Vahşet',         5, { atkPct: 0.02 },   [1],    1, 2, 'fist'],
          ['Kan Bağı',       5, { regen: 0.4 },     [2, 3], 2, 1, 'heart'],
          ['Yarayı Dağla',   3, { def: 3 },         [4],    3, 0, 'shield'],
          ['Kızıl Hasat',    3, { w_orak: 0.05 },   [4],    3, 2, 'scythe'],
          ['Kan Kalkanı',    3, { shieldStart: 35 },[5],    4, 0, 'shield'],
          ['Kemik Kıran',    3, { bossDmg: 0.06 },  [6],    4, 2, 'skull'],
          ['Kan Bedeli',     1, { lifesteal: 0.05, thorns: 0.25 }, [7, 8], 5, 1, 'drop',
            'Can çalma +%5. Sana vuranlar bedelini öder: aldığın hasarın %25’i saldırana geri döner.']
        ]),
        branch('yaman', 'golge', 'g', 'Gölge', '#9D6BFF', 'skull', 'İçindeki gölgeyi serbest bırak: kaçınma, kritik ve yıkıcı bir nihai güç.', [
          ['Gölge Adımı',    3, { spdPct: 0.02 },   [],     0, 1, 'boot'],
          ['Karanlıkta Görmek', 5, { crit: 0.01 },  [1],    1, 0, 'eye'],
          ['Sis Örtüsü',     5, { dodge: 0.012 },   [1],    1, 2, 'wing'],
          ['İçteki Canavar', 3, { ultCharge: 0.07 },[2],    2, 0, 'skull'],
          ['Delen Karanlık', 1, { pierce: 1 },      [2, 3], 2, 1, 'scythe'],
          ['Kara Duman',     3, { cdr: 0.02 },      [3],    2, 2, 'clock'],
          ['Gece Hükmü',     3, { ultDmg: 0.10 },   [5],    3, 1, 'crown'],
          ['Gölgeden Vuruş', 3, { critDmg: 0.07 },  [4, 7], 4, 0, 'skull'],
          ['Ruh Emici',      3, { killHeal: 1 },    [6, 7], 4, 2, 'drop'],
          ['Karanlığın Efendisi', 1, { ultDmg: 0.50, ultCharge: 0.25 }, [8, 9], 5, 1, 'crown',
            'Gölge Patlaması %50 daha yıkıcı olur ve %25 daha hızlı dolar.']
        ])
      ]
    },

    /* ---------------------------------------------------------------- AYAZ */
    {
      id: 'ayaz', n: 'Ayaz', cls: 'Şaman', rar: 3, weapon: 'asa', unlock: { type: 'gems', cost: 500 },
      title: 'Buzul Şamanı', role: 'Büyü · Destek',
      desc: 'Buzul dağlarının şaman soyundan gelir. Ataların ruhları ona fısıldar: “Taşlar düştü, gök yarıldı.” Ayaz fırtınayı asasına bağlar, yaralıları iyileştirir ve gölgeleri yıldırımla dağıtır. Sessizdir; ama öfkelendiğinde gökyüzü onunla birlikte kükrer.',
      quote: '“Atalarım konuşuyor. Fırtına geliyor.”',
      lines: { start: 'Ruhlar, yanımda olun.', win: 'Fırtına dindi.', lose: 'Buz… eriyor…', ult: 'FIRTINA RUHU!' },
      base: { atk: 25, hp: 360, def: 9, spd: 1.0 },
      passive: { w_asa: 0.30, cdr: 0.10, regen: 2, e_yildirim: 0.15 },
      passiveText: ['Asa hasarı +%30', 'Bekleme süreleri -%10', 'Can yenileme +2/sn', 'Yıldırım hasarı +%15'],
      ult: { id: 'firtina', n: 'Fırtına Ruhu', dur: 5, col: '#7FD8FF',
        desc: 'Ayaz ataların fırtına ruhunu çağırır: 5 sn boyunca düşmanların üstüne art arda yıldırımlar düşer ve Ayaz canının %30’unu yeniler.' },
      look: { skin: '#EED9C8', hair: '#D8E6F2', cloth: '#2B5C8A', accent: '#3EDBC8', eye: '#4BA3FF', extra: 'hood' },
      talents: [
        branch('ayaz', 'firtina', 'f', 'Fırtına', '#4BA3FF', 'bolt', 'Gökyüzünü asana bağla: yıldırım, buz ve zincirleme fırtınalar.', [
          ['Statik Yük',     3, { e_yildirim: 0.04 },[],    0, 1, 'bolt'],
          ['Asa Ustalığı',   5, { w_asa: 0.03 },    [1],    1, 0, 'staff'],
          ['Gök Gürlemesi',  5, { skillDmg: 0.02 }, [1],    1, 2, 'bolt'],
          ['Buz Çekirdeği',  3, { e_buz: 0.06 },    [2],    2, 0, 'snow'],
          ['İletken Küre',   1, { pierce: 1 },      [2, 3], 2, 1, 'staff'],
          ['Şimşek Hızı',    3, { cdr: 0.02 },      [3],    2, 2, 'clock'],
          ['Fırtına Çağıran',3, { e_yildirim: 0.06 },[5],   3, 1, 'bolt'],
          ['Kar Tipisi',     3, { area: 0.05 },     [4, 7], 4, 0, 'snow'],
          ['Yüksek Gerilim', 3, { critDmg: 0.07 },  [6, 7], 4, 2, 'star'],
          ['Zincir Fırtına', 1, { projCount: 1, e_yildirim: 0.25 }, [8, 9], 5, 1, 'bolt',
            'Silahın ve mermi atan bütün yeteneklerin +1 mermi fırlatır. Yıldırım hasarı +%25.']
        ]),
        branch('ayaz', 'sifa', 's', 'Şifa', '#5BD16E', 'heart', 'Ataların şifası: can yenileme, kalkanlar ve koruma.', [
          ['Şifalı Otlar',   3, { regen: 0.5 },     [],     0, 1, 'heart'],
          ['Kutsal Koruma',  5, { defPct: 0.03 },   [1],    1, 0, 'shield'],
          ['Yaşam Pınarı',   5, { hpPct: 0.03 },    [1],    1, 2, 'drop'],
          ['Ruh Bağı',       5, { lifesteal: 0.004 },[2, 3],2, 1, 'heart'],
          ['Buz Zırhı',      3, { def: 3 },         [4],    3, 0, 'snow'],
          ['Hayat Ağacı',    3, { killHeal: 1 },    [4],    3, 2, 'heart'],
          ['Koruyucu Ruh',   3, { shieldStart: 40 },[5],    4, 0, 'shield'],
          ['Tazelenme',      3, { regen: 0.8 },     [6],    4, 2, 'drop'],
          ['Kutsal Kalkan',  1, { shieldStart: 300, regen: 3 }, [7, 8], 5, 1, 'shield',
            'Savaşa 300 puanlık bir buz kalkanıyla başlarsın. Can yenileme +3/sn.']
        ]),
        branch('ayaz', 'ruh', 'r', 'Ruh', '#3EDBC8', 'star', 'Ruhlarla konuş: tecrübe, ganimet ve güçlü bir nihai.', [
          ['Ata Fısıltısı',  3, { xpGain: 0.04 },   [],     0, 1, 'star'],
          ['Ruh Mıknatısı',  5, { pickup: 0.08 },   [1],    1, 0, 'eye'],
          ['Uzun Ayin',      5, { dur: 0.04 },      [1],    1, 2, 'clock'],
          ['Ruh Feneri',     3, { e_golge: 0.06 },  [2],    2, 0, 'flame'],
          ['Bilge Göz',      3, { cdr: 0.015 },     [3],    2, 2, 'eye'],
          ['Fırtına Ruhu',   3, { ultCharge: 0.07 },[4, 5], 3, 1, 'wing'],
          ['Ruh Akını',      3, { ultDmg: 0.10 },   [6],    4, 0, 'bolt'],
          ['Altın Fısıltı',  3, { goldGain: 0.05 }, [6],    4, 2, 'crown'],
          ['Ataların Bilgisi', 1, { startLvl: 2, xpGain: 0.10 }, [7, 8], 5, 1, 'star',
            'Savaşa 2 bedava seviye atlamasıyla başlarsın. Tecrübe kazancı +%10.']
        ])
      ]
    },

    /* ---------------------------------------------------------------- ALAZ */
    {
      id: 'alaz', n: 'Alaz', cls: 'Ejder Muhafızı', rar: 4, weapon: 'kilic', unlock: { type: 'gems', cost: 1500 },
      title: 'Son Ejder Muhafızı', role: 'Yakın dövüş · Ateş',
      desc: 'Damarlarında ejder kanı taşıyan son muhafız. Kor Dağı’nın yüreğinde doğdu; Metin taşları uyandığında içindeki ejder de uyandı. Alevi hem bir lütuf hem bir lanet: dokunduğu her şey yanar, en çok da kendisi.',
      quote: '“Kanımda ateş var. Gelin de yanın.”',
      lines: { start: 'Kor uyanıyor.', win: 'Geriye yalnız kül kaldı.', lose: 'Alev… sönmez…', ult: 'EJDER, NEFES AL!' },
      base: { atk: 30, hp: 450, def: 14, spd: 1.0 },
      passive: { e_ates: 0.40, atkPct: 0.10, skillDmg: 0.10, w_kilic: 0.10 },
      passiveText: ['Ateş hasarı +%40', 'Saldırı +%10', 'Yetenek hasarı +%10', 'Kılıç hasarı +%10'],
      ult: { id: 'ejderNefesi', n: 'Ejder Nefesi', dur: 3, col: '#FF7A2F',
        desc: 'Alaz’ın kan bağı uyanır: kızıl bir ejder ekranı boydan boya geçerek alev kusar. Yoluna çıkan her şey ağır hasar alır ve saniyeler boyunca yanar.' },
      look: { skin: '#F0C4A0', hair: '#C2321F', cloth: '#5C1A1A', accent: '#FFB020', eye: '#FF7A2F', extra: 'horns' },
      talents: [
        branch('alaz', 'ates', 'a', 'Ateş', '#FF7A2F', 'flame', 'Her şeyi yak: ateş hasarı, yanma ve kül olmuş düşmanlardan beslenme.', [
          ['Kıvılcım',       3, { e_ates: 0.04 },   [],     0, 1, 'flame'],
          ['Kor Kılıç',      5, { w_kilic: 0.03 },  [1],    1, 0, 'sword'],
          ['Yakıcı Öfke',    5, { skillDmg: 0.02 }, [1],    1, 2, 'flame'],
          ['Alev Dalgası',   3, { area: 0.05 },     [2],    2, 0, 'flame'],
          ['Sönmeyen Alev',  1, { dur: 0.10 },      [2, 3], 2, 1, 'clock'],
          ['Kavurucu',       3, { critDmg: 0.07 },  [3],    2, 2, 'skull'],
          ['Cehennem Kalbi', 3, { e_ates: 0.06 },   [5],    3, 1, 'flame'],
          ['Erimiş Çelik',   3, { atkPct: 0.03 },   [4, 7], 4, 0, 'sword'],
          ['Yanık İzi',      3, { eliteDmg: 0.07 }, [6, 7], 4, 2, 'crown'],
          ['Kül Ziyafeti',   1, { e_ates: 0.25, area: 0.15, killHeal: 2 }, [8, 9], 5, 1, 'flame',
            'Ateş hasarı +%25, etki alanı +%15. Kül olan her düşman sana 2 can verir.']
        ]),
        branch('alaz', 'ejder', 'e', 'Ejder', '#FF3D4F', 'wing', 'İçindeki ejderi uyandır: pullar, pençeler ve yıkıcı ejder nefesi.', [
          ['Ejder Kanı',     3, { hpPct: 0.03 },    [],     0, 1, 'drop'],
          ['Pullu Deri',     5, { defPct: 0.03 },   [1],    1, 0, 'shield'],
          ['Ejder Pençesi',  5, { critDmg: 0.05 },  [1],    1, 2, 'fist'],
          ['Kadim Öfke',     5, { ultCharge: 0.05 },[2, 3], 2, 1, 'wing'],
          ['Kanat Çırpışı',  3, { spdPct: 0.025 },  [4],    3, 0, 'wing'],
          ['Ejder Gözü',     3, { crit: 0.015 },    [4],    3, 2, 'eye'],
          ['Alev Soluğu',    3, { ultDmg: 0.10 },   [5],    4, 0, 'flame'],
          ['Hazine Bekçisi', 3, { goldGain: 0.05 }, [6],    4, 2, 'crown'],
          ['Ejderin Uyanışı',1, { ultDmg: 0.60, startLvl: 1 }, [7, 8], 5, 1, 'crown',
            'Ejder Nefesi %60 daha yıkıcı olur. Savaşa 1 bedava seviye atlamasıyla başlarsın.']
        ]),
        branch('alaz', 'muhafiz', 'm', 'Muhafız', '#FFCB57', 'shield', 'Yeminli muhafız: zırh, kalkan ve ölümün bile durduramadığı irade.', [
          ['Yemin',          3, { def: 3 },         [],     0, 1, 'shield'],
          ['Kor Zırh',       5, { hp: 35 },         [1],    1, 0, 'heart'],
          ['Kararlılık',     5, { regen: 0.4 },     [1],    1, 2, 'heart'],
          ['Alev Kalkanı',   3, { thorns: 0.06 },   [2],    2, 0, 'shield'],
          ['Muhafız Duruşu', 3, { dodge: 0.015 },   [3],    2, 2, 'wing'],
          ['Demir İrade',    3, { shieldStart: 40 },[4, 5], 3, 1, 'shield'],
          ['Savaş Tecrübesi',3, { xpGain: 0.04 },   [6],    4, 0, 'star'],
          ['Dev Kıran',      3, { bossDmg: 0.07 },  [6],    4, 2, 'crown'],
          ['Ebedi Muhafız',  1, { revive: 1, shieldStart: 200 }, [7, 8], 5, 1, 'crown',
            'Savaş başına bir kez küllerinden doğarsın (canının %50’siyle). Savaşa 200 puanlık bir alev kalkanıyla başlarsın.']
        ])
      ]
    }
  ];
  D.HERO_IDS = D.HEROES.map(function (h) { return h.id; });

  D.HERO_PROG = {
    maxLvByStar: [0, 20, 30, 40, 50, 60], goldBase: 120, goldGrow: 1.085,
    shardsByStar: [0, 10, 20, 40, 80, 0] /* shards needed to go from star s to s+1 */,
    lvlStatGrow: 0.04, starStatGrow: 0.10, pointsPerLevel: 1
  };

  /* talent icon names (art draws them; attributes reuse the same set) */
  D.ICON_NAMES = ['sword', 'bow', 'scythe', 'staff', 'fist', 'shield', 'heart', 'boot', 'clock', 'star',
    'skull', 'flame', 'snow', 'bolt', 'drop', 'eye', 'crown', 'wing'];

  /* ============================================================================================
   * 2.9 Skins (cosmetic only).  target: 'silah:<type>' | 'slot:<slotId>' | 'hero:<heroId>'
   * ========================================================================================== */
  D.SKINS = [
    { id: 'sk_kilic_ejder',   n: 'Ejder Dişi Kılıcı', target: 'silah:kilic', rar: 4, cost: { type: 'start' }, col: '#E8394D',
      desc: 'Kızıl bir ejderin dişinden dövülmüş; kabzasındaki yakut hâlâ sıcak.' },
    { id: 'sk_kilic_buz',     n: 'Ayaz Kılıcı',       target: 'silah:kilic', rar: 3, cost: { gems: 300 },     col: '#7FD8FF',
      desc: 'Hiç erimeyen buzdan bir kılıç. Her savuruşta havada kar taneleri asılı kalır.' },
    { id: 'sk_yay_kemik',     n: 'Kemik Yay',         target: 'silah:yay',   rar: 3, cost: { gems: 300 },     col: '#E8E2D0',
      desc: 'Bir kemik ejderin kaburgasından oyulmuş; kirişi ölü ruhların iniltisiyle gerilir.' },
    { id: 'sk_yay_ay',        n: 'Hilal Yay',         target: 'silah:yay',   rar: 4, cost: { gems: 450 },     col: '#CFE3FF',
      desc: 'Ay ışığıyla kutsanmış gümüş bir hilal. Okları gecenin içinde ışıltılı izler bırakır.' },
    { id: 'sk_orak_ruh',      n: 'Ruh Biçen',         target: 'silah:orak',  rar: 4, cost: { gems: 450 },     col: '#B565FF',
      desc: 'Ağzından mor ruh alevleri sızan, geceleri fısıldayan bir orak.' },
    { id: 'sk_asa_kristal',   n: 'Kristal Asa',       target: 'silah:asa',   rar: 4, cost: { gems: 450 },     col: '#3EDBC8',
      desc: 'Ucunda bir Metin taşından yontulmuş, nabız gibi atan bir kristal taşır.' },
    { id: 'sk_kafa_boynuz',   n: 'Boynuzlu Miğfer',   target: 'slot:kafa',   rar: 3, cost: { type: 'start' }, col: '#C9CED8',
      desc: 'Kuzey savaşçılarının iki kıvrık boynuzlu demir miğferi.' },
    { id: 'sk_kafa_tac',      n: 'Gölge Tacı',        target: 'slot:kafa',   rar: 5, cost: { gems: 800 },     col: '#9D6BFF',
      desc: 'Gölge Kralı’nın kırık tacından bir parça. Taşıyanın çevresinde gölgeler dans eder.' },
    { id: 'sk_omuz_kafatasi', n: 'Kafatası Omuzluk',  target: 'slot:omuz',   rar: 3, cost: { gems: 250 },     col: '#E8E2D0',
      desc: 'Yenilen düşmanların kafataslarıyla süslenmiş, ürkütücü omuzluklar.' },
    { id: 'sk_gogus_kanat',   n: 'Kanatlı Zırh',      target: 'slot:gogus',  rar: 4, cost: { gems: 600 },     col: '#FFE9A3',
      desc: 'Sırtında küçük, durmadan çırpınan ruh kanatları olan zarif bir zırh.' },
    { id: 'sk_yuz_iblis',     n: 'İblis Maskesi',     target: 'slot:yuz',    rar: 3, cost: { gems: 250 },     col: '#E8394D',
      desc: 'Kor İblisi’nin yüzünden alınmış bir kalıp; gözleri karanlıkta kızıl yanar.' },
    { id: 'sk_ayak_alev',     n: 'Alev Çizmeler',     target: 'slot:ayak',   rar: 4, cost: { gems: 400 },     col: '#FF7A2F',
      desc: 'Her adımda yerde bir süre sönmeyen alev izleri bırakır.' },
    { id: 'sk_bora_kurt',     n: 'Kurt Lordu Bora',   target: 'hero:bora',   rar: 4, cost: { gems: 600 },     col: '#8A93A6',
      desc: 'Kurt Kral’ı yendikten sonra postunu omuzlarına alan Bora: uluyan kurt başlığı ve gümüş pençeler.' },
    { id: 'sk_ela_gece',      n: 'Gece Avcısı Ela',   target: 'hero:ela',    rar: 4, cost: { gems: 600 },     col: '#2E3F66',
      desc: 'Ay ışığında görünmez olan gece pelerini ve gümüş bir yarım maske.' },
    { id: 'sk_yaman_kan',     n: 'Kan Ayı Yaman',     target: 'hero:yaman',  rar: 4, cost: { gems: 600 },     col: '#B0283C',
      desc: 'Kızıl ayın gecesinde dövülmüş lanetli zırh; gözlerinden kan kırmızısı bir ışık taşar.' },
    { id: 'sk_ayaz_kis',      n: 'Kış Ruhu Ayaz',     target: 'hero:ayaz',   rar: 4, cost: { gems: 600 },     col: '#CFEFFF',
      desc: 'Buz kristallerinden bir taç, kar beyazı kürk ve çevresinde süzülen kar tanecikleri.' },
    { id: 'sk_alaz_kara',     n: 'Kara Ejder Alaz',   target: 'hero:alaz',   rar: 5, cost: { gems: 900 },     col: '#5A2A8C',
      desc: 'Kara Ejder’in ruhu Alaz’ın bedenine yerleşti: obsidyen pullar, mor alevler ve kıvılcım saçan boynuzlar.' }
  ];

  /* ============================================================================================
   * 2.10 Training (gold).  Cost of L→L+1 = round(costBase * costGrow^L)
   * ========================================================================================== */
  D.TRAINING = [
    { id: 'atk',  n: 'Saldırı Eğitimi', key: 'atk',  per: 3,     max: 200, costBase: 80,  costGrow: 1.045, icon: 'sword',  desc: 'Talim kuklalarına binlerce darbe: kalıcı saldırı gücü.' },
    { id: 'hp',   n: 'Dayanım Eğitimi', key: 'hp',   per: 30,    max: 200, costBase: 80,  costGrow: 1.045, icon: 'heart',  desc: 'Karlı dağ yollarında taş taşımak: kalıcı can.' },
    { id: 'def',  n: 'Zırh Eğitimi',    key: 'def',  per: 2,     max: 200, costBase: 80,  costGrow: 1.045, icon: 'shield', desc: 'Kalkan duvarında saatlerce durmak: kalıcı savunma.' },
    { id: 'crit', n: 'Odak Eğitimi',    key: 'crit', per: 0.002, max: 100, costBase: 150, costGrow: 1.06,  icon: 'eye',    desc: 'Mum alevine bakarak nefesini tutmak: kalıcı kritik şansı.' }
  ];

  /* ============================================================================================
   * 2.11 Attributes (GTA-style, grow ONLY by playing).  Level 0..100.
   *   need(L) = round(base * (L+1)^1.6)   — XP to go from L to L+1
   *   xp per run = RESULT[src] * factor
   *   Σ (L+1)^1.6 for L = 0..99 ≈ 61 830  →  total XP to 100 ≈ base × 61 830.
   * `est` = assumed amount of `src` in a typical ~4 min run (used for the estimates below).
   *   dayaniklilik  distance   ≈ 27 000 px/run ×0.01  = 270 xp → +7 lv first run;  ≈ 3×61 830/270  ≈  690 runs to 100
   *   guc           meleeKills ≈ 350 kills/run   ×1   = 350 xp → +6 lv first run;  ≈ 5×61 830/350  ≈  880 runs (melee runs only)
   *   nisan         rangedHits ≈ 900 hits/run    ×0.25= 225 xp → +7 lv first run;  ≈ 3×61 830/225  ≈  820 runs (ranged runs only)
   *   ceviklik      nearMisses ≈ 60 /run         ×3   = 180 xp → +7 lv first run;  ≈ 2×61 830/180  ≈  690 runs
   *   buyu          skillDamage≈ 300 000 /run    ×0.001=300 xp → +6 lv first run;  ≈ 5×61 830/300  ≈ 1030 runs at
   *                 early-game damage; stronger late-game builds deal ~3× more, so in practice ≈ 400–600 runs
   *   hayatta       time       ≈ 240 s/run       ×1   = 240 xp → +7 lv first run;  ≈ 3×61 830/240  ≈  770 runs
   * → every attribute needs HUNDREDS of runs (≈ 45–70 hours of play) to reach 100.
   * ========================================================================================== */
  D.ATTR_MAX = 100;
  D.ATTRS = [
    { id: 'dayaniklilik', n: 'Dayanıklılık', icon: 'heart', src: 'distance',    factor: 0.01,  base: 3, est: 27000, col: '#E8394D',
      eff: { key: 'hpPct', per: 0.004 }, how: 'Savaşta koştukça artar.', srcN: 'Koşulan mesafe', unit: 'm', unitDiv: 50 },
    { id: 'guc',          n: 'Güç',          icon: 'fist',  src: 'meleeKills',  factor: 1,     base: 5, est: 350,   col: '#FF7A2F',
      eff: { key: 'w_kilic', per: 0.004 }, eff2: { key: 'w_orak', per: 0.004 },
      how: 'Yakın dövüş silahıyla (kılıç, orak) düşman öldürdükçe artar.', srcN: 'Yakın dövüş öldürmesi', unit: '', unitDiv: 1 },
    { id: 'nisan',        n: 'Nişancılık',   icon: 'bow',   src: 'rangedHits',  factor: 0.25,  base: 3, est: 900,   col: '#FFB020',
      eff: { key: 'w_yay', per: 0.004 }, eff2: { key: 'w_asa', per: 0.004 },
      how: 'Uzak menzilli silahla (yay, asa) isabet ettirdikçe artar.', srcN: 'Uzak menzil isabeti', unit: '', unitDiv: 1 },
    { id: 'ceviklik',     n: 'Çeviklik',     icon: 'boot',  src: 'nearMisses',  factor: 3,     base: 2, est: 60,    col: '#3EDBC8',
      eff: { key: 'dodge', per: 0.0015 }, how: 'Düşman saldırılarını kıl payı atlattıkça artar.', srcN: 'Kıl payı kaçış', unit: '', unitDiv: 1 },
    { id: 'buyu',         n: 'Büyü Gücü',    icon: 'star',  src: 'skillDamage', factor: 0.001, base: 5, est: 300000, col: '#B565FF',
      eff: { key: 'skillDmg', per: 0.004 }, how: 'Savaş yetenekleriyle hasar verdikçe artar.', srcN: 'Yetenek hasarı', unit: '', unitDiv: 1 },
    { id: 'hayatta',      n: 'Hayatta Kalma',icon: 'clock', src: 'time',        factor: 1,     base: 3, est: 240,   col: '#5BD16E',
      eff: { key: 'regen', per: 0.03 }, how: 'Savaşta hayatta kaldığın her saniye artar.', srcN: 'Savaşta geçen süre', unit: 'sn', unitDiv: 1 }
  ];

  /* ============================================================================================
   * 2.12 Run skills (level-up cards).  desc[i] = card text for reaching level i+1.
   * Extra (optional) fields: lv[i] = absolute numbers at level i+1 (dmg/dps are × hero attack, cd in s,
   * r/range in px) so battle can match the card text exactly; per = passive stat gain per level (§2.7 keys);
   * info = codex line; col = accent; rar = card frame rarity.
   * ========================================================================================== */
  D.RUN_LIMITS = { actives: 6, passives: 6 };
  D.RUN_SKILLS = [
    /* ------------------------------------------------------------------ actives */
    { id: 'kilicHalka', n: 'Dönen Kılıçlar', type: 'active', el: 'none', max: 5, rar: 2, col: '#C9CED8',
      evo: { with: 'celikYurek', to: 'kilicFirtina' },
      info: 'Etrafında dönen hayalet kılıçlar yaklaşan her şeyi doğrar.',
      desc: [
        'Etrafında 2 kılıç döner; her temasta %50 saldırı hasarı verir.',
        '+1 kılıç (toplam 3).',
        'Hasar %50 → %70 · Dönüş hızı +%20.',
        '+1 kılıç (toplam 4).',
        '+1 kılıç (toplam 5) · Hasar %70 → %90 · Yörünge +%25.'
      ],
      lv: [
        { n: 2, dmg: 0.5, r: 80,  spd: 3.0 },
        { n: 3, dmg: 0.5, r: 80,  spd: 3.0 },
        { n: 3, dmg: 0.7, r: 80,  spd: 3.6 },
        { n: 4, dmg: 0.7, r: 80,  spd: 3.6 },
        { n: 5, dmg: 0.9, r: 100, spd: 3.6 }
      ] },
    { id: 'yildirim', n: 'Yıldırım Çağrısı', type: 'active', el: 'yildirim', max: 5, rar: 3, col: '#FFE45C',
      evo: { with: 'kumSaati', to: 'gokGurultusu' },
      info: 'Kara bulutlar toplanır, rastgele düşmanlara yıldırım düşer.',
      desc: [
        'Her 2 sn’de rastgele 2 düşmana yıldırım düşer: %120 saldırı hasarı.',
        '+1 yıldırım (toplam 3).',
        'Hasar %120 → %150 · Bekleme 2 → 1,7 sn.',
        '+1 yıldırım (toplam 4).',
        '+1 yıldırım (toplam 5) · Hasar %150 → %190 · Bekleme 1,5 sn.'
      ],
      lv: [
        { n: 2, dmg: 1.2, cd: 2.0 },
        { n: 3, dmg: 1.2, cd: 2.0 },
        { n: 3, dmg: 1.5, cd: 1.7 },
        { n: 4, dmg: 1.5, cd: 1.7 },
        { n: 5, dmg: 1.9, cd: 1.5 }
      ] },
    { id: 'atesTopu', n: 'Ateş Topu', type: 'active', el: 'ates', max: 5, rar: 2, col: '#FF7A2F',
      evo: { with: 'gucTasi', to: 'cehennem' },
      info: 'En yakın düşmana patlayan, yakan ateş topları.',
      desc: [
        'En yakın düşmana ateş topu fırlatır: %100 hasar, küçük bir patlama ve 2 sn yanma.',
        '+1 ateş topu (toplam 2).',
        'Hasar %100 → %130 · Patlama alanı +%20.',
        '+1 ateş topu (toplam 3).',
        'Hasar %130 → %170 · Bekleme 1,6 → 1,2 sn · Yanma 2 → 4 sn.'
      ],
      lv: [
        { n: 1, dmg: 1.0, cd: 1.6, r: 45, burn: 2 },
        { n: 2, dmg: 1.0, cd: 1.6, r: 45, burn: 2 },
        { n: 2, dmg: 1.3, cd: 1.6, r: 54, burn: 2 },
        { n: 3, dmg: 1.3, cd: 1.6, r: 54, burn: 2 },
        { n: 3, dmg: 1.7, cd: 1.2, r: 54, burn: 4 }
      ] },
    { id: 'buzHalka', n: 'Buz Novası', type: 'active', el: 'buz', max: 5, rar: 3, col: '#7FD8FF',
      evo: { with: 'buyutec', to: 'mutlakSifir' },
      info: 'Etrafında patlayan buz dalgaları düşmanları yavaşlatır.',
      desc: [
        'Her 3 sn’de etrafında bir buz dalgası patlar: %80 hasar, 2 sn boyunca %40 yavaşlatma.',
        'Hasar %80 → %100 · Alan +%15.',
        'Bekleme 3 → 2,5 sn · Yavaşlatma %40 → %55.',
        'Hasar %100 → %130 · Alan +%15.',
        'Dalga düşmanları 1 sn dondurur · Hasar %130 → %160.'
      ],
      lv: [
        { dmg: 0.8, cd: 3.0, r: 120, slow: 0.40, slowDur: 2, freeze: 0 },
        { dmg: 1.0, cd: 3.0, r: 138, slow: 0.40, slowDur: 2, freeze: 0 },
        { dmg: 1.0, cd: 2.5, r: 138, slow: 0.55, slowDur: 2, freeze: 0 },
        { dmg: 1.3, cd: 2.5, r: 159, slow: 0.55, slowDur: 2, freeze: 0 },
        { dmg: 1.6, cd: 2.5, r: 159, slow: 0.55, slowDur: 2, freeze: 1 }
      ] },
    { id: 'zehir', n: 'Zehir Şişesi', type: 'active', el: 'zehir', max: 5, rar: 2, col: '#8BE04E',
      evo: { with: 'kanKadeh', to: 'vebaBulutu' },
      info: 'Fırlatılan şişeler yerde fokurdayan zehir gölleri bırakır.',
      desc: [
        'Rastgele bir düşmana zehir şişesi fırlatır: 3 sn süren göl saniyede %40 hasar verir.',
        '+1 şişe (toplam 2).',
        'Saniyelik hasar %40 → %55 · Göl alanı +%20.',
        '+1 şişe (toplam 3) · Süre 3 → 4 sn.',
        'Saniyelik hasar %55 → %75 · Zehirlenen düşmanlar %10 fazla hasar alır.'
      ],
      lv: [
        { n: 1, dps: 0.40, dur: 3, cd: 2.5, r: 60, amp: 0 },
        { n: 2, dps: 0.40, dur: 3, cd: 2.5, r: 60, amp: 0 },
        { n: 2, dps: 0.55, dur: 3, cd: 2.5, r: 72, amp: 0 },
        { n: 3, dps: 0.55, dur: 4, cd: 2.5, r: 72, amp: 0 },
        { n: 3, dps: 0.75, dur: 4, cd: 2.5, r: 72, amp: 0.10 }
      ] },
    { id: 'bumerang', n: 'Gölge Bıçağı', type: 'active', el: 'golge', max: 5, rar: 3, col: '#9D6BFF',
      evo: { with: 'ruzgarCizme', to: 'olumDansi' },
      info: 'Fırlatılan gölge bıçağı sahibine geri döner.',
      desc: [
        'Baktığın yöne geri dönen bir gölge bıçağı fırlatır: gidişte ve dönüşte %90 hasar, 3 düşmanı delip geçer.',
        '+1 bıçak (toplam 2).',
        'Hasar %90 → %115 · Menzil +%20.',
        '+1 bıçak (toplam 3).',
        'Hasar %115 → %150 · Sınırsız delip geçme · Uçuş hızı +%20.'
      ],
      lv: [
        { n: 1, dmg: 0.90, cd: 1.8, range: 260, pierce: 3,  spd: 1.0 },
        { n: 2, dmg: 0.90, cd: 1.8, range: 260, pierce: 3,  spd: 1.0 },
        { n: 2, dmg: 1.15, cd: 1.8, range: 312, pierce: 3,  spd: 1.0 },
        { n: 3, dmg: 1.15, cd: 1.8, range: 312, pierce: 3,  spd: 1.0 },
        { n: 3, dmg: 1.50, cd: 1.8, range: 312, pierce: 99, spd: 1.2 }
      ] },
    { id: 'meteor', n: 'Meteor', type: 'active', el: 'ates', max: 5, rar: 4, col: '#FF5A2F',
      evo: { with: 'bilgeKitap', to: 'kiyamet' },
      info: 'Gökten düşen meteorlar geniş bir alanı yerle bir eder.',
      desc: [
        'Her 5 sn’de bir düşmanın üstüne meteor düşer: geniş alanda %250 hasar.',
        'Hasar %250 → %320.',
        '+1 meteor (toplam 2) · Bekleme 5 → 4,5 sn.',
        'Hasar %320 → %400 · Patlama alanı +%20.',
        '+1 meteor (toplam 3) · Düştüğü yerde 2 sn yanan lav bırakır.'
      ],
      lv: [
        { n: 1, dmg: 2.5, cd: 5.0, r: 90,  lava: 0 },
        { n: 1, dmg: 3.2, cd: 5.0, r: 90,  lava: 0 },
        { n: 2, dmg: 3.2, cd: 4.5, r: 90,  lava: 0 },
        { n: 2, dmg: 4.0, cd: 4.5, r: 108, lava: 0 },
        { n: 3, dmg: 4.0, cd: 4.5, r: 108, lava: 2 }
      ] },
    { id: 'ruhlar', n: 'Ruh Fenerleri', type: 'active', el: 'golge', max: 5, rar: 3, col: '#3EDBC8',
      evo: { with: 'miknatis', to: 'ruhOrdusu' },
      info: 'Etrafında süzülen fenerlerdeki ruhlar düşmanlara ok atar.',
      desc: [
        'Etrafında süzülen 1 ruh feneri en yakın düşmana ruh oku atar: %60 hasar.',
        '+1 fener (toplam 2).',
        'Hasar %60 → %80 · Atış hızı +%20.',
        '+1 fener (toplam 3).',
        '+1 fener (toplam 4) · Hasar %80 → %100 · Ruh okları 1 düşmana daha seker.'
      ],
      lv: [
        { n: 1, dmg: 0.6, cd: 1.2, bounce: 0 },
        { n: 2, dmg: 0.6, cd: 1.2, bounce: 0 },
        { n: 2, dmg: 0.8, cd: 1.0, bounce: 0 },
        { n: 3, dmg: 0.8, cd: 1.0, bounce: 0 },
        { n: 4, dmg: 1.0, cd: 1.0, bounce: 1 }
      ] },

    /* ------------------------------------------------------------------ passives */
    { id: 'gucTasi', n: 'Güç Taşı', type: 'passive', el: 'none', max: 5, rar: 1, col: '#E8394D', per: { atkPct: 0.10 },
      info: 'Kızıl damarlı bir Metin parçası. Avucunda nabız gibi atar.',
      desc: ['Saldırı +%10.', 'Saldırı +%10 (toplam %20).', 'Saldırı +%10 (toplam %30).', 'Saldırı +%10 (toplam %40).', 'Saldırı +%10 (toplam %50).'] },
    { id: 'celikYurek', n: 'Çelik Yürek', type: 'passive', el: 'none', max: 5, rar: 1, col: '#C9CED8', per: { hpPct: 0.10, regen: 0.5 },
      info: 'Ne kadar yara alırsan al, yüreğin durmaz.',
      desc: ['En yüksek can +%10 · Can yenileme +0,5/sn.', 'Can +%10 (toplam %20) · Yenileme toplam 1/sn.', 'Can +%10 (toplam %30) · Yenileme toplam 1,5/sn.',
        'Can +%10 (toplam %40) · Yenileme toplam 2/sn.', 'Can +%10 (toplam %50) · Yenileme toplam 2,5/sn.'] },
    { id: 'kumSaati', n: 'Kum Saati', type: 'passive', el: 'none', max: 5, rar: 1, col: '#FFCB57', per: { cdr: 0.06 },
      info: 'İçindeki kum yukarı akar; zaman senin için yavaşlar.',
      desc: ['Bekleme süreleri -%6.', 'Bekleme -%6 (toplam %12).', 'Bekleme -%6 (toplam %18).', 'Bekleme -%6 (toplam %24).', 'Bekleme -%6 (toplam %30).'] },
    { id: 'buyutec', n: 'Büyüteç', type: 'passive', el: 'none', max: 5, rar: 1, col: '#4BA3FF', per: { area: 0.08 },
      info: 'Her şey olduğundan büyük görünür… ve büyük vurur.',
      desc: ['Etki alanı +%8.', 'Etki alanı +%8 (toplam %16).', 'Etki alanı +%8 (toplam %24).', 'Etki alanı +%8 (toplam %32).', 'Etki alanı +%8 (toplam %40).'] },
    { id: 'kanKadeh', n: 'Kan Kadehi', type: 'passive', el: 'none', max: 5, rar: 1, col: '#B0283C', per: { lifesteal: 0.015 },
      info: 'Kadehten içen, düşmanının gücünü de içer.',
      desc: ['Can çalma +%1,5.', 'Can çalma +%1,5 (toplam %3).', 'Can çalma +%1,5 (toplam %4,5).', 'Can çalma +%1,5 (toplam %6).', 'Can çalma +%1,5 (toplam %7,5).'] },
    { id: 'ruzgarCizme', n: 'Rüzgâr Çizmesi', type: 'passive', el: 'none', max: 5, rar: 1, col: '#3EDBC8', per: { spdPct: 0.06 },
      info: 'Tabanlarına rüzgâr rünü işlenmiş hafif çizmeler.',
      desc: ['Hareket hızı +%6.', 'Hız +%6 (toplam %12).', 'Hız +%6 (toplam %18).', 'Hız +%6 (toplam %24).', 'Hız +%6 (toplam %30).'] },
    { id: 'bilgeKitap', n: 'Bilge Kitabı', type: 'passive', el: 'none', max: 5, rar: 1, col: '#B565FF', per: { xpGain: 0.10 },
      info: 'Sayfaları kendiliğinden çevrilen eski bir büyü kitabı.',
      desc: ['Tecrübe kazancı +%10.', 'Tecrübe +%10 (toplam %20).', 'Tecrübe +%10 (toplam %30).', 'Tecrübe +%10 (toplam %40).', 'Tecrübe +%10 (toplam %50).'] },
    { id: 'miknatis', n: 'Mıknatıs Taşı', type: 'passive', el: 'none', max: 5, rar: 1, col: '#5BD16E', per: { pickup: 0.25 },
      info: 'Ruhları ve altını kendine çeken, uğuldayan bir taş.',
      desc: ['Toplama alanı +%25.', 'Toplama alanı +%25 (toplam %50).', 'Toplama alanı +%25 (toplam %75).', 'Toplama alanı +%25 (toplam %100).', 'Toplama alanı +%25 (toplam %125).'] },

    /* ------------------------------------------------------------------ weapon card */
    { id: 'silahUst', n: 'Silah Ustalığı', type: 'weapon', el: 'none', max: 5, rar: 4, col: '#FFCB57',
      info: 'Kuşandığın ana silahı savaşın içinde geliştirir.',
      desc: [
        'Ana silah hasarı +%20.',
        'Saldırı hızı +%15.',
        'Silah güçlenir: uzak menzilde +1 mermi, yakın dövüşte +%25 alan.',
        'Ana silah hasarı +%30 (toplam %50).',
        'USTALIK: silahın özel bir güç kazanır.'
      ],
      descBy: {
        kilic: ['Kılıç hasarı +%20.', 'Savuruş hızı +%15.', 'Kesik yayı +%25 genişler.', 'Kılıç hasarı +%30 (toplam %50).', 'USTALIK: her 3. savuruş ileri uçan bir kılıç dalgası atar.'],
        yay:   ['Ok hasarı +%20.', 'Atış hızı +%15.', '+1 ok.', 'Ok hasarı +%30 (toplam %50).', 'USTALIK: her 4. atış 5 oklu bir yelpaze olur.'],
        orak:  ['Orak hasarı +%20.', 'Savuruş hızı +%15.', 'Savuruş alanı +%25.', 'Orak hasarı +%30 (toplam %50).', 'USTALIK: savuruşlar arkasında 1 sn kesen bir gölge halkası bırakır.'],
        asa:   ['Küre hasarı +%20.', 'Atış hızı +%15.', '+1 büyü küresi.', 'Küre hasarı +%30 (toplam %50).', 'USTALIK: küreler patlayınca 3 kıvılcıma bölünür.']
      },
      lv: [
        { dmg: 0.20, rate: 0.00, extra: 0, mastery: 0 },
        { dmg: 0.20, rate: 0.15, extra: 0, mastery: 0 },
        { dmg: 0.20, rate: 0.15, extra: 1, mastery: 0 },
        { dmg: 0.50, rate: 0.15, extra: 1, mastery: 0 },
        { dmg: 0.50, rate: 0.15, extra: 1, mastery: 1 }
      ] },

    /* ------------------------------------------------------------------ evolutions */
    { id: 'kilicFirtina', n: 'Kılıç Fırtınası', type: 'evo', el: 'none', max: 1, rar: 5, col: '#E6ECF5', from: 'kilicHalka', with: 'celikYurek',
      info: 'Dönen Kılıçlar + Çelik Yürek',
      desc: ['EVRİM: 8 dev kılıç geniş bir yörüngede durmadan döner; %130 hasar verir ve düşmanları geri savurur.'],
      lv: [{ n: 8, dmg: 1.3, r: 115, spd: 4.2, knock: 1 }] },
    { id: 'gokGurultusu', n: 'Gök Gürültüsü', type: 'evo', el: 'yildirim', max: 1, rar: 5, col: '#FFF27A', from: 'yildirim', with: 'kumSaati',
      info: 'Yıldırım Çağrısı + Kum Saati',
      desc: ['EVRİM: Her saniye 6 yıldırım düşer; her biri %220 hasar verir ve yakındaki 2 düşmana sıçrar.'],
      lv: [{ n: 6, dmg: 2.2, cd: 1.0, chain: 2 }] },
    { id: 'cehennem', n: 'Cehennem Ateşi', type: 'evo', el: 'ates', max: 1, rar: 5, col: '#FF5A1F', from: 'atesTopu', with: 'gucTasi',
      info: 'Ateş Topu + Güç Taşı',
      desc: ['EVRİM: 4 dev alev küresi düşmanları delip geçer (%250 hasar) ve ardında yakıcı bir alev izi bırakır.'],
      lv: [{ n: 4, dmg: 2.5, cd: 1.0, r: 70, burn: 4, pierce: 99, trail: 1 }] },
    { id: 'mutlakSifir', n: 'Mutlak Sıfır', type: 'evo', el: 'buz', max: 1, rar: 5, col: '#BFF0FF', from: 'buzHalka', with: 'buyutec',
      info: 'Buz Novası + Büyüteç',
      desc: ['EVRİM: Etrafında sürekli bir kış girdabı döner: içindeki düşmanlar donar ve saniyede %120 hasar alır; ölenler buz kıymıklarına parçalanır.'],
      lv: [{ dps: 1.2, r: 190, freeze: 1.5, shatter: 1 }] },
    { id: 'vebaBulutu', n: 'Veba Bulutu', type: 'evo', el: 'zehir', max: 1, rar: 5, col: '#A6F06A', from: 'zehir', with: 'kanKadeh',
      info: 'Zehir Şişesi + Kan Kadehi',
      desc: ['EVRİM: Seni izleyen dev bir veba bulutu içindeki düşmanlara saniyede %90 hasar verir; verdiği hasarın %2’si sana can olarak döner.'],
      lv: [{ dps: 0.9, r: 150, follow: 1, leech: 0.02 }] },
    { id: 'olumDansi', n: 'Ölüm Dansı', type: 'evo', el: 'golge', max: 1, rar: 5, col: '#C9A4FF', from: 'bumerang', with: 'ruzgarCizme',
      info: 'Gölge Bıçağı + Rüzgâr Çizmesi',
      desc: ['EVRİM: 6 gölge bıçağı etrafında spiral çizerek savrulur: %170 hasar ve sınırsız delip geçme.'],
      lv: [{ n: 6, dmg: 1.7, cd: 1.4, pierce: 99, spiral: 1 }] },
    { id: 'kiyamet', n: 'Kıyamet Yağmuru', type: 'evo', el: 'ates', max: 1, rar: 5, col: '#FF3D1F', from: 'meteor', with: 'bilgeKitap',
      info: 'Meteor + Bilge Kitabı',
      desc: ['EVRİM: Gökyüzü yarılır! Her 2 sn’de 6 meteor yağar: %450 hasar ve 3 sn yanan lav gölleri.'],
      lv: [{ n: 6, dmg: 4.5, cd: 2.0, r: 120, lava: 3 }] },
    { id: 'ruhOrdusu', n: 'Ruh Ordusu', type: 'evo', el: 'golge', max: 1, rar: 5, col: '#7DF5E0', from: 'ruhlar', with: 'miknatis',
      info: 'Ruh Fenerleri + Mıknatıs Taşı',
      desc: ['EVRİM: 6 ruh feneri bir ordu gibi etrafını sarar; ruh okları %110 hasar verir ve 3 kez sekerek yeni hedeflere geçer.'],
      lv: [{ n: 6, dmg: 1.1, cd: 0.7, bounce: 3 }] }
  ];

  /* ============================================================================================
   * 2.13 Enemies — base numbers at chapter 1 (battle scales by CHAPTERS[i].scale and by time).
   * hp, dmg (contact damage per hit), spd (px/s; hero ≈ 160), r (px radius), xp (gem value).
   * Optional extras: d (bestiary line), col, dash/shot/puff/pack/keep/ghost, moves (bosses).
   * ========================================================================================== */
  D.ENEMIES = {
    yarasa:   { id: 'yarasa',   n: 'Kan Yarasası',     kind: 'fast',    hp: 40,   dmg: 6,  spd: 125, r: 12, xp: 1, art: 'yarasa',   col: '#C2304A',
      d: 'Metin taşlarının kızıl ışığına üşüşen, minicik ama doymak bilmeyen yarasalar.' },
    kurt:     { id: 'kurt',     n: 'Gölge Kurdu',      kind: 'charger', hp: 110,  dmg: 12, spd: 80,  r: 18, xp: 2, art: 'kurt',     col: '#3B3550',
      dash: { spd: 330, every: 3.2, dur: 0.45, range: 260, windup: 0.5 },
      d: 'Gözleri kor gibi yanan kurtlar. Durup hırlarsa kaç: atılmak üzeredir.' },
    mantar:   { id: 'mantar',   n: 'Zehirli Mantar',   kind: 'tank',    hp: 260,  dmg: 14, spd: 42,  r: 22, xp: 3, art: 'mantar',   col: '#8E3FB0',
      puff: { r: 55, dps: 6, dur: 2.5 },
      d: 'Tombul, sevimli ve ölümcül. Patladığında çevresine zehirli spor bulutu saçar.' },
    iskelet:  { id: 'iskelet',  n: 'İskelet Er',       kind: 'chase',   hp: 75,   dmg: 10, spd: 68,  r: 16, xp: 1, art: 'iskelet',  col: '#E8E2D0',
      d: 'Gölge vebasıyla ayağa kalkan eski askerler. Hâlâ emir bekliyorlar.' },
    hayalet:  { id: 'hayalet',  n: 'Ağlayan Hayalet',  kind: 'ranged',  hp: 90,   dmg: 9,  spd: 62,  r: 16, xp: 2, art: 'hayalet',  col: '#7DF5C8',
      ghost: true, keep: 220, shot: { spd: 170, dmg: 10, cd: 2.6, r: 7, n: 1, spread: 0, col: '#7DF5C8' },
      d: 'Huzur bulamamış ruhlar. Diğer düşmanların içinden süzülür, ektoplazma tükürür.' },
    orumcek:  { id: 'orumcek',  n: 'Mağara Örümceği',  kind: 'swarm',   hp: 42,   dmg: 7,  spd: 100, r: 11, xp: 1, art: 'orumcek',  col: '#4A2C5E',
      pack: 7, d: 'Asla tek gelmezler. Sekiz göz, sekiz bacak, sonsuz iştah.' },
    korCini:  { id: 'korCini',  n: 'Kor Cini',         kind: 'fast',    hp: 70,   dmg: 11, spd: 135, r: 13, xp: 2, art: 'korCini',  col: '#FF7A2F',
      d: 'Lav çatlaklarından fırlayan kıkırdayan ateş cinleri.' },
    golem:    { id: 'golem',    n: 'Taş Golem',        kind: 'tank',    hp: 2600, dmg: 28, spd: 40,  r: 38, xp: 40, art: 'golem',   col: '#7A6E8A', elite: true,
      d: 'Bir Metin taşının parçasından doğmuş dev. Göğsündeki rün kırılmadan durmaz.' },
    buyucu:   { id: 'buyucu',   n: 'Kemik Büyücü',     kind: 'ranged',  hp: 1800, dmg: 18, spd: 52,  r: 24, xp: 35, art: 'buyucu',  col: '#B565FF', elite: true,
      keep: 240, shot: { spd: 200, dmg: 16, cd: 2.0, r: 9, n: 3, spread: 0.35, col: '#B565FF' },
      d: 'Ölüleri yöneten kara büyücü. Üç yöne birden lanetli kemik mermisi atar.' },
    kurtKral: { id: 'kurtKral', n: 'Kurt Kral',        kind: 'boss',    hp: 22000, dmg: 30, spd: 95, r: 48, xp: 100, art: 'kurtKral', col: '#5A5A7A', boss: true,
      title: 'Kara Orman’ın Hükümdarı', moves: ['dash', 'howl'], summon: 'kurt',
      d: 'Metin taşının ilk kurbanı. Uluması ormandaki bütün kurtları çağırır; sonra ok gibi atılır.' },
    kemikEjder: { id: 'kemikEjder', n: 'Kemik Ejder',  kind: 'boss',    hp: 26000, dmg: 34, spd: 70, r: 56, xp: 150, art: 'kemikEjder', col: '#E8E2D0', boss: true,
      title: 'Mezarlığın Kadim Bekçisi', moves: ['breath', 'boneRain'],
      d: 'Yüzyıllar önce ölmüş bir ejderin iskeleti. Nefesi soğuk ruh alevi, gökten kemik yağdırır.' },
    korIblisi: { id: 'korIblisi', n: 'Kor İblisi',     kind: 'boss',    hp: 30000, dmg: 40, spd: 78, r: 54, xp: 200, art: 'korIblisi', col: '#FF5A1F', boss: true,
      title: 'Dağın Yanan Yüreği', moves: ['fireRing', 'meteorSlam'],
      d: 'Kor Dağı’nın kalbinden doğan iblis. Alev halkaları yayar, yere çakıldığında gökten meteor iner.' },
    metin:    { id: 'metin',    n: 'Metin Taşı',       kind: 'stone',   hp: 3000, dmg: 0,  spd: 0,   r: 34, xp: 30, art: 'metin',    col: '#9D6BFF',
      spawnEvery: 3, spawnN: 3, drop: 'chest',
      d: 'Gökten düşen lanetli taş. Kırılana kadar her 3 sn’de 3 canavar doğurur. Kırınca sandık düşer.' }
  };

  /* ============================================================================================
   * 2.14 Chapters.  waves: time segments (s) with rate = spawns/s and weighted pool.
   * ramp (extra): enemy hp × (1 + ramp.hp × minutes), dmg × (1 + ramp.dmg × minutes).
   * maxAlive (extra): soft cap on simultaneous normal enemies (performance + readability).
   * ========================================================================================== */
  D.CHAPTERS = [
    { id: 1, n: 'Kara Orman', sub: 'Kurt Kral’ın İni', theme: 'orman', dur: 240, scale: 1.0, rec: 1200, energy: 5, boss: 'kurtKral',
      col: '#6FCF5A', ramp: { hp: 0.30, dmg: 0.12 }, maxAlive: 170,
      desc: 'Metin taşlarının ilk düştüğü orman. Kurtlar artık ay ışığında değil, taşların kızıl parıltısında uluyor.',
      waves: [
        { from: 0,   to: 30,  rate: 1.0, pool: { yarasa: 3, iskelet: 2 } },
        { from: 30,  to: 60,  rate: 1.4, pool: { yarasa: 3, iskelet: 2, kurt: 1 } },
        { from: 60,  to: 100, rate: 1.9, pool: { yarasa: 2, iskelet: 2, kurt: 2, orumcek: 2 } },
        { from: 100, to: 140, rate: 2.4, pool: { iskelet: 2, kurt: 2, orumcek: 3, mantar: 1 } },
        { from: 140, to: 180, rate: 3.0, pool: { yarasa: 2, kurt: 3, orumcek: 2, mantar: 2 } },
        { from: 180, to: 240, rate: 3.6, pool: { yarasa: 3, iskelet: 2, kurt: 3, mantar: 2 } }
      ],
      events: [
        { t: 20,  type: 'ring',  e: 'yarasa',  n: 14, msg: 'Kuşatıldın!' },
        { t: 45,  type: 'metin', msg: 'Bir Metin Taşı düştü!' },
        { t: 70,  type: 'swarm', e: 'orumcek', n: 24, msg: 'Örümcek akını!' },
        { t: 90,  type: 'elite', e: 'golem',   msg: 'Elit: Taş Golem' },
        { t: 110, type: 'ring',  e: 'iskelet', n: 18, msg: 'Ölüler çevreni sardı!' },
        { t: 130, type: 'metin', msg: 'Bir Metin Taşı düştü!' },
        { t: 150, type: 'swarm', e: 'yarasa',  n: 32, msg: 'Yarasa sürüsü!' },
        { t: 170, type: 'elite', e: 'golem',   msg: 'Elit: Taş Golem' },
        { t: 190, type: 'ring',  e: 'kurt',    n: 16, msg: 'Kurt sürüsü seni çevirdi!' },
        { t: 215, type: 'boss',  e: 'kurtKral', msg: 'Kurt Kral uyandı!' }
      ],
      reward: { gold: 400, gems: 50, heroXp: 120, chest: [60, 30, 9, 1, 0, 0], shards: 5 } },

    { id: 2, n: 'Lanetli Mezarlık', sub: 'Kemik Ejder’in Mezarı', theme: 'mezarlik', dur: 240, scale: 1.8, rec: 2600, energy: 5, boss: 'kemikEjder',
      col: '#7DF5C8', ramp: { hp: 0.34, dmg: 0.14 }, maxAlive: 190,
      desc: 'Ölüler uyumuyor. Lanetli taş mezarlığın ortasına saplandığından beri kemikler kendi kendine ayağa kalkıyor.',
      waves: [
        { from: 0,   to: 30,  rate: 1.3, pool: { iskelet: 3, yarasa: 2 } },
        { from: 30,  to: 60,  rate: 1.8, pool: { iskelet: 3, yarasa: 2, hayalet: 1 } },
        { from: 60,  to: 100, rate: 2.4, pool: { iskelet: 2, hayalet: 2, orumcek: 2, yarasa: 2 } },
        { from: 100, to: 140, rate: 3.0, pool: { iskelet: 3, hayalet: 2, kurt: 2, orumcek: 2 } },
        { from: 140, to: 180, rate: 3.6, pool: { iskelet: 2, hayalet: 3, kurt: 2, mantar: 1, yarasa: 2 } },
        { from: 180, to: 240, rate: 4.2, pool: { iskelet: 3, hayalet: 3, kurt: 2, mantar: 2 } }
      ],
      events: [
        { t: 20,  type: 'ring',  e: 'iskelet', n: 16, msg: 'Mezarlar açıldı!' },
        { t: 40,  type: 'metin', msg: 'Bir Metin Taşı düştü!' },
        { t: 75,  type: 'elite', e: 'buyucu',  msg: 'Elit: Kemik Büyücü' },
        { t: 95,  type: 'swarm', e: 'yarasa',  n: 36, msg: 'Yarasa sürüsü!' },
        { t: 115, type: 'ring',  e: 'hayalet', n: 14, msg: 'Hayaletler fısıldıyor…' },
        { t: 130, type: 'metin', msg: 'Bir Metin Taşı düştü!' },
        { t: 150, type: 'elite', e: 'golem',   msg: 'Elit: Taş Golem' },
        { t: 165, type: 'swarm', e: 'orumcek', n: 36, msg: 'Örümcek akını!' },
        { t: 185, type: 'elite', e: 'buyucu',  msg: 'Elit: Kemik Büyücü' },
        { t: 200, type: 'ring',  e: 'iskelet', n: 22, msg: 'Kemik ordusu!' },
        { t: 220, type: 'boss',  e: 'kemikEjder', msg: 'Kemik Ejder topraktan yükseliyor!' }
      ],
      reward: { gold: 700, gems: 80, heroXp: 200, chest: [35, 40, 20, 4.5, 0.5, 0], shards: 8 } },

    { id: 3, n: 'Kor Dağı', sub: 'Kor İblisi’nin Kalbi', theme: 'kor', dur: 240, scale: 3.0, rec: 5200, energy: 5, boss: 'korIblisi',
      col: '#FF7A2F', ramp: { hp: 0.38, dmg: 0.16 }, maxAlive: 210,
      desc: 'Dağın yüreği kor gibi yanıyor. Lav nehirlerinin ötesinde Kor İblisi, taşların gücüyle bir ordu kuruyor.',
      waves: [
        { from: 0,   to: 30,  rate: 1.6, pool: { korCini: 3, iskelet: 2 } },
        { from: 30,  to: 60,  rate: 2.2, pool: { korCini: 3, kurt: 2, iskelet: 1 } },
        { from: 60,  to: 100, rate: 2.9, pool: { korCini: 3, kurt: 2, orumcek: 2, mantar: 1 } },
        { from: 100, to: 140, rate: 3.6, pool: { korCini: 3, kurt: 3, mantar: 2, hayalet: 1 } },
        { from: 140, to: 180, rate: 4.3, pool: { korCini: 4, kurt: 2, mantar: 2, hayalet: 2, orumcek: 2 } },
        { from: 180, to: 240, rate: 5.0, pool: { korCini: 4, kurt: 3, mantar: 3, hayalet: 2 } }
      ],
      events: [
        { t: 18,  type: 'ring',  e: 'korCini', n: 18, msg: 'Cinler kıkırdıyor!' },
        { t: 35,  type: 'metin', msg: 'Bir Metin Taşı düştü!' },
        { t: 60,  type: 'elite', e: 'golem',   msg: 'Elit: Taş Golem' },
        { t: 80,  type: 'swarm', e: 'korCini', n: 40, msg: 'Kor seli!' },
        { t: 100, type: 'metin', msg: 'Bir Metin Taşı düştü!' },
        { t: 120, type: 'elite', e: 'buyucu',  msg: 'Elit: Kemik Büyücü' },
        { t: 140, type: 'ring',  e: 'kurt',    n: 18, msg: 'Kurt sürüsü seni çevirdi!' },
        { t: 155, type: 'swarm', e: 'orumcek', n: 44, msg: 'Örümcek akını!' },
        { t: 170, type: 'elite', e: 'golem',   msg: 'Elit: Taş Golem' },
        { t: 172, type: 'elite', e: 'buyucu',  msg: 'Elit: Kemik Büyücü' },
        { t: 185, type: 'metin', msg: 'Bir Metin Taşı düştü!' },
        { t: 198, type: 'ring',  e: 'korCini', n: 26, msg: 'Ateş çemberi!' },
        { t: 222, type: 'boss',  e: 'korIblisi', msg: 'Kor İblisi lavdan doğuyor!' }
      ],
      reward: { gold: 1100, gems: 120, heroXp: 320, chest: [15, 35, 32, 14, 3.5, 0.5], shards: 12 } },

    { id: 4, n: 'Gölge Kalesi', sub: 'Gölge Kralı’nın Tahtı', theme: 'kale', dur: 240, scale: 4.5, rec: 9000, energy: 5, boss: null,
      locked: true, soon: 'Yakında', col: '#9D6BFF', ramp: { hp: 0.42, dmg: 0.18 }, maxAlive: 220,
      desc: 'Gölge Kralı’nın tahtı. Bütün lanetlerin kaynağı burada… Kapılar henüz açılmadı.',
      waves: [], events: [],
      reward: { gold: 1600, gems: 200, heroXp: 480, chest: [5, 25, 38, 24, 7, 1], shards: 16 } }
  ];

  /* ============================================================================================
   * 2.15 Economy
   * ========================================================================================== */
  D.ECON = {
    startGold: 3000, startGems: 800, energyMax: 30, energyRegenSec: 300, runEnergy: 5,
    itemUp: { goldBase: 60, goldGrow: 1.09, scroll: function (lvl) { return 1 + Math.floor(lvl / 5); } },
    goldPerKill: 1, goldPerElite: 25, goldPerMetin: 60, goldPerBoss: 250, accXpPerRun: 40,
    accXpNeed: function (L) { return 100 + 60 * L; },
    talentResetGems: 100 /* extra: SPEC §3.2 resetTalents cost */
  };

  /* ============================================================================================
   * 2.16 Starter inventory (17 items: 9 equipped, 8 in the bag)
   * ========================================================================================== */
  D.STARTER = [
    /* equipped: Nadir sword + Sıradan/İyi pieces in 8 armor slots (yuz, boyun, dizlik left empty) */
    { slot: 'silah',    rar: 2, wt: 'kilic', lvl: 5, equip: true },
    { slot: 'kafa',     rar: 1, set: 'kurt', lvl: 3, equip: true },
    { slot: 'omuz',     rar: 0, set: 'kurt', lvl: 2, equip: true },
    { slot: 'gogus',    rar: 1, set: 'gece', lvl: 3, equip: true },
    { slot: 'kol',      rar: 0, set: 'kurt', lvl: 2, equip: true },
    { slot: 'eldiven',  rar: 1, set: 'kurt', lvl: 2, equip: true },
    { slot: 'kemer',    rar: 0, set: 'kurt', lvl: 1, equip: true },
    { slot: 'pantolon', rar: 1, set: 'gece', lvl: 2, equip: true },
    { slot: 'ayak',     rar: 0, set: 'kurt', lvl: 3, equip: true },
    /* bag */
    { slot: 'gogus',    rar: 3, set: 'kor',   lvl: 1 },
    { slot: 'silah',    rar: 4, wt: 'yay',    lvl: 1 },
    { slot: 'kafa',     rar: 0, set: 'kurt',  lvl: 1 },
    { slot: 'kafa',     rar: 0, set: 'kurt',  lvl: 1 },
    { slot: 'kafa',     rar: 0, set: 'kurt',  lvl: 1 },
    { slot: 'boyun',    rar: 1, set: 'gece',  lvl: 1 },
    { slot: 'dizlik',   rar: 1, set: 'kurt',  lvl: 1 },
    { slot: 'yuz',      rar: 2, set: 'ejder', lvl: 1 }
  ];

  /* ============================================================================================
   * Extra flavour: loading / hint lines (Turkish)
   * ========================================================================================== */
  D.TIPS = [
    'Aynı yuvadan ve aynı nadirlikte 3 eşyayı birleştir: bir üst nadirlik doğar.',
    'Metin taşlarını kır: her biri bir sandık düşürür.',
    'Nitelikler yalnızca savaşarak gelişir. Koş, öldür, hayatta kal.',
    'Her kahraman her silahı kullanabilir, ama kendi silahında ustadır.',
    'Bir aktif yeteneği 5. seviyeye çıkar ve eşi olan pasifi al: EVRİM!',
    'Aynı setten 4 ve 8 zırh parçası kuşanınca set bonusu açılır.',
    'Nihai güç düşman öldürdükçe dolar. Doğru anı bekle.',
    'Elit düşmanlar taçlarıyla tanınır ve sandık düşürür.',
    'Yetenek ağacının son düğümleri savaşın kaderini değiştirir.',
    'Kıl payı kaçışlar Çeviklik niteliğini geliştirir.',
    'Enerji her 5 dakikada 1 dolar.',
    'Görünümler yalnızca süstür… ama çok havalıdır.',
    'Boss’u fazla bekletme: bir süre sonra öfkelenir ve çok daha sert vurur.',
    'Mıknatıs Taşı ile ruh taşlarını uzaktan topla, daha hızlı seviye atla.'
  ];

  /* ============================================================================================
   * Helpers (pure)
   * ========================================================================================== */
  function findBy(arr, id) {
    for (var i = 0; i < arr.length; i++) if (arr[i].id === id) return arr[i];
    return null;
  }
  D.heroById  = function (id) { return findBy(D.HEROES, id); };
  D.skillById = function (id) { return findBy(D.RUN_SKILLS, id); };
  D.slotById  = function (id) { return findBy(D.SLOTS, id); };
  D.skinById  = function (id) { return findBy(D.SKINS, id); };
  D.attrById  = function (id) { return findBy(D.ATTRS, id); };
  D.trainById = function (id) { return findBy(D.TRAINING, id); };
  D.chapterById = function (id) { return findBy(D.CHAPTERS, +id); };
  D.rarity = function (i) {
    i = Math.floor(+i || 0);
    if (i < 0) i = 0; else if (i > D.RARITIES.length - 1) i = D.RARITIES.length - 1;
    return D.RARITIES[i];
  };
  D.weaponName = function (wt, rar) {
    var a = D.WEAPON_NAMES[wt];
    return a ? a[D.RARITIES.indexOf(D.rarity(rar))] : (D.WEAPONS[wt] ? D.WEAPONS[wt].n : 'Silah');
  };

  /* talent index: nodeId -> { node, branch, hero } */
  var TIDX = {};
  D.HEROES.forEach(function (h) {
    h.talents.forEach(function (b) {
      b.nodes.forEach(function (nd) { TIDX[nd.id] = { node: nd, branch: b, hero: h }; });
    });
  });
  D.talentById = function (nodeId) { return TIDX[nodeId] || null; };
  D.talentCapacity = function (heroId) {
    var h = D.heroById(heroId), s = 0;
    if (h) h.talents.forEach(function (b) { b.nodes.forEach(function (nd) { s += nd.max; }); });
    return s;
  };

  /* attribute XP needed to go from L to L+1 (SPEC §2.11) */
  D.attrNeed = function (attrOrId, L) {
    var a = typeof attrOrId === 'string' ? D.attrById(attrOrId) : attrOrId;
    var base = a ? a.base : 3;
    return Math.round(base * Math.pow((L | 0) + 1, 1.6));
  };

  /* Turkish number formatting */
  D.fmtNum = function (v, maxFrac) {
    v = +v || 0;
    var mf = maxFrac == null ? (Math.abs(v) < 10 && v % 1 !== 0 ? 1 : 0) : maxFrac;
    try { return v.toLocaleString('tr-TR', { maximumFractionDigits: mf }); }
    catch (e) { return String(Math.round(v * Math.pow(10, mf)) / Math.pow(10, mf)).replace('.', ','); }
  };
  /* stat value -> '+%12' / '+30' / '+1' / '+2,5/sn' (signed) */
  D.fmtStat = function (key, v) {
    var L = D.STAT_LABELS[key] || { fmt: 'flat' };
    v = +v || 0;
    var sign = v < 0 ? '-' : '+', a = Math.abs(v), s;
    if (L.fmt === 'pct') {
      var p = a * 100;
      s = '%' + D.fmtNum(p, p < 1 ? 2 : 1);
    } else if (L.fmt === 'int') {
      s = D.fmtNum(Math.round(a), 0);
    } else {
      s = D.fmtNum(a, a < 100 ? 1 : 0);
    }
    return sign + s + (L.u || '');
  };
  /* 'Kılıç Hasarı +%30' */
  D.statLine = function (key, v) {
    var L = D.STAT_LABELS[key];
    return (L ? L.n : key) + ' ' + D.fmtStat(key, v);
  };
  /* list of '<label> <value>' lines for an { key:value } effect object */
  D.effLines = function (eff, mult) {
    var out = [];
    if (!eff) return out;
    mult = mult == null ? 1 : mult;
    for (var k in eff) if (Object.prototype.hasOwnProperty.call(eff, k)) out.push(D.statLine(k, eff[k] * mult));
    return out;
  };

  GM.D = D;
})(window.GM = window.GM || {});
