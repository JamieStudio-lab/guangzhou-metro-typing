/* ann.js (was announcements.js) — what Guangzhou Metro trains say and show between stops, for the LED board.
   Researched 2026-09-27. Every entry: zh (Mandarin text as announced/printed), en (English), optional yue
   (Cantonese), src = where the zh was found, enSrc = where the en was found; null = inferred (our wording).
   Source keys → ANN.SRC. 'sign:N' = row N of GZ Metro's official sign-translation standard (Chinese + English
   pairs), 'rules:N' = article N of the passenger rules. Only minimal edits to verified lines: a trailing 。 dropped,
   long ones trimmed at a clause break (note:'trimmed'). Real practice (bk360, wp): in-car announcements run
   Mandarin → Cantonese → English; safety/civility reminders are Mandarin-only and play at the END of the
   between-stop announcement, on long sections and before busy stations; the door side is announced only when it
   changes from the previous stop; since late 2022 a transfer station's announcement opens with a short
   Cantonese-opera chime (《旱天雷》). Templates: {dest}/{destEn} terminus, {stop}/{stopEn} station,
   {line}/{lineEn} line name (ANN.line), {poi}/{poiEn} places (ANN.poi) — fill with ANN.fill(). Global: a plain `const ANN` (no
   IIFE); ui.js reads it typeof-guarded. New zh text needs a tools/px/build-fonts.py re-run. */
