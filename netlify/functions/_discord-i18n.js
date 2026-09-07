/* Localization for the Discord bot's responses. Discord hands every
   interaction the user's client locale (`interaction.locale`); the handler
   calls setLocale() once per request, then t(key, params) anywhere in this
   or the sibling _discord-lib.js / discord-interactions.js reads it.

   Command-picker text (descriptions, option/choice names) is localized
   separately via Discord's own description_localizations — see
   scripts/register-discord-commands.mjs.

   Supported: zh (Traditional), zhs (Simplified), en, ja, fr, de, ru, es,
   ko. Anything else falls back to en. Non-en translations are
   machine-assisted and fine to correct. */

// Discord locale code -> our key.
const LOCALE_MAP = {
    'zh-TW': 'zh', 'zh-CN': 'zhs',
    'en-US': 'en', 'en-GB': 'en',
    ja: 'ja', fr: 'fr', de: 'de', ru: 'ru', ko: 'ko',
    'es-ES': 'es', 'es-419': 'es',
};
// Our keys + how they present in a /language picker (native name).
const LANG_NAMES = {
    en: 'English', zh: '繁體中文', zhs: '简体中文', ja: '日本語',
    fr: 'Français', de: 'Deutsch', ru: 'Русский', es: 'Español', ko: '한국어',
};
const KNOWN_KEYS = new Set(Object.keys(LANG_NAMES));

let current = 'en';
// Accepts either one of our keys ("zh", "en", …) as stored by /language, or
// a raw Discord locale code ("zh-TW", "en-US", …) from interaction.locale.
function setLocale(x) {
    current = KNOWN_KEYS.has(x) ? x : (LOCALE_MAP[x] || 'en');
}
function getLocale() { return current; }

// key -> { en, zh, zhs, ja, fr, de, ru, es, ko }. `{x}` / `{n}` / `{name}`
// etc. are filled from the params object.
const S = {
    // --- shared bits ---
    site_footer: { en: 'osu! Collection', zh: 'osu! 歌曲收藏', zhs: 'osu! 歌曲收藏', ja: 'osu! Collection', fr: 'osu! Collection', de: 'osu! Collection', ru: 'osu! Collection', es: 'osu! Collection', ko: 'osu! Collection' },
    api_v2: { en: 'osu! API v2', zh: 'osu! API v2', zhs: 'osu! API v2', ja: 'osu! API v2', fr: 'osu! API v2', de: 'osu! API v2', ru: 'osu! API v2', es: 'osu! API v2', ko: 'osu! API v2' },
    n_sets: { en: '{n} beatmapsets', zh: '{n} 圖組', zhs: '{n} 图组', ja: '{n} セット', fr: '{n} beatmapsets', de: '{n} Beatmapsets', ru: '{n} наборов карт', es: '{n} beatmapsets', ko: '{n} 비트맵셋' },
    sr_max: { en: 'up to {x}★', zh: '最高 {x}★', zhs: '最高 {x}★', ja: '最高 {x}★', fr: "jusqu'à {x}★", de: 'bis {x}★', ru: 'до {x}★', es: 'hasta {x}★', ko: '최고 {x}★' },
    sr_avg: { en: 'avg {x}★', zh: '平均 {x}★', zhs: '平均 {x}★', ja: '平均 {x}★', fr: 'moy. {x}★', de: 'Ø {x}★', ru: 'сред. {x}★', es: 'media {x}★', ko: '평균 {x}★' },
    mapper: { en: 'mapper: {n}', zh: 'mapper：{n}', zhs: 'mapper：{n}', ja: 'mapper：{n}', fr: 'mappeur : {n}', de: 'Mapper: {n}', ru: 'маппер: {n}', es: 'mapper: {n}', ko: '매퍼: {n}' },
    not_passed: { en: 'failed', zh: '未通過', zhs: '未通过', ja: '未クリア', fr: 'échoué', de: 'nicht bestanden', ru: 'провалено', es: 'fallado', ko: '실패' },
    unknown_command: { en: 'Unknown command.', zh: '未知指令。', zhs: '未知指令。', ja: '不明なコマンドです。', fr: 'Commande inconnue.', de: 'Unbekannter Befehl.', ru: 'Неизвестная команда.', es: 'Comando desconocido.', ko: '알 수 없는 명령어입니다.' },
    error_generic: { en: 'Something went wrong: {msg}', zh: '發生錯誤：{msg}', zhs: '发生错误：{msg}', ja: 'エラーが発生しました：{msg}', fr: 'Une erreur est survenue : {msg}', de: 'Ein Fehler ist aufgetreten: {msg}', ru: 'Произошла ошибка: {msg}', es: 'Algo salió mal: {msg}', ko: '오류가 발생했습니다: {msg}' },
    user_not_found: { en: 'Player "{name}" not found.', zh: '找不到玩家「{name}」。', zhs: '找不到玩家「{name}」。', ja: 'プレイヤー「{name}」が見つかりません。', fr: 'Joueur « {name} » introuvable.', de: 'Spieler „{name}" nicht gefunden.', ru: 'Игрок «{name}» не найден.', es: 'Jugador "{name}" no encontrado.', ko: '플레이어 "{name}" 를 찾을 수 없습니다.' },
    api_fail: { en: 'osu! API request failed, try again later.', zh: 'osu! API 查詢失敗，稍後再試。', zhs: 'osu! API 查询失败，稍后再试。', ja: 'osu! API リクエストに失敗しました。後でもう一度お試しください。', fr: "Échec de la requête à l'API osu!, réessayez plus tard.", de: 'osu!-API-Anfrage fehlgeschlagen, später erneut versuchen.', ru: 'Запрос к osu! API не удался, попробуйте позже.', es: 'Fallo en la petición a la API de osu!, inténtalo más tarde.', ko: 'osu! API 요청에 실패했습니다. 나중에 다시 시도해 주세요.' },

    // --- ago() ---
    ago_s: { en: '{n}s ago', zh: '{n} 秒前', zhs: '{n} 秒前', ja: '{n} 秒前', fr: 'il y a {n} s', de: 'vor {n} s', ru: '{n} с назад', es: 'hace {n} s', ko: '{n}초 전' },
    ago_m: { en: '{n}m ago', zh: '{n} 分鐘前', zhs: '{n} 分钟前', ja: '{n} 分前', fr: 'il y a {n} min', de: 'vor {n} Min.', ru: '{n} мин назад', es: 'hace {n} min', ko: '{n}분 전' },
    ago_h: { en: '{n}h ago', zh: '{n} 小時前', zhs: '{n} 小时前', ja: '{n} 時間前', fr: 'il y a {n} h', de: 'vor {n} Std.', ru: '{n} ч назад', es: 'hace {n} h', ko: '{n}시간 전' },
    ago_d: { en: '{n}d ago', zh: '{n} 天前', zhs: '{n} 天前', ja: '{n} 日前', fr: 'il y a {n} j', de: 'vor {n} T.', ru: '{n} дн назад', es: 'hace {n} d', ko: '{n}일 전' },
    ago_mo: { en: '{n}mo ago', zh: '{n} 個月前', zhs: '{n} 个月前', ja: '{n} か月前', fr: 'il y a {n} mois', de: 'vor {n} Mon.', ru: '{n} мес назад', es: 'hace {n} meses', ko: '{n}개월 전' },
    ago_y: { en: '{n}y ago', zh: '{n} 年前', zhs: '{n} 年前', ja: '{n} 年前', fr: 'il y a {n} ans', de: 'vor {n} J.', ru: '{n} г назад', es: 'hace {n} años', ko: '{n}년 전' },

    // --- /link /unlink ---
    link_need_name: { en: 'Please give an osu! username or ID.', zh: '請提供 osu! 使用者名稱或 ID。', zhs: '请提供 osu! 用户名或 ID。', ja: 'osu! のユーザー名または ID を指定してください。', fr: "Indiquez un nom d'utilisateur ou un ID osu!.", de: 'Bitte einen osu!-Namen oder eine ID angeben.', ru: 'Укажите имя пользователя или ID osu!.', es: 'Indica un nombre de usuario o ID de osu!.', ko: 'osu! 사용자 이름 또는 ID를 입력해 주세요.' },
    link_done: { en: 'Linked **{name}** (#{id}). `/pp`, `/recent` and `/top` now work without a name.', zh: '已綁定 **{name}**（#{id}）。現在 `/pp`、`/recent`、`/top` 可以不帶名稱。', zhs: '已绑定 **{name}**（#{id}）。现在 `/pp`、`/recent`、`/top` 可以不带名称。', ja: '**{name}**（#{id}）を連携しました。これで `/pp`・`/recent`・`/top` を名前なしで使えます。', fr: '**{name}** (#{id}) lié. `/pp`, `/recent` et `/top` fonctionnent maintenant sans nom.', de: '**{name}** (#{id}) verknüpft. `/pp`, `/recent` und `/top` funktionieren jetzt ohne Namen.', ru: 'Привязан **{name}** (#{id}). Теперь `/pp`, `/recent` и `/top` работают без имени.', es: '**{name}** (#{id}) vinculado. `/pp`, `/recent` y `/top` ya funcionan sin nombre.', ko: '**{name}** (#{id}) 연동 완료. 이제 `/pp`, `/recent`, `/top` 를 이름 없이 사용할 수 있습니다.' },
    unlink_done: { en: 'Unlinked.', zh: '已解除綁定。', zhs: '已解除绑定。', ja: '連携を解除しました。', fr: 'Dissocié.', de: 'Verknüpfung aufgehoben.', ru: 'Привязка снята.', es: 'Desvinculado.', ko: '연동을 해제했습니다.' },
    need_name_or_link: { en: 'Add an osu! name, or link your account with `/link`.', zh: '請帶上 osu! 名稱，或先用 `/link` 綁定你的帳號。', zhs: '请带上 osu! 名称，或先用 `/link` 绑定你的账号。', ja: 'osu! の名前を指定するか、まず `/link` でアカウントを連携してください。', fr: 'Ajoutez un nom osu!, ou liez votre compte avec `/link`.', de: 'Gib einen osu!-Namen an oder verknüpfe dein Konto mit `/link`.', ru: 'Укажите имя osu! или привяжите аккаунт через `/link`.', es: 'Añade un nombre de osu!, o vincula tu cuenta con `/link`.', ko: 'osu! 이름을 입력하거나 `/link` 로 계정을 먼저 연동하세요.' },

    // --- /pp ---
    f_pp: { en: 'PP', zh: 'PP', zhs: 'PP', ja: 'PP', fr: 'PP', de: 'PP', ru: 'PP', es: 'PP', ko: 'PP' },
    f_global_rank: { en: 'Global rank', zh: '全球排名', zhs: '全球排名', ja: '世界ランク', fr: 'Rang mondial', de: 'Weltrang', ru: 'Мировой ранг', es: 'Ranking global', ko: '전체 순위' },
    f_country_rank: { en: '{cc} rank', zh: '{cc} 排名', zhs: '{cc} 排名', ja: '{cc} ランク', fr: 'Rang {cc}', de: 'Rang {cc}', ru: 'Ранг {cc}', es: 'Ranking {cc}', ko: '{cc} 순위' },
    country_word: { en: 'Country', zh: '國內', zhs: '国内', ja: '国内', fr: 'Pays', de: 'Land', ru: 'Страна', es: 'País', ko: '국내' },
    f_acc: { en: 'Accuracy', zh: '準度', zhs: '准度', ja: '精度', fr: 'Précision', de: 'Genauigkeit', ru: 'Точность', es: 'Precisión', ko: '정확도' },
    f_playcount: { en: 'Play count', zh: '遊玩次數', zhs: '游玩次数', ja: 'プレイ回数', fr: 'Parties jouées', de: 'Spielanzahl', ru: 'Игр сыграно', es: 'Partidas', ko: '플레이 횟수' },
    f_level: { en: 'Level', zh: '等級', zhs: '等级', ja: 'レベル', fr: 'Niveau', de: 'Level', ru: 'Уровень', es: 'Nivel', ko: '레벨' },
    f_max_combo: { en: 'Max combo', zh: '最大連擊', zhs: '最大连击', ja: '最大コンボ', fr: 'Combo max', de: 'Max. Combo', ru: 'Макс. комбо', es: 'Combo máx.', ko: '최대 콤보' },
    f_playtime: { en: 'Play time', zh: '遊玩時間', zhs: '游玩时间', ja: 'プレイ時間', fr: 'Temps de jeu', de: 'Spielzeit', ru: 'Время игры', es: 'Tiempo jugado', ko: '플레이 시간' },
    f_grades: { en: 'Grades', zh: '成績', zhs: '成绩', ja: 'ランク', fr: 'Notes', de: 'Wertungen', ru: 'Оценки', es: 'Calificaciones', ko: '등급' },
    hours: { en: '{n} h', zh: '{n} 小時', zhs: '{n} 小时', ja: '{n} 時間', fr: '{n} h', de: '{n} Std.', ru: '{n} ч', es: '{n} h', ko: '{n} 시간' },
    footer_rank_trend: { en: 'Rank trend: last 90 days · osu! API v2', zh: '排名走勢：近 90 天 · osu! API v2', zhs: '排名走势：近 90 天 · osu! API v2', ja: 'ランク推移：直近90日 · osu! API v2', fr: 'Évolution du rang : 90 derniers jours · osu! API v2', de: 'Rangverlauf: letzte 90 Tage · osu! API v2', ru: 'Динамика ранга: 90 дней · osu! API v2', es: 'Evolución del ranking: últimos 90 días · osu! API v2', ko: '순위 추이: 최근 90일 · osu! API v2' },

    // --- /recent /top ---
    recent_none: { en: '{name} has no recent {mode} scores (osu! only keeps the last 24 h).', zh: '{name} 最近沒有 {mode} 成績（osu! 只保留最近 24 小時內的遊玩）。', zhs: '{name} 最近没有 {mode} 成绩（osu! 只保留最近 24 小时内的游玩）。', ja: '{name} に最近の {mode} スコアがありません（osu! は直近24時間のみ保持）。', fr: "{name} n'a aucun score {mode} récent (osu! ne garde que les 24 dernières h).", de: '{name} hat keine aktuellen {mode}-Scores (osu! behält nur die letzten 24 h).', ru: 'У {name} нет недавних результатов {mode} (osu! хранит только за 24 ч).', es: '{name} no tiene puntuaciones recientes de {mode} (osu! solo guarda las últimas 24 h).', ko: '{name} 님의 최근 {mode} 기록이 없습니다 (osu! 는 최근 24시간만 보관).' },
    top_none: { en: '{name} has no best {mode} scores.', zh: '{name} 沒有 {mode} 的最佳成績。', zhs: '{name} 没有 {mode} 的最佳成绩。', ja: '{name} に {mode} のベストスコアがありません。', fr: "{name} n'a aucun meilleur score {mode}.", de: '{name} hat keine {mode}-Bestscores.', ru: 'У {name} нет лучших результатов {mode}.', es: '{name} no tiene mejores puntuaciones de {mode}.', ko: '{name} 님의 {mode} 최고 기록이 없습니다.' },
    top_no_nth: { en: '{name} has no #{idx} {mode} score.', zh: '{name} 沒有第 {idx} 名的 {mode} 成績。', zhs: '{name} 没有第 {idx} 名的 {mode} 成绩。', ja: '{name} に {mode} の {idx} 位のスコアがありません。', fr: "{name} n'a pas de score {mode} au rang #{idx}.", de: '{name} hat keinen {mode}-Score auf Platz #{idx}.', ru: 'У {name} нет результата {mode} на месте #{idx}.', es: '{name} no tiene una puntuación de {mode} en el puesto #{idx}.', ko: '{name} 님의 {mode} {idx}위 기록이 없습니다.' },
    top_title: { en: "{name} — {mode} top {n}", zh: '{name} — {mode} 最佳 {n} 名', zhs: '{name} — {mode} 最佳 {n} 名', ja: '{name} — {mode} ベスト {n}', fr: '{name} — top {n} {mode}', de: '{name} — {mode} Top {n}', ru: '{name} — топ-{n} {mode}', es: '{name} — top {n} de {mode}', ko: '{name} — {mode} 상위 {n}' },

    // --- /map ---
    map_not_found: { en: "Can't find that map.", zh: '找不到這張圖。', zhs: '找不到这张图。', ja: 'その譜面が見つかりません。', fr: 'Impossible de trouver cette map.', de: 'Diese Map wurde nicht gefunden.', ru: 'Не удалось найти эту карту.', es: 'No se encuentra ese mapa.', ko: '해당 맵을 찾을 수 없습니다.' },
    map_set_not_found: { en: "Can't find that beatmapset.", zh: '找不到這個圖組。', zhs: '找不到这个图组。', ja: 'そのビートマップセットが見つかりません。', fr: 'Impossible de trouver ce beatmapset.', de: 'Dieses Beatmapset wurde nicht gefunden.', ru: 'Не удалось найти этот набор карт.', es: 'No se encuentra ese beatmapset.', ko: '해당 비트맵셋을 찾을 수 없습니다.' },
    map_set_no_diffs: { en: 'That set has no difficulty data.', zh: '這個圖組沒有難度資料。', zhs: '这个图组没有难度数据。', ja: 'このセットには難易度データがありません。', fr: 'Ce set ne contient aucune donnée de difficulté.', de: 'Dieses Set hat keine Schwierigkeitsdaten.', ru: 'В этом наборе нет данных о сложности.', es: 'Ese set no tiene datos de dificultad.', ko: '이 셋에는 난이도 데이터가 없습니다.' },
    map_need_link: { en: 'Paste an osu! beatmap link or ID.', zh: '請貼 osu! 圖譜連結或 ID。', zhs: '请贴 osu! 图谱链接或 ID。', ja: 'osu! の譜面リンクまたは ID を貼ってください。', fr: "Collez un lien ou un ID de beatmap osu!.", de: 'Füge einen osu!-Beatmap-Link oder eine ID ein.', ru: 'Вставьте ссылку на карту osu! или ID.', es: 'Pega un enlace o ID de beatmap de osu!.', ko: 'osu! 비트맵 링크 또는 ID를 붙여넣으세요.' },
    f_difficulty: { en: 'Difficulty', zh: '難度', zhs: '难度', ja: '難易度', fr: 'Difficulté', de: 'Schwierigkeit', ru: 'Сложность', es: 'Dificultad', ko: '난이도' },
    f_length: { en: 'Length', zh: '長度', zhs: '长度', ja: '長さ', fr: 'Durée', de: 'Länge', ru: 'Длина', es: 'Duración', ko: '길이' },
    f_status: { en: 'Status', zh: '狀態', zhs: '状态', ja: 'ステータス', fr: 'Statut', de: 'Status', ru: 'Статус', es: 'Estado', ko: '상태' },
    f_pp_fc: { en: 'PP (FC)', zh: 'PP（FC）', zhs: 'PP（FC）', ja: 'PP（FC）', fr: 'PP (FC)', de: 'PP (FC)', ru: 'PP (FC)', es: 'PP (FC)', ko: 'PP (FC)' },

    // --- /mappool ---
    mappool_need_edition: { en: 'Pick an edition (e.g. OWC/2024).', zh: '請選一個賽事版本（例如 OWC/2024）。', zhs: '请选一个赛事版本（例如 OWC/2024）。', ja: '大会（例：OWC/2024）を選んでください。', fr: 'Choisissez une édition (ex. OWC/2024).', de: 'Wähle eine Ausgabe (z. B. OWC/2024).', ru: 'Выберите турнир (напр. OWC/2024).', es: 'Elige una edición (p. ej. OWC/2024).', ko: '대회를 선택하세요 (예: OWC/2024).' },
    mappool_not_found: { en: 'Edition not found. Pick one from autocomplete.', zh: '找不到這個賽事版本。用自動補完選一個。', zhs: '找不到这个赛事版本。用自动补全选一个。', ja: '大会が見つかりません。オートコンプリートから選んでください。', fr: "Édition introuvable. Choisissez-en une dans l'autocomplétion.", de: 'Ausgabe nicht gefunden. Wähle eine per Autovervollständigung.', ru: 'Турнир не найден. Выберите из автодополнения.', es: 'Edición no encontrada. Elige una del autocompletado.', ko: '대회를 찾을 수 없습니다. 자동완성에서 선택하세요.' },
    mappool_fail: { en: 'World Cup mappool lookup failed, try again later.', zh: '世界盃圖池查詢失敗，稍後再試。', zhs: '世界杯图池查询失败，稍后再试。', ja: 'ワールドカップのマッププール取得に失敗しました。後で再試行してください。', fr: 'Échec de la récupération du mappool World Cup, réessayez plus tard.', de: 'Abruf des World-Cup-Mappools fehlgeschlagen, später erneut versuchen.', ru: 'Не удалось загрузить маппул World Cup, попробуйте позже.', es: 'Fallo al obtener el mappool de la World Cup, inténtalo más tarde.', ko: '월드컵 맵풀 조회에 실패했습니다. 나중에 다시 시도하세요.' },
    mappool_fail_short: { en: 'World Cup mappool lookup failed', zh: '世界盃圖池查詢失敗', zhs: '世界杯图池查询失败', ja: 'ワールドカップのマッププール取得に失敗', fr: 'Échec de la récupération du mappool World Cup', de: 'World-Cup-Mappool-Abruf fehlgeschlagen', ru: 'Не удалось загрузить маппул World Cup', es: 'Fallo al obtener el mappool de la World Cup', ko: '월드컵 맵풀 조회 실패' },
    mappool_round_not_found: { en: '"{label}" has no round matching "{q}".', zh: '「{label}」沒有符合「{q}」的輪次。', zhs: '「{label}」没有符合「{q}」的轮次。', ja: '「{label}」に「{q}」に一致するラウンドがありません。', fr: '« {label} » n\'a aucun round correspondant à « {q} ».', de: '„{label}" hat keine Runde, die zu „{q}" passt.', ru: 'В «{label}» нет раунда, соответствующего «{q}».', es: '"{label}" no tiene ninguna ronda que coincida con "{q}".', ko: '"{label}" 에 "{q}" 와 일치하는 라운드가 없습니다.' },
    mappool_round_not_found2: { en: 'Round not found', zh: '找不到輪次', zhs: '找不到轮次', ja: 'ラウンドが見つかりません', fr: 'Round introuvable', de: 'Runde nicht gefunden', ru: 'Раунд не найден', es: 'Ronda no encontrada', ko: '라운드를 찾을 수 없음' },
    mappool_round_empty: { en: '(no resolved maps in this round yet)', zh: '（這一輪還沒有解析好的圖）', zhs: '（这一轮还没有解析好的图）', ja: '（このラウンドの譜面はまだ解決されていません）', fr: '(aucune map résolue dans ce round pour l\'instant)', de: '(noch keine aufgelösten Maps in dieser Runde)', ru: '(в этом раунде пока нет разобранных карт)', es: '(aún no hay mapas resueltos en esta ronda)', ko: '(이 라운드에 아직 확인된 맵이 없습니다)' },
    mappool_rounds_title: { en: '{label} — {n} rounds', zh: '{label} — {n} 輪', zhs: '{label} — {n} 轮', ja: '{label} — {n} ラウンド', fr: '{label} — {n} rounds', de: '{label} — {n} Runden', ru: '{label} — {n} раундов', es: '{label} — {n} rondas', ko: '{label} — {n} 라운드' },
    mappool_no_data: { en: '(no data yet)', zh: '（尚無資料）', zhs: '（尚无数据）', ja: '（データがありません）', fr: '(pas encore de données)', de: '(noch keine Daten)', ru: '(пока нет данных)', es: '(sin datos todavía)', ko: '(아직 데이터 없음)' },
    mappool_round_hint: { en: 'Use /mappool round:<name> for one round', zh: '用 /mappool round:<輪次> 看單輪圖池', zhs: '用 /mappool round:<轮次> 看单轮图池', ja: '単一ラウンドは /mappool round:<ラウンド名> で表示', fr: 'Utilisez /mappool round:<nom> pour un seul round', de: '/mappool round:<Name> für eine einzelne Runde', ru: '/mappool round:<название> — для одного раунда', es: 'Usa /mappool round:<nombre> para una sola ronda', ko: '단일 라운드는 /mappool round:<이름>' },
    mappool_footer: { en: 'World Cup mappools', zh: '世界盃圖池', zhs: '世界杯图池', ja: 'ワールドカップ・マッププール', fr: 'Mappools World Cup', de: 'World-Cup-Mappools', ru: 'Маппулы World Cup', es: 'Mappools de la World Cup', ko: '월드컵 맵풀' },
    mappool_ac_meta: { en: '{r} rounds / {m} maps', zh: '{r} 輪 / {m} 圖', zhs: '{r} 轮 / {m} 图', ja: '{r} ラウンド / {m} 譜面', fr: '{r} rounds / {m} maps', de: '{r} Runden / {m} Maps', ru: '{r} раундов / {m} карт', es: '{r} rondas / {m} mapas', ko: '{r} 라운드 / {m} 맵' },
    mappool_page_footer: { en: '{round} · page {p}/{pages} · {n} maps', zh: '{round} · 第 {p}/{pages} 頁 · 共 {n} 圖', zhs: '{round} · 第 {p}/{pages} 页 · 共 {n} 图', ja: '{round} · {p}/{pages} ページ · 全 {n} 譜面', fr: '{round} · page {p}/{pages} · {n} maps', de: '{round} · Seite {p}/{pages} · {n} Maps', ru: '{round} · стр. {p}/{pages} · {n} карт', es: '{round} · página {p}/{pages} · {n} mapas', ko: '{round} · {p}/{pages} 페이지 · {n} 맵' },
    btn_prev: { en: '◀ Prev', zh: '◀ 上一頁', zhs: '◀ 上一页', ja: '◀ 前へ', fr: '◀ Préc.', de: '◀ Zurück', ru: '◀ Назад', es: '◀ Ant.', ko: '◀ 이전' },
    btn_next: { en: 'Next ▶', zh: '下一頁 ▶', zhs: '下一页 ▶', ja: '次へ ▶', fr: 'Suiv. ▶', de: 'Weiter ▶', ru: 'Вперёд ▶', es: 'Sig. ▶', ko: '다음 ▶' },

    // --- /skin ---
    skin_need_query: { en: 'Enter a skin name or author.', zh: '請輸入皮膚名稱或作者。', zhs: '请输入皮肤名称或作者。', ja: 'スキン名または作者を入力してください。', fr: "Saisissez un nom de skin ou un auteur.", de: 'Gib einen Skin-Namen oder Autor ein.', ru: 'Введите название скина или автора.', es: 'Escribe un nombre de skin o autor.', ko: '스킨 이름 또는 제작자를 입력하세요.' },
    skin_fail: { en: 'Skin library lookup failed, try again later.', zh: '皮膚庫查詢失敗，稍後再試。', zhs: '皮肤库查询失败，稍后再试。', ja: 'スキンライブラリの取得に失敗しました。後で再試行してください。', fr: 'Échec de la recherche dans la bibliothèque de skins, réessayez plus tard.', de: 'Skin-Bibliothek-Abruf fehlgeschlagen, später erneut versuchen.', ru: 'Не удалось загрузить библиотеку скинов, попробуйте позже.', es: 'Fallo al buscar en la biblioteca de skins, inténtalo más tarde.', ko: '스킨 라이브러리 조회에 실패했습니다. 나중에 다시 시도하세요.' },
    skin_not_found: { en: 'No skins matching "{q}".', zh: '找不到符合「{q}」的皮膚。', zhs: '找不到符合「{q}」的皮肤。', ja: '「{q}」に一致するスキンが見つかりません。', fr: 'Aucun skin ne correspond à « {q} ».', de: 'Keine Skins passend zu „{q}".', ru: 'Скины по запросу «{q}» не найдены.', es: 'No hay skins que coincidan con "{q}".', ko: '"{q}" 와 일치하는 스킨이 없습니다.' },
    skin_author: { en: 'Author: {n}', zh: '作者：{n}', zhs: '作者：{n}', ja: '作者：{n}', fr: 'Auteur : {n}', de: 'Autor: {n}', ru: 'Автор: {n}', es: 'Autor: {n}', ko: '제작자: {n}' },
    skin_sharer: { en: 'Shared by: {n}', zh: '分享者：{n}', zhs: '分享者：{n}', ja: '共有者：{n}', fr: 'Partagé par : {n}', de: 'Geteilt von: {n}', ru: 'Поделился: {n}', es: 'Compartido por: {n}', ko: '공유자: {n}' },
    skin_more: { en: 'More results:', zh: '其他結果：', zhs: '其他结果：', ja: 'その他の結果：', fr: 'Autres résultats :', de: 'Weitere Ergebnisse:', ru: 'Ещё результаты:', es: 'Más resultados:', ko: '더 많은 결과:' },
    skin_footer: { en: 'Skin library', zh: '皮膚庫', zhs: '皮肤库', ja: 'スキンライブラリ', fr: 'Bibliothèque de skins', de: 'Skin-Bibliothek', ru: 'Библиотека скинов', es: 'Biblioteca de skins', ko: '스킨 라이브러리' },

    // --- /collection ---
    collection_need_query: { en: 'Enter a publisher name, collection ID or category keyword.', zh: '請輸入發佈者名稱、收藏 ID 或分類關鍵字。', zhs: '请输入发布者名称、收藏 ID 或分类关键字。', ja: '公開者名・コレクション ID・カテゴリのキーワードを入力してください。', fr: "Saisissez un nom d'auteur, un ID de collection ou un mot-clé de catégorie.", de: 'Gib einen Namen, eine Sammlungs-ID oder ein Kategorie-Stichwort ein.', ru: 'Введите имя автора, ID коллекции или ключевое слово категории.', es: 'Escribe un nombre, un ID de colección o una palabra clave de categoría.', ko: '게시자 이름, 컬렉션 ID 또는 카테고리 키워드를 입력하세요.' },
    collection_not_found: { en: 'No published collection matching "{q}". Try `/gallery`.', zh: '找不到符合「{q}」的已發佈收藏。試試 `/gallery`。', zhs: '找不到符合「{q}」的已发布收藏。试试 `/gallery`。', ja: '「{q}」に一致する公開コレクションが見つかりません。`/gallery` をお試しください。', fr: 'Aucune collection publiée ne correspond à « {q} ». Essayez `/gallery`.', de: 'Keine veröffentlichte Sammlung passt zu „{q}". Versuch `/gallery`.', ru: 'Нет опубликованных коллекций по запросу «{q}». Попробуйте `/gallery`.', es: 'Ninguna colección publicada coincide con "{q}". Prueba `/gallery`.', ko: '"{q}" 와 일치하는 공개 컬렉션이 없습니다. `/gallery` 를 사용해 보세요.' },
    collection_title: { en: "{name}'s osu! collection", zh: '{name} 的 osu! 收藏', zhs: '{name} 的 osu! 收藏', ja: '{name} の osu! コレクション', fr: 'Collection osu! de {name}', de: 'osu!-Sammlung von {name}', ru: 'osu!-коллекция {name}', es: 'Colección de osu! de {name}', ko: '{name} 님의 osu! 컬렉션' },
    f_mode_split: { en: 'Mode split', zh: '模式分佈', zhs: '模式分布', ja: 'モード内訳', fr: 'Répartition par mode', de: 'Modus-Verteilung', ru: 'По режимам', es: 'Reparto por modo', ko: '모드 분포' },
    f_categories: { en: 'Categories ({n})', zh: '分類 ({n})', zhs: '分类 ({n})', ja: 'カテゴリ ({n})', fr: 'Catégories ({n})', de: 'Kategorien ({n})', ru: 'Категории ({n})', es: 'Categorías ({n})', ko: '카테고리 ({n})' },
    btn_open_collection: { en: 'Open collection', zh: '開啟收藏', zhs: '打开收藏', ja: 'コレクションを開く', fr: 'Ouvrir la collection', de: 'Sammlung öffnen', ru: 'Открыть коллекцию', es: 'Abrir colección', ko: '컬렉션 열기' },
    btn_owner_profile: { en: "Publisher's profile", zh: '發佈者主頁', zhs: '发布者主页', ja: '公開者のプロフィール', fr: "Profil de l'auteur", de: 'Profil des Erstellers', ru: 'Профиль автора', es: 'Perfil del autor', ko: '게시자 프로필' },
    btn_random_map: { en: '🎲 Random map', zh: '🎲 隨機一張圖', zhs: '🎲 随机一张图', ja: '🎲 ランダムな1譜面', fr: '🎲 Map aléatoire', de: '🎲 Zufällige Map', ru: '🎲 Случайная карта', es: '🎲 Mapa al azar', ko: '🎲 랜덤 맵' },
    btn_reroll: { en: '🎲 Reroll', zh: '🎲 再抽一張', zhs: '🎲 再抽一张', ja: '🎲 もう一度', fr: '🎲 Relancer', de: '🎲 Neu würfeln', ru: '🎲 Ещё раз', es: '🎲 Otro', ko: '🎲 다시 뽑기' },
    collection_gone: { en: 'This collection no longer exists', zh: '這份收藏已不存在', zhs: '这份收藏已不存在', ja: 'このコレクションは存在しません', fr: "Cette collection n'existe plus", de: 'Diese Sammlung existiert nicht mehr', ru: 'Эта коллекция больше не существует', es: 'Esta colección ya no existe', ko: '이 컬렉션은 더 이상 존재하지 않습니다' },
    collection_empty: { en: 'This collection is empty', zh: '這份收藏是空的', zhs: '这份收藏是空的', ja: 'このコレクションは空です', fr: 'Cette collection est vide', de: 'Diese Sammlung ist leer', ru: 'Эта коллекция пуста', es: 'Esta colección está vacía', ko: '이 컬렉션은 비어 있습니다' },
    collection_from: { en: "From {name}'s collection", zh: '來自 {name} 的收藏', zhs: '来自 {name} 的收藏', ja: '{name} のコレクションより', fr: 'De la collection de {name}', de: 'Aus der Sammlung von {name}', ru: 'Из коллекции {name}', es: 'De la colección de {name}', ko: '{name} 님의 컬렉션에서' },
    n_sets_total: { en: '{n} sets total', zh: '共 {n} 圖組', zhs: '共 {n} 图组', ja: '全 {n} セット', fr: '{n} sets au total', de: '{n} Sets insgesamt', ru: 'всего {n} наборов', es: '{n} sets en total', ko: '총 {n} 셋' },

    // --- /gallery ---
    gallery_fail: { en: 'Failed to load the gallery, try again later.', zh: '讀取收藏廣場失敗，稍後再試。', zhs: '读取收藏广场失败，稍后再试。', ja: 'ギャラリーの読み込みに失敗しました。後で再試行してください。', fr: 'Échec du chargement de la galerie, réessayez plus tard.', de: 'Galerie konnte nicht geladen werden, später erneut versuchen.', ru: 'Не удалось загрузить галерею, попробуйте позже.', es: 'Fallo al cargar la galería, inténtalo más tarde.', ko: '갤러리를 불러오지 못했습니다. 나중에 다시 시도하세요.' },
    gallery_empty: { en: 'No collections on this page.', zh: '這一頁沒有收藏。', zhs: '这一页没有收藏。', ja: 'このページにコレクションはありません。', fr: 'Aucune collection sur cette page.', de: 'Keine Sammlungen auf dieser Seite.', ru: 'На этой странице нет коллекций.', es: 'No hay colecciones en esta página.', ko: '이 페이지에는 컬렉션이 없습니다.' },
    gallery_title: { en: 'Gallery — latest published', zh: '收藏廣場 — 最新發佈', zhs: '收藏广场 — 最新发布', ja: 'ギャラリー — 最新の公開', fr: 'Galerie — dernières publications', de: 'Galerie — zuletzt veröffentlicht', ru: 'Галерея — последние публикации', es: 'Galería — publicaciones recientes', ko: '갤러리 — 최신 공개' },
    gallery_footer: { en: 'Page {p} · {total} total', zh: '第 {p} 頁 · 共 {total} 份', zhs: '第 {p} 页 · 共 {total} 份', ja: '{p} ページ · 全 {total} 件', fr: 'Page {p} · {total} au total', de: 'Seite {p} · {total} insgesamt', ru: 'Стр. {p} · всего {total}', es: 'Página {p} · {total} en total', ko: '{p} 페이지 · 총 {total}' },
    gallery_open: { en: 'Open', zh: '開啟', zhs: '打开', ja: '開く', fr: 'Ouvrir', de: 'Öffnen', ru: 'Открыть', es: 'Abrir', ko: '열기' },

    // --- /farm ---
    farm_query_fail: { en: 'Farm-maps database lookup failed, try again later.', zh: '農分圖資料庫查詢失敗，稍後再試。', zhs: '农分图数据库查询失败，稍后再试。', ja: '効率譜面データベースの取得に失敗しました。後で再試行してください。', fr: 'Échec de la requête à la base de farm maps, réessayez plus tard.', de: 'Abfrage der Farm-Maps-Datenbank fehlgeschlagen, später erneut versuchen.', ru: 'Не удалось запросить базу фарм-карт, попробуйте позже.', es: 'Fallo al consultar la base de farm maps, inténtalo más tarde.', ko: '파밍 맵 데이터베이스 조회에 실패했습니다. 나중에 다시 시도하세요.' },
    farm_none: { en: 'No farm maps for {mode} · {mods} in {band}. Widen the filters.', zh: '{mode} · {mods} 在 {band} 沒有農分圖，放寬條件看看。', zhs: '{mode} · {mods} 在 {band} 没有农分图，放宽条件看看。', ja: '{mode} · {mods} の {band} に該当する効率譜面がありません。条件を緩めてください。', fr: 'Aucune farm map pour {mode} · {mods} dans {band}. Élargissez les filtres.', de: 'Keine Farm-Maps für {mode} · {mods} in {band}. Filter erweitern.', ru: 'Нет фарм-карт для {mode} · {mods} в {band}. Расширьте фильтры.', es: 'No hay farm maps para {mode} · {mods} en {band}. Amplía los filtros.', ko: '{band} 범위의 {mode} · {mods} 파밍 맵이 없습니다. 조건을 넓혀 보세요.' },
    farm_pick_fail: { en: 'Draw failed, try again.', zh: '抽取失敗，再試一次。', zhs: '抽取失败，再试一次。', ja: '抽選に失敗しました。もう一度お試しください。', fr: 'Échec du tirage, réessayez.', de: 'Ziehung fehlgeschlagen, erneut versuchen.', ru: 'Не удалось выбрать, попробуйте ещё раз.', es: 'Fallo al sortear, inténtalo de nuevo.', ko: '뽑기에 실패했습니다. 다시 시도하세요.' },
    farm_f_pp: { en: 'PP ({mods})', zh: 'PP（{mods}）', zhs: 'PP（{mods}）', ja: 'PP（{mods}）', fr: 'PP ({mods})', de: 'PP ({mods})', ru: 'PP ({mods})', es: 'PP ({mods})', ko: 'PP ({mods})' },
    f_stars: { en: 'Stars', zh: '星數', zhs: '星数', ja: '星', fr: 'Étoiles', de: 'Sterne', ru: 'Звёзды', es: 'Estrellas', ko: '난이도(★)' },
    f_position: { en: 'Position', zh: '排名', zhs: '排名', ja: '順位', fr: 'Position', de: 'Position', ru: 'Позиция', es: 'Posición', ko: '순위' },
    farm_footer: { en: 'Farm Maps · {band}', zh: 'Farm Maps · {band}', zhs: 'Farm Maps · {band}', ja: 'Farm Maps · {band}', fr: 'Farm Maps · {band}', de: 'Farm Maps · {band}', ru: 'Farm Maps · {band}', es: 'Farm Maps · {band}', ko: 'Farm Maps · {band}' },
    farm_btn_prev: { en: '◀ Prev', zh: '◀ 上一張', zhs: '◀ 上一张', ja: '◀ 前へ', fr: '◀ Préc.', de: '◀ Zurück', ru: '◀ Назад', es: '◀ Ant.', ko: '◀ 이전' },
    farm_btn_random: { en: '🎲 Random', zh: '🎲 隨機', zhs: '🎲 随机', ja: '🎲 ランダム', fr: '🎲 Aléatoire', de: '🎲 Zufall', ru: '🎲 Случайно', es: '🎲 Azar', ko: '🎲 랜덤' },
    farm_btn_next: { en: 'Next ▶', zh: '下一張 ▶', zhs: '下一张 ▶', ja: '次へ ▶', fr: 'Suiv. ▶', de: 'Weiter ▶', ru: 'Вперёд ▶', es: 'Sig. ▶', ko: '다음 ▶' },
    farm_unlimited: { en: 'any', zh: '不限', zhs: '不限', ja: '制限なし', fr: 'illimité', de: 'beliebig', ru: 'любой', es: 'sin límite', ko: '제한 없음' },
    pp_band: { en: '{lo}–{hi} pp', zh: '{lo}–{hi} PP', zhs: '{lo}–{hi} PP', ja: '{lo}–{hi} pp', fr: '{lo}–{hi} pp', de: '{lo}–{hi} pp', ru: '{lo}–{hi} pp', es: '{lo}–{hi} pp', ko: '{lo}–{hi} pp' },

    // --- /practice ---
    practice_thin: { en: "Not enough maps in your range to build a pool — the farm database is still filling in that band. Try again later.", zh: '你這個範圍的圖不夠組一份圖池 —— 農分資料庫還在補這一段，晚點再試。', zhs: '你这个范围的图不够组一份图池 —— 农分数据库还在补这一段，晚点再试。', ja: 'この範囲の譜面が足りずプールを作れません。データベースが充実するのを待って再試行してください。', fr: "Pas assez de maps dans ta plage pour un pool — la base se remplit encore. Réessaie plus tard.", de: 'Zu wenige Maps in deinem Bereich für einen Pool — die Datenbank füllt sich noch. Später erneut versuchen.', ru: 'В вашем диапазоне мало карт для пула — база ещё заполняется. Попробуйте позже.', es: 'No hay suficientes mapas en tu rango para un pool — la base aún se está llenando. Inténtalo más tarde.', ko: '해당 범위에 맵이 부족해 풀을 만들 수 없습니다. 데이터베이스가 채워지는 중이니 나중에 다시 시도하세요.' },
    practice_goal_reached: { en: "You're already at that total PP 🎉", zh: '你的總 PP 已經到那個目標了 🎉', zhs: '你的总 PP 已经到那个目标了 🎉', ja: '既にその合計 PP に到達しています 🎉', fr: 'Tu as déjà atteint ce total de PP 🎉', de: 'Du hast diese Gesamt-PP schon erreicht 🎉', ru: 'Вы уже достигли этого суммарного PP 🎉', es: 'Ya has alcanzado ese PP total 🎉', ko: '이미 그 총 PP에 도달했습니다 🎉' },
    practice_need_plays: { en: 'Need at least ~10 top plays to build a pool.', zh: '至少要有 ~10 個 top play 才能組圖池。', zhs: '至少要有 ~10 个 top play 才能组图池。', ja: 'プールを作るには上位プレイが 10 件ほど必要です。', fr: "Il faut au moins ~10 meilleurs scores pour créer un pool.", de: 'Für einen Pool braucht es mindestens ~10 Top-Plays.', ru: 'Для пула нужно хотя бы ~10 лучших результатов.', es: 'Se necesitan al menos ~10 mejores puntuaciones para crear un pool.', ko: '풀을 만들려면 상위 기록이 최소 ~10개 필요합니다.' },
    practice_title: { en: '🎯 Practice pool — {name}', zh: '🎯 練習圖池 — {name}', zhs: '🎯 练习图池 — {name}', ja: '🎯 練習プール — {name}', fr: '🎯 Pool d\'entraînement — {name}', de: '🎯 Übungspool — {name}', ru: '🎯 Тренировочный пул — {name}', es: '🎯 Pool de práctica — {name}', ko: '🎯 연습 풀 — {name}' },
    practice_summary: { en: '{count} maps · {note}', zh: '{count} 張 · {note}', zhs: '{count} 张 · {note}', ja: '{count} 譜面 · {note}', fr: '{count} maps · {note}', de: '{count} Maps · {note}', ru: '{count} карт · {note}', es: '{count} mapas · {note}', ko: '{count} 맵 · {note}' },
    practice_more: { en: '…and {n} more', zh: '…還有 {n} 張', zhs: '…还有 {n} 张', ja: '…他 {n} 譜面', fr: '…et {n} de plus', de: '…und {n} weitere', ru: '…и ещё {n}', es: '…y {n} más', ko: '…외 {n} 개' },

    // --- /collect-channel ---
    collect_need_perm: { en: 'I need the **Read Message History** permission in this channel.', zh: '我需要這個頻道的 **讀取訊息紀錄** 權限。', zhs: '我需要这个频道的 **读取消息历史** 权限。', ja: 'このチャンネルの **メッセージ履歴を読む** 権限が必要です。', fr: "J'ai besoin de la permission **Voir les anciens messages** dans ce salon.", de: 'Ich brauche die Berechtigung **Nachrichtenverlauf anzeigen** in diesem Kanal.', ru: 'Мне нужно право **Просмотр истории сообщений** в этом канале.', es: 'Necesito el permiso **Leer el historial de mensajes** en este canal.', ko: '이 채널의 **메시지 기록 보기** 권한이 필요합니다.' },
    collect_no_links: { en: 'No osu! beatmap links in the last {n} messages.', zh: '最近 {n} 則訊息裡沒有 osu! 圖譜連結。', zhs: '最近 {n} 条消息里没有 osu! 谱面链接。', ja: '直近 {n} 件のメッセージに osu! 譜面リンクがありません。', fr: 'Aucun lien de beatmap osu! dans les {n} derniers messages.', de: 'Keine osu!-Beatmap-Links in den letzten {n} Nachrichten.', ru: 'Нет ссылок на карты osu! в последних {n} сообщениях.', es: 'No hay enlaces de beatmap de osu! en los últimos {n} mensajes.', ko: '최근 {n}개 메시지에 osu! 비트맵 링크가 없습니다.' },

    // --- /follow /unfollow /following ---
    follow_done: { en: "Now following **{name}**. You'll get a DM when they update their gallery collection.", zh: '已追蹤 **{name}**。他更新廣場收藏時你會收到私訊。', zhs: '已关注 **{name}**。他更新广场收藏时你会收到私信。', ja: '**{name}** をフォローしました。ギャラリーのコレクション更新時に DM が届きます。', fr: 'Tu suis maintenant **{name}**. Tu recevras un MP quand il met à jour sa collection.', de: 'Du folgst jetzt **{name}**. Du bekommst eine DM bei Aktualisierungen.', ru: 'Вы подписались на **{name}**. Придёт ЛС при обновлении коллекции.', es: 'Ahora sigues a **{name}**. Recibirás un MD cuando actualice su colección.', ko: '**{name}** 님을 팔로우했습니다. 갤러리 컬렉션 업데이트 시 DM을 받습니다.' },
    follow_already: { en: "You're already following **{name}**.", zh: '你已經在追蹤 **{name}** 了。', zhs: '你已经在关注 **{name}** 了。', ja: '既に **{name}** をフォローしています。', fr: 'Tu suis déjà **{name}**.', de: 'Du folgst **{name}** bereits.', ru: 'Вы уже подписаны на **{name}**.', es: 'Ya sigues a **{name}**.', ko: '이미 **{name}** 님을 팔로우 중입니다.' },
    unfollow_done: { en: 'Stopped following **{name}**.', zh: '已取消追蹤 **{name}**。', zhs: '已取消关注 **{name}**。', ja: '**{name}** のフォローを解除しました。', fr: 'Tu ne suis plus **{name}**.', de: 'Du folgst **{name}** nicht mehr.', ru: 'Вы отписались от **{name}**.', es: 'Has dejado de seguir a **{name}**.', ko: '**{name}** 님 팔로우를 해제했습니다.' },
    unfollow_not: { en: "You weren't following **{name}**.", zh: '你沒有在追蹤 **{name}**。', zhs: '你没有在关注 **{name}**。', ja: '**{name}** はフォローしていません。', fr: 'Tu ne suivais pas **{name}**.', de: 'Du bist **{name}** nicht gefolgt.', ru: 'Вы не были подписаны на **{name}**.', es: 'No seguías a **{name}**.', ko: '**{name}** 님을 팔로우하고 있지 않았습니다.' },
    following_empty: { en: "You're not following anyone. Use `/follow`.", zh: '你沒有追蹤任何人。用 `/follow`。', zhs: '你没有关注任何人。用 `/follow`。', ja: '誰もフォローしていません。`/follow` を使ってください。', fr: 'Tu ne suis personne. Utilise `/follow`.', de: 'Du folgst niemandem. Nutze `/follow`.', ru: 'Вы ни на кого не подписаны. Используйте `/follow`.', es: 'No sigues a nadie. Usa `/follow`.', ko: '아무도 팔로우하고 있지 않습니다. `/follow` 를 사용하세요.' },
    following_list: { en: 'You follow: {names}', zh: '你追蹤中：{names}', zhs: '你关注中：{names}', ja: 'フォロー中：{names}', fr: 'Tu suis : {names}', de: 'Du folgst: {names}', ru: 'Вы подписаны на: {names}', es: 'Sigues a: {names}', ko: '팔로우 중: {names}' },
    follow_dm: { en: '📢 **{name}** updated their gallery collection — now {sets} sets. {url}', zh: '📢 **{name}** 更新了廣場收藏 —— 目前 {sets} 圖組。{url}', zhs: '📢 **{name}** 更新了广场收藏 —— 目前 {sets} 图组。{url}', ja: '📢 **{name}** がギャラリーのコレクションを更新しました（現在 {sets} セット）。{url}', fr: '📢 **{name}** a mis à jour sa collection — {sets} sets maintenant. {url}', de: '📢 **{name}** hat die Sammlung aktualisiert — jetzt {sets} Sets. {url}', ru: '📢 **{name}** обновил(а) коллекцию — теперь {sets} наборов. {url}', es: '📢 **{name}** actualizó su colección — ahora {sets} sets. {url}', ko: '📢 **{name}** 님이 갤러리 컬렉션을 업데이트했습니다 — 현재 {sets} 셋. {url}' },

    // --- .osdb export (shared) ---
    btn_export_osdb: { en: '📥 Export .osdb', zh: '📥 匯出 .osdb', zhs: '📥 导出 .osdb', ja: '📥 .osdb を書き出し', fr: '📥 Exporter en .osdb', de: '📥 .osdb exportieren', ru: '📥 Экспорт .osdb', es: '📥 Exportar .osdb', ko: '📥 .osdb 내보내기' },
    btn_export_round: { en: '📥 Export this round', zh: '📥 匯出這輪', zhs: '📥 导出这轮', ja: '📥 このラウンドを書き出し', fr: '📥 Exporter ce round', de: '📥 Diese Runde exportieren', ru: '📥 Экспорт этого раунда', es: '📥 Exportar esta ronda', ko: '📥 이 라운드 내보내기' },
    export_done: { en: 'Generated **{name}** — drop it in your osu! Songs folder or open it with Collection Manager.', zh: '已產生 **{name}** —— 用 Collection Manager 開啟，或放進 osu! 資料夾即可匯入。', zhs: '已生成 **{name}** —— 用 Collection Manager 打开，或放进 osu! 文件夹即可导入。', ja: '**{name}** を生成しました。Collection Manager で開くか osu! フォルダに入れてください。', fr: '**{name}** généré — ouvrez-le avec Collection Manager ou placez-le dans votre dossier osu!.', de: '**{name}** erstellt — mit Collection Manager öffnen oder in den osu!-Ordner legen.', ru: 'Создан **{name}** — откройте в Collection Manager или положите в папку osu!.', es: '**{name}** generado — ábrelo con Collection Manager o ponlo en tu carpeta de osu!.', ko: '**{name}** 생성됨 — Collection Manager 로 열거나 osu! 폴더에 넣으세요.' },
    export_empty: { en: 'Nothing to export.', zh: '沒有可匯出的圖。', zhs: '没有可导出的图。', ja: '書き出せる譜面がありません。', fr: 'Rien à exporter.', de: 'Nichts zu exportieren.', ru: 'Нечего экспортировать.', es: 'Nada que exportar.', ko: '내보낼 항목이 없습니다.' },
    export_fail: { en: 'Export failed, try again.', zh: '匯出失敗，再試一次。', zhs: '导出失败，再试一次。', ja: '書き出しに失敗しました。もう一度お試しください。', fr: 'Échec de l\'export, réessayez.', de: 'Export fehlgeschlagen, erneut versuchen.', ru: 'Экспорт не удался, попробуйте ещё раз.', es: 'Fallo al exportar, inténtalo de nuevo.', ko: '내보내기에 실패했습니다. 다시 시도하세요.' },

    // --- /language ---
    lang_set: { en: 'Language set to **{lang}**. This is remembered for you.', zh: '語言已設為 **{lang}**，會記住你的選擇。', zhs: '语言已设为 **{lang}**，会记住你的选择。', ja: '言語を **{lang}** に設定しました。この設定は保存されます。', fr: 'Langue réglée sur **{lang}**. Ce choix est mémorisé.', de: 'Sprache auf **{lang}** gesetzt. Wird für dich gemerkt.', ru: 'Язык изменён на **{lang}**. Выбор сохранён.', es: 'Idioma establecido en **{lang}**. Se recordará.', ko: '언어가 **{lang}** (으)로 설정되었습니다. 저장됩니다.' },
    lang_auto: { en: 'Language will follow your Discord client.', zh: '語言將跟隨你的 Discord 介面語言。', zhs: '语言将跟随你的 Discord 界面语言。', ja: '言語は Discord クライアントの設定に従います。', fr: 'La langue suivra celle de votre client Discord.', de: 'Die Sprache richtet sich nach deinem Discord-Client.', ru: 'Язык будет следовать за клиентом Discord.', es: 'El idioma seguirá al de tu cliente de Discord.', ko: '언어는 Discord 클라이언트 설정을 따릅니다.' },

    // --- publish announcement (collections-publish.js) ---
    announce_title: { en: '🎉 New collection published: {name}', zh: '🎉 新收藏發佈：{name}', zhs: '🎉 新收藏发布：{name}', ja: '🎉 新しいコレクションが公開されました：{name}', fr: '🎉 Nouvelle collection publiée : {name}', de: '🎉 Neue Sammlung veröffentlicht: {name}', ru: '🎉 Опубликована новая коллекция: {name}', es: '🎉 Nueva colección publicada: {name}', ko: '🎉 새 컬렉션이 공개되었습니다: {name}' },
};

function t(key, params) {
    const row = S[key];
    let str = row ? (row[current] || row.en) : key;
    if (params) {
        for (const k of Object.keys(params)) {
            str = str.split('{' + k + '}').join(String(params[k]));
        }
    }
    return str;
}

module.exports = { setLocale, getLocale, t, LOCALE_MAP, LANG_NAMES, KNOWN_KEYS };