const ANN = {
  SRC: {
    bk360: {t: '广州地铁报站示例 (360百科 mirror of the Baidu Baike entry; fan transcripts of the real in-car/platform audio, last edited 2022-06-22)', url: 'https://baike.so.com/doc/28592655-30049305.html', alt: 'https://baike.baidu.com/item/%E5%B9%BF%E5%B7%9E%E5%9C%B0%E9%93%81%E6%8A%A5%E7%AB%99%E7%A4%BA%E4%BE%8B/22925408'},
    sign: {t: '广州市地铁公共标识英文译写规范 (2024 版修编版), Guangzhou Metro — official zh/en sign wording, appendix rows', url: 'http://www.gzfao.gov.cn/attachment/0/4/4568/252388.pdf'},
    rules: {t: '广州市城市轨道交通乘客守则, 广州市交通运输局, 2024-06-26', url: 'https://jtj.gz.gov.cn/gkmlpt/content/9/9724/post_9724662.html'},
    wb26: {t: 'Guangzhou Metro official Weibo, 2026-04-28 (civility reminder)', url: 'https://www.sina.cn/news/detail/5292774926061029.html'},
    wb21: {t: 'Guangzhou Metro official Weibo, 2021-05-26 (queueing guide)', url: 'https://www.sina.cn/news/detail/5300954510655691.html'},
    bdb: {t: '广州本地宝 2021-03-29, 广州地铁为什么有时候开左门有时候开右门 (quotes the in-car door broadcast)', url: 'http://jt.gz.bendibao.com/news/2021329/291098.shtml'},
    gmw: {t: '光明网 2024-01-04, 广州地铁新规禁“声音外放” (riders quote the broadcast)', url: 'https://m.gmw.cn/2024-01/04/content_1303620795.htm'},
    gdtoday: {t: 'GDToday 2024-09-30, Brandy Spohn: magic voice behind Guangzhou Metro (quotes her English door announcement)', url: 'https://www.newsgd.com/node_d36b0ef83f/faba5ae6b8.shtml'},
    cjv: {t: 'cjvlang, Mind the Gap in Japanese, Cantonese, and Mandarin (Huangsha PA + GZ door sticker)', url: 'https://www.cjvlang.com/Spicks/thegap.html'},
    wp: {t: 'zh.wikipedia 广州地铁 §广播 (languages, order, transfer chime)', url: 'https://zh.wikipedia.org/wiki/%E5%B9%BF%E5%B7%9E%E5%9C%B0%E9%93%81'},
  },
  /* between stops, when the player pauses or types slowly (civility / safety; short enough for the marquee) */
  idle: [
    {zh: '文明和谐，请勿在车厢内大声喧哗', en: 'Please keep your voice down on the train', src: 'bk360', enSrc: null},
    {zh: '小声交谈或戴上耳机，一起守护安静舒适的乘车环境', en: 'Talk softly or use earphones - keep the ride quiet', src: 'wb26', enSrc: null, note: 'trimmed'},
    {zh: '使用电子设备时，请勿外放声音', en: 'No Loudspeakers', src: 'bk360', enSrc: 'sign:67', note: 'also gmw'},
    {zh: '共创良好乘车环境，请勿在地铁内饮食', en: 'No Eating or Drinking (Except Infants and Patients)', src: 'bk360', enSrc: 'sign:176', note: 'trimmed; rules:13'},
    {zh: '请勿在车厢内食用有刺激性气味食品', en: 'No strong-smelling food on the train, please', src: 'bk360', enSrc: null},
    {zh: '请为老人、孕妇、儿童、残疾人让座', en: 'Offer your seat to those in need', src: 'bk360', enSrc: 'sign:60'},
    {zh: '请站稳扶好', en: 'Please Stand Firm', src: 'sign:70', enSrc: 'sign:70'},
    {zh: '请坐稳扶好', en: 'For your safety, please grasp the handrail, hold the handle, or sit down', src: 'sign:62', enSrc: 'sign:62'},
    {zh: '靠近车门的乘客，请留意您的衣物，谨防被夹', en: 'Near the doors? Mind your clothes', src: 'bk360', enSrc: null, note: 'en after sign:19 Mind Your Clothes'},
    {zh: '乘车时，切勿倚靠车门，谨防被夹', en: 'No leaning on the doors', src: 'bdb', enSrc: null, note: 'en after sign:173 No Leaning; rules:17'},
    {zh: '请排队候车，先下后上', en: 'Please line up for the train. Let the passengers get off first before you get on.', src: 'bk360', enSrc: 'bk360', note: 'a platform broadcast; also wb21, rules:16'},
    {zh: '如遇突发情况请保持镇定，有需要时请使用紧急求助按钮', en: 'In an emergency stay calm and press the help button', src: 'bk360', enSrc: null, note: 'trimmed; en after sign:58 Press for Help'},
    {zh: '请勿擅自触动紧急开门装置', en: 'Emergency Use Only. Violators Will Be Prosecuted', src: 'bk360', enSrc: 'sign:55'},
    {zh: '身体不适请使用紧急求助按钮或在下一站联系工作人员', en: 'Press emergency button or contact staff at next station in a medical emergency', src: 'sign:59', enSrc: 'sign:59'},
    {zh: '地铁公安提醒您，请注意防盗防骗', en: 'Metro police: beware of theft and fraud', src: 'bk360', enSrc: null, note: 'trimmed'},
    {zh: '请留意个人财物', en: 'Mind Your Personal Belongings', src: 'sign:191', enSrc: 'sign:191'},
    {zh: '请勿乱扔果皮纸屑', en: 'No Littering', src: 'sign:61', enSrc: 'sign:61'},
    {zh: '请勿追逐打闹', en: 'No Chasing or Running', src: 'sign:63', enSrc: 'sign:63'},
    {zh: '禁止吸烟（含电子烟）', en: 'No Smoking', src: 'rules:13', enSrc: 'sign:161'},
    {zh: '请照顾好同行的老人和小孩', en: 'Watch your children and the elderly', src: null, enSrc: null, note: 'after rules:14-16 (照看好同行的…) and sign:7-8 Watch Your Children / Watch Out for the Elderly'},
  ],
  /* doors closed → the hop starts (Line 3 plays 往车厢中部走 first, then the terminus) */
  departure: [
    {id: 'middle', zh: '请上车的乘客往车厢中部走', en: 'Please move to the middle of the car', src: 'bk360', enSrc: null, note: 'Line 3 plays it at every stop'},
    {id: 'dest', zh: '本次列车终点站为：{dest}', en: 'The destination of this train is {destEn}.', src: 'bk360', enSrc: 'bk360', yue: '本次列车终点站为：{dest}'},
    {id: 'bound', zh: '本次列车开往{dest}方向', en: 'This train is bound for {destEn}.', src: 'bk360', enSrc: 'bk360', yue: '本次列车开往{dest}方向'},
    {id: 'closing', zh: '车门即将关闭，请注意安全，谨防被夹', en: 'The doors are now closing; take care of your safety and beware of being clamped', src: 'bk360', enSrc: 'gdtoday', note: 'platform broadcast'},
    {id: 'bell', zh: '灯闪铃响，请勿上下车', en: 'Do Not Get On or Off the Train When the Light Is Flashing or the Bell Buzzes', src: 'sign:43', enSrc: 'sign:43', note: 'sign reads 灯闪/铃响 请勿上下车'},
    {id: 'rush', zh: '冲门危险，顾己及人', en: 'Stand Clear of Closing Doors', src: 'sign:30', enSrc: 'sign:30'},
    {id: 'welcome', zh: '欢迎搭乘广州地铁，现在开启您的广州之旅', en: 'Welcome aboard Guangzhou Metro - your Guangzhou journey starts now', src: 'bk360', enSrc: null, note: 'Line 3 airport-section trains'},
  ],
  /* approaching the next stop (order as announced: next → transfer → door side → prepare → arriving) */
  arrival: [
    {id: 'next', zh: '下一站：{stop}', en: 'The next station is {stopEn}.', src: 'bk360', enSrc: 'bk360', yue: '下一站：{stop}'},
    {id: 'nextEnd', zh: '下一站是本次列车的终点站：{stop}', en: 'The next station is {stopEn}, the terminal of this journey.', src: 'bk360', enSrc: 'bk360'},
    {id: 'prepare', zh: '去往{poi}的乘客请准备', en: 'Passengers for {poiEn}, please get ready', src: 'bk360', enSrc: null, note: 'Mandarin only'},
    {id: 'getReady', zh: '请需要下车的乘客提前到达车门处，其他乘客主动礼让，往车厢中部靠拢', en: 'Getting off? Please move to the doors early; others please make way', src: 'bk360', enSrc: null, note: 'busy stations / long sections, Mandarin only'},
    {id: 'arriving', zh: '列车即将到达{stop}站，请小心列车与站台之间的空隙', en: 'Arriving at {stopEn}. Mind the Gap Between Train and Platform', src: 'bk360', enSrc: null, note: 'Mandarin only; gap wording = sign:29; cjv: 下车时，请注意列车与站台之间的空隙 (Huangsha)'},
    {id: 'doorsOpen', zh: '列车开门，请勿触碰车门，谨防被夹', en: 'Watch Your Hands', src: 'bk360', enSrc: null, note: 'en = sign:68 (禁止扶拉 小心夹伤)'},
    {id: 'terminus', zh: '请全部乘客带齐行李物品在此站下车，欢迎再次乘坐广州地铁', en: 'All change, please take your belongings. Thank you for riding Guangzhou Metro', src: 'bk360', enSrc: null, note: 'en after sign:189 Please take your personal belongings when leaving'},
  ],
  /* announced only when the door side changes from the previous stop (bk360, bdb) */
  door: {
    left: {zh: '请从列车前进方向的左门下车', en: 'Please exit the train to the left.', yue: '请从列车前进方向嘅左门落车', src: 'bk360', enSrc: 'bk360', note: 'also bdb'},
    right: {zh: '请从列车前进方向的右门下车', en: 'Please exit the train to the right.', yue: '请从列车前进方向嘅右门落车', src: 'bk360', enSrc: 'bk360', note: 'yue right = the left form mirrored'},
  },
  transfer: [
    {id: 'with', zh: '可换乘{line}', en: 'The interchange with {lineEn}.', src: 'bk360', enSrc: 'bk360', note: 'follows 下一站：…; several lines joined with 、 / and'},
    {id: 'getOff', zh: '需要换乘{line}的乘客请在{stop}站下车换乘', en: 'Passengers to interchange with {lineEn}, please get off at {stopEn} Station.', src: 'bk360', enSrc: 'bk360', note: 'Line 3 at 体育西路; en "Passenger"→"Passengers"'},
    {id: 'here', zh: '换乘{line}的乘客请在本站下车', en: 'Passengers for {lineEn}, please get off at this station', src: null, enSrc: null, yue: '换乘{line}嘅乘客请喺呢一站落车', note: 'short form; nearest verified: 可换乘1号线，去往3号线机场北方向的乘客请在此站下车 (bk360)'},
  ],
  /* line names as announced: 可换乘5号线 / The interchange with Line 5; APM线 / APM Line (bk360) */
  line: {l1: ['1号线', 'Line 1'], l2: ['2号线', 'Line 2'], l3: ['3号线', 'Line 3'], l4: ['4号线', 'Line 4'], l5: ['5号线', 'Line 5'], l6: ['6号线', 'Line 6'],
    l7: ['7号线', 'Line 7'], l8: ['8号线', 'Line 8'], l9: ['9号线', 'Line 9'], l10: ['10号线', 'Line 10'], l11: ['11号线', 'Line 11'], l12: ['12号线', 'Line 12'],
    l13: ['13号线', 'Line 13'], l14: ['14号线', 'Line 14'], l18: ['18号线', 'Line 18'], l21: ['21号线', 'Line 21'], l22: ['22号线', 'Line 22'],
    lgf: ['广佛线', 'Guangfo Line'], lapm: ['APM线', 'APM Line']},
  /* 去往{poi}的乘客请准备 — places named for the demo stretch (bk360 lists, trimmed to civic places; en ours) */
  poi: {
    '体育西路': {zh: '购书中心、广州市第十二人民医院', en: 'Book Center, Guangzhou No.12 People\'s Hospital'},
    '珠江新城': {zh: '广州图书馆、广州大剧院、广州市第二少年宫', en: 'Guangzhou Library, Guangzhou Opera House, Guangzhou No.2 Children\'s Palace'},
    '广州塔': {zh: '广州塔、有轨电车THZ1、广州国际媒体港、广州广播电视台', en: 'Canton Tower, Tram THZ1, Guangzhou International Media Port, Guangzhou Broadcasting Network'},
  },
  fill: (tpl, v) => tpl.replace(/\{(\w+)\}/g, (m, k) => v[k] ?? m),
  lines: (keys, lang = 'zh') => { const n = keys.map(k => ANN.line[k] ? ANN.line[k][lang === 'en' ? 1 : 0] : k);   // 1号线、5号线 · Line 1, Line 3 and Line 5
    return lang === 'en' ? n.slice(0, -1).join(', ') + (n.length > 1 ? ' and ' : '') + (n[n.length - 1] || '') : n.join('、'); },
};
