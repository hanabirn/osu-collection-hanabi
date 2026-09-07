/* One-shot: (re)register the bot's global slash commands with Discord.
   Run after deploying discord-interactions.js and setting the app's
   Interactions Endpoint URL:

     DISCORD_APP_ID=... DISCORD_BOT_TOKEN=... node scripts/register-discord-commands.mjs

   Both values also read from a local .env (gitignored) if present. A global
   PUT replaces the whole command set and can take up to ~1 h to propagate
   to every client (usually much faster). Pass a guild id as the first arg
   to register to just that server instead (instant, handy for testing):

     node scripts/register-discord-commands.mjs 123456789012345678

   Command *names* stay English (users type them, and localized names have
   strict charset rules); descriptions and option descriptions are localized
   via description_localizations. Response text is localized separately at
   runtime — see netlify/functions/_discord-i18n.js. Choice names (mode /
   mods) are language-neutral acronyms so they need no localization. */
import { readFile } from 'node:fs/promises';

async function loadDotEnv() {
    try {
        const txt = await readFile(new URL('../.env', import.meta.url), 'utf8');
        for (const line of txt.split('\n')) {
            const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/i);
            if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
        }
    } catch { /* no .env, fine */ }
}

// id -> { en (base), 'zh-TW', 'zh-CN', ja, fr, de, ru, 'es-ES', ko }
const LOC = {
    cmd_collection: { en: 'Search and show a published osu! collection', 'zh-TW': '搜尋並顯示一份已發佈的 osu! 收藏', 'zh-CN': '搜索并显示一份已发布的 osu! 收藏', ja: '公開された osu! コレクションを検索して表示', fr: 'Rechercher et afficher une collection osu! publiée', de: 'Eine veröffentlichte osu!-Sammlung suchen und anzeigen', ru: 'Найти и показать опубликованную коллекцию osu!', 'es-ES': 'Buscar y mostrar una colección de osu! publicada', ko: '공개된 osu! 컬렉션을 검색하여 표시' },
    cmd_gallery: { en: 'Browse the latest collections in the gallery', 'zh-TW': '瀏覽收藏廣場最新發佈的收藏', 'zh-CN': '浏览收藏广场最新发布的收藏', ja: 'ギャラリーの最新コレクションを閲覧', fr: 'Parcourir les dernières collections de la galerie', de: 'Die neuesten Sammlungen in der Galerie durchsuchen', ru: 'Просмотр последних коллекций в галерее', 'es-ES': 'Explorar las colecciones más recientes de la galería', ko: '갤러리의 최신 컬렉션 둘러보기' },
    cmd_pp: { en: "Look up an osu! player's PP and rank", 'zh-TW': '查詢 osu! 玩家的 PP 與排名', 'zh-CN': '查询 osu! 玩家的 PP 与排名', ja: 'osu! プレイヤーの PP とランクを検索', fr: "Consulter le PP et le rang d'un joueur osu!", de: 'PP und Rang eines osu!-Spielers nachschlagen', ru: 'Узнать PP и ранг игрока osu!', 'es-ES': 'Consultar el PP y el ranking de un jugador de osu!', ko: 'osu! 플레이어의 PP와 순위 조회' },
    cmd_recent: { en: "Show a player's most recent score", 'zh-TW': '查看某位玩家最近的一筆成績', 'zh-CN': '查看某位玩家最近的一笔成绩', ja: 'プレイヤーの直近のスコアを表示', fr: "Afficher le dernier score d'un joueur", de: 'Den letzten Score eines Spielers anzeigen', ru: 'Показать последний результат игрока', 'es-ES': 'Mostrar la puntuación más reciente de un jugador', ko: '플레이어의 가장 최근 기록 표시' },
    cmd_top: { en: "Show a player's best scores", 'zh-TW': '查看某位玩家的最佳成績', 'zh-CN': '查看某位玩家的最佳成绩', ja: 'プレイヤーのベストスコアを表示', fr: "Afficher les meilleurs scores d'un joueur", de: 'Die Bestscores eines Spielers anzeigen', ru: 'Показать лучшие результаты игрока', 'es-ES': 'Mostrar las mejores puntuaciones de un jugador', ko: '플레이어의 최고 기록 표시' },
    cmd_map: { en: "Show a beatmap's info and PP values", 'zh-TW': '顯示一張圖譜的資訊與 PP 值', 'zh-CN': '显示一张谱面的信息与 PP 值', ja: '譜面の情報と PP 値を表示', fr: "Afficher les infos et les valeurs de PP d'une beatmap", de: 'Infos und PP-Werte einer Beatmap anzeigen', ru: 'Показать сведения о карте и значения PP', 'es-ES': 'Mostrar la info y los valores de PP de un beatmap', ko: '비트맵 정보와 PP 값 표시' },
    cmd_practice: { en: 'Turn your top plays into a practice pool (.osdb, std only)', 'zh-TW': '把你的 top play 變成一份練習圖池（.osdb，僅 std）', 'zh-CN': '把你的 top play 变成一份练习图池（.osdb，仅 std）', ja: '上位プレイから練習プールを作成（.osdb、std のみ）', fr: 'Transformer tes meilleurs scores en pool d\'entraînement (.osdb, std)', de: 'Aus deinen Top-Plays einen Übungspool machen (.osdb, nur std)', ru: 'Собрать тренировочный пул из лучших результатов (.osdb, только std)', 'es-ES': 'Convierte tus mejores scores en un pool de práctica (.osdb, solo std)', ko: '상위 기록으로 연습 풀 만들기 (.osdb, std 전용)' },
    opt_practice_target: { en: 'Target total PP (given = goal pool; omitted = break into your top 100)', 'zh-TW': '目標總 PP（有填 = 目標圖池；不填 = 突破你的 top 100）', 'zh-CN': '目标总 PP（有填 = 目标图池；不填 = 突破你的 top 100）', ja: '目標合計 PP（指定 = 目標プール、省略 = トップ100 突破）', fr: 'PP total visé (rempli = pool objectif ; vide = entrer dans ton top 100)', de: 'Ziel-Gesamt-PP (angegeben = Ziel-Pool; leer = in deine Top 100)', ru: 'Целевой суммарный PP (задан = пул под цель; пусто = попасть в топ-100)', 'es-ES': 'PP total objetivo (con valor = pool objetivo; vacío = entrar en tu top 100)', ko: '목표 총 PP (입력 시 목표 풀; 생략 시 상위 100 진입)' },
    cmd_mappool: { en: 'Browse official World Cup mappools', 'zh-TW': '瀏覽官方世界盃圖池', 'zh-CN': '浏览官方世界杯图池', ja: '公式ワールドカップのマッププールを閲覧', fr: 'Parcourir les mappools officiels des World Cup', de: 'Offizielle World-Cup-Mappools durchsuchen', ru: 'Просмотр официальных маппулов World Cup', 'es-ES': 'Explorar los mappools oficiales de la World Cup', ko: '공식 월드컵 맵풀 둘러보기' },
    cmd_tourneypool: { en: 'Browse community-shared tournament mappools', 'zh-TW': '瀏覽社群共享的賽事圖池', 'zh-CN': '浏览社群共享的赛事图池', ja: 'コミュニティ共有の大会マッププールを閲覧', fr: 'Parcourir les mappools de tournoi partagés par la communauté', de: 'Von der Community geteilte Turnier-Mappools durchsuchen', ru: 'Просмотр турнирных маппулов от сообщества', 'es-ES': 'Explorar los mappools de torneo compartidos por la comunidad', ko: '커뮤니티가 공유한 토너먼트 맵풀 둘러보기' },
    opt_tourneypool_name: { en: 'Tournament (start typing to search)', 'zh-TW': '賽事（開始輸入以搜尋）', 'zh-CN': '赛事（开始输入以搜索）', ja: '大会（入力して検索）', fr: 'Tournoi (commencez à taper pour rechercher)', de: 'Turnier (zum Suchen tippen)', ru: 'Турнир (начните вводить для поиска)', 'es-ES': 'Torneo (empieza a escribir para buscar)', ko: '토너먼트 (입력하여 검색)' },
    opt_tourneypool_round: { en: 'Round name (omit to list all rounds)', 'zh-TW': '輪次名稱（省略則列出所有輪次）', 'zh-CN': '轮次名称（省略则列出所有轮次）', ja: 'ラウンド名（省略で全ラウンド一覧）', fr: 'Nom du round (vide = tous les rounds)', de: 'Rundenname (leer = alle Runden)', ru: 'Название раунда (пусто = все раунды)', 'es-ES': 'Nombre de la ronda (vacío = todas)', ko: '라운드 이름 (생략 시 전체 목록)' },
    cmd_skin: { en: "Search the site's skin library", 'zh-TW': '搜尋站內皮膚庫', 'zh-CN': '搜索站内皮肤库', ja: 'サイトのスキンライブラリを検索', fr: 'Rechercher dans la bibliothèque de skins du site', de: 'Die Skin-Bibliothek der Seite durchsuchen', ru: 'Поиск в библиотеке скинов сайта', 'es-ES': 'Buscar en la biblioteca de skins del sitio', ko: '사이트의 스킨 라이브러리 검색' },
    cmd_farm: { en: 'Draw a map from the farm-maps database', 'zh-TW': '從農分圖資料庫抽一張圖', 'zh-CN': '从农分图数据库抽一张图', ja: '効率譜面データベースから1譜面を抽選', fr: 'Tirer une map dans la base de farm maps', de: 'Eine Map aus der Farm-Maps-Datenbank ziehen', ru: 'Выбрать карту из базы фарм-карт', 'es-ES': 'Sacar un mapa de la base de farm maps', ko: '파밍 맵 데이터베이스에서 맵 뽑기' },
    cmd_link: { en: 'Link your Discord account to an osu! account', 'zh-TW': '把你的 Discord 帳號綁定一個 osu! 帳號', 'zh-CN': '把你的 Discord 账号绑定一个 osu! 账号', ja: 'Discord アカウントと osu! アカウントを連携', fr: 'Lier votre compte Discord à un compte osu!', de: 'Dein Discord-Konto mit einem osu!-Konto verknüpfen', ru: 'Привязать аккаунт Discord к аккаунту osu!', 'es-ES': 'Vincular tu cuenta de Discord a una cuenta de osu!', ko: 'Discord 계정을 osu! 계정과 연동' },
    cmd_unlink: { en: 'Unlink your osu! account', 'zh-TW': '解除 osu! 帳號綁定', 'zh-CN': '解除 osu! 账号绑定', ja: 'osu! アカウントの連携を解除', fr: 'Dissocier votre compte osu!', de: 'Verknüpfung deines osu!-Kontos aufheben', ru: 'Отвязать аккаунт osu!', 'es-ES': 'Desvincular tu cuenta de osu!', ko: 'osu! 계정 연동 해제' },
    cmd_language: { en: 'Choose the language the bot replies to you in', 'zh-TW': '選擇 bot 回覆你時使用的語言', 'zh-CN': '选择 bot 回复你时使用的语言', ja: 'ボットの返信言語を選ぶ', fr: 'Choisir la langue des réponses du bot', de: 'Sprache wählen, in der der Bot dir antwortet', ru: 'Выбрать язык ответов бота', 'es-ES': 'Elegir el idioma de las respuestas del bot', ko: '봇이 답할 언어 선택' },
    opt_language_lang: { en: 'Language ("Auto" = follow your Discord client)', 'zh-TW': '語言（「Auto」= 跟隨你的 Discord 介面）', 'zh-CN': '语言（「Auto」= 跟随你的 Discord 界面）', ja: '言語（「Auto」= Discord の設定に従う）', fr: 'Langue (« Auto » = suit votre client Discord)', de: 'Sprache („Auto" = folgt deinem Discord-Client)', ru: 'Язык («Auto» = как в клиенте Discord)', 'es-ES': 'Idioma ("Auto" = sigue tu cliente de Discord)', ko: '언어 ("Auto" = Discord 클라이언트 설정)' },

    opt_username: { en: 'osu! name or ID (omit to use your linked account)', 'zh-TW': 'osu! 名稱或 ID（省略則用 /link 綁定的帳號）', 'zh-CN': 'osu! 名称或 ID（省略则用 /link 绑定的账号）', ja: 'osu! 名または ID（省略で /link 連携済みアカウント）', fr: 'Nom ou ID osu! (vide = compte lié)', de: 'osu!-Name oder ID (leer = verknüpftes Konto)', ru: 'Имя или ID osu! (пусто — привязанный аккаунт)', 'es-ES': 'Nombre o ID de osu! (vacío = cuenta vinculada)', ko: 'osu! 이름 또는 ID (생략 시 연동된 계정)' },
    opt_mode: { en: 'Game mode (default osu!)', 'zh-TW': '遊戲模式（預設 osu!）', 'zh-CN': '游戏模式（默认 osu!）', ja: 'ゲームモード（既定 osu!）', fr: 'Mode de jeu (défaut osu!)', de: 'Spielmodus (Standard osu!)', ru: 'Режим игры (по умолчанию osu!)', 'es-ES': 'Modo de juego (por defecto osu!)', ko: '게임 모드 (기본 osu!)' },
    opt_collection_query: { en: 'Publisher name, collection ID or category keyword', 'zh-TW': '發佈者名稱、收藏 ID 或分類關鍵字', 'zh-CN': '发布者名称、收藏 ID 或分类关键字', ja: '公開者名・コレクション ID・カテゴリのキーワード', fr: "Nom d'auteur, ID de collection ou mot-clé", de: 'Name, Sammlungs-ID oder Kategorie-Stichwort', ru: 'Имя автора, ID коллекции или ключевое слово', 'es-ES': 'Nombre, ID de colección o palabra clave', ko: '게시자 이름, 컬렉션 ID 또는 카테고리 키워드' },
    opt_page: { en: 'Page number (from 1)', 'zh-TW': '頁碼（從 1 開始）', 'zh-CN': '页码（从 1 开始）', ja: 'ページ番号（1 から）', fr: 'Numéro de page (à partir de 1)', de: 'Seitenzahl (ab 1)', ru: 'Номер страницы (с 1)', 'es-ES': 'Número de página (desde 1)', ko: '페이지 번호 (1부터)' },
    opt_recent_index: { en: 'Which score (1 = newest, up to 50)', 'zh-TW': '第幾筆（1 = 最新，最多 50）', 'zh-CN': '第几笔（1 = 最新，最多 50）', ja: '何番目か（1 = 最新、最大 50）', fr: 'Quel score (1 = plus récent, jusqu à 50)', de: 'Welcher Score (1 = neuester, bis 50)', ru: 'Какой результат (1 = последний, до 50)', 'es-ES': 'Qué puntuación (1 = más reciente, hasta 50)', ko: '몇 번째 (1 = 최신, 최대 50)' },
    opt_top_index: { en: 'Show one entry in detail (1-100; omit for top 5)', 'zh-TW': '看第幾名的單筆詳情（1–100；省略則列前 5）', 'zh-CN': '看第几名的单笔详情（1–100；省略则列前 5）', ja: '指定順位の詳細（1–100、省略で上位 5）', fr: 'Un score en détail (1-100 ; vide = top 5)', de: 'Ein Eintrag im Detail (1-100; leer = Top 5)', ru: 'Одна запись подробно (1-100; пусто = топ-5)', 'es-ES': 'Un resultado en detalle (1-100; vacío = top 5)', ko: '특정 순위 상세 (1-100; 생략 시 상위 5)' },
    opt_map_query: { en: 'osu! beatmap link or ID', 'zh-TW': 'osu! 圖譜連結或 ID', 'zh-CN': 'osu! 谱面链接或 ID', ja: 'osu! 譜面リンクまたは ID', fr: 'Lien ou ID de beatmap osu!', de: 'osu!-Beatmap-Link oder ID', ru: 'Ссылка на карту osu! или ID', 'es-ES': 'Enlace o ID de beatmap de osu!', ko: 'osu! 비트맵 링크 또는 ID' },
    opt_mappool_edition: { en: 'Edition (e.g. OWC/2024)', 'zh-TW': '賽事版本（例如 OWC/2024）', 'zh-CN': '赛事版本（例如 OWC/2024）', ja: '大会（例：OWC/2024）', fr: 'Édition (ex. OWC/2024)', de: 'Ausgabe (z. B. OWC/2024)', ru: 'Турнир (напр. OWC/2024)', 'es-ES': 'Edición (p. ej. OWC/2024)', ko: '대회 (예: OWC/2024)' },
    opt_mappool_round: { en: 'Round name (omit to list all rounds)', 'zh-TW': '輪次名稱（省略則列出所有輪次）', 'zh-CN': '轮次名称（省略则列出所有轮次）', ja: 'ラウンド名（省略で全ラウンド一覧）', fr: 'Nom du round (vide = tous les rounds)', de: 'Rundenname (leer = alle Runden)', ru: 'Название раунда (пусто = все раунды)', 'es-ES': 'Nombre de la ronda (vacío = todas)', ko: '라운드 이름 (생략 시 전체 목록)' },
    opt_skin_query: { en: 'Skin name or author', 'zh-TW': '皮膚名稱或作者', 'zh-CN': '皮肤名称或作者', ja: 'スキン名または作者', fr: 'Nom du skin ou auteur', de: 'Skin-Name oder Autor', ru: 'Название скина или автор', 'es-ES': 'Nombre del skin o autor', ko: '스킨 이름 또는 제작자' },
    opt_farm_mods: { en: 'Mod combo (default NM; ignored for mania)', 'zh-TW': 'mod 組合（預設 NM；mania 無 mod 加成，此選項會被忽略）', 'zh-CN': 'mod 组合（默认 NM；mania 无 mod 加成，此选项会被忽略）', ja: 'mod 構成（既定 NM、mania は無視）', fr: 'Combo de mods (défaut NM ; ignoré en mania)', de: 'Mod-Kombi (Standard NM; für mania ignoriert)', ru: 'Комбо модов (по умолч. NM; для mania игнор.)', 'es-ES': 'Combo de mods (por defecto NM; ignorado en mania)', ko: 'mod 조합 (기본 NM; mania 는 무시)' },
    opt_pp_min: { en: 'Minimum PP (for the chosen mods)', 'zh-TW': '最低 PP（依所選 mod 計算）', 'zh-CN': '最低 PP（按所选 mod 计算）', ja: '最低 PP（選択した mod 基準）', fr: 'PP minimum (pour les mods choisis)', de: 'Minimum-PP (für die gewählten Mods)', ru: 'Минимальный PP (для выбранных модов)', 'es-ES': 'PP mínimo (para los mods elegidos)', ko: '최소 PP (선택한 mod 기준)' },
    opt_pp_max: { en: 'Maximum PP (with only min given, auto = min-min×1.4)', 'zh-TW': '最高 PP（只給 min 時自動抓 min ~ min×1.4）', 'zh-CN': '最高 PP（只给 min 时自动取 min ~ min×1.4）', ja: '最高 PP（min のみ指定で自動 min ~ min×1.4）', fr: 'PP maximum (avec seul min : auto min-min×1.4)', de: 'Maximum-PP (nur min: auto min-min×1.4)', ru: 'Максимальный PP (только min: авто min-min×1.4)', 'es-ES': 'PP máximo (solo con min: auto min-min×1.4)', ko: '최대 PP (min 만 입력 시 자동 min ~ min×1.4)' },
    opt_link_username: { en: 'osu! name or ID', 'zh-TW': 'osu! 名稱或 ID', 'zh-CN': 'osu! 名称或 ID', ja: 'osu! 名または ID', fr: 'Nom ou ID osu!', de: 'osu!-Name oder ID', ru: 'Имя или ID osu!', 'es-ES': 'Nombre o ID de osu!', ko: 'osu! 이름 또는 ID' },

    cmd_collect_channel: { en: 'Build a .osdb collection from osu! links posted in this channel', 'zh-TW': '從這個頻道貼過的 osu! 連結組成一份 .osdb 收藏', 'zh-CN': '从这个频道贴过的 osu! 链接组成一份 .osdb 收藏', ja: 'このチャンネルの osu! リンクから .osdb コレクションを作成', fr: 'Créer une collection .osdb à partir des liens osu! de ce salon', de: 'Aus den osu!-Links in diesem Kanal eine .osdb-Sammlung bauen', ru: 'Собрать .osdb-коллекцию из ссылок osu! в этом канале', 'es-ES': 'Crear una colección .osdb con los enlaces de osu! de este canal', ko: '이 채널의 osu! 링크로 .osdb 컬렉션 만들기' },
    opt_collect_count: { en: 'How many recent messages to scan (default 100, max 300)', 'zh-TW': '掃描最近幾則訊息（預設 100，最多 300）', 'zh-CN': '扫描最近几条消息（默认 100，最多 300）', ja: 'スキャンする直近メッセージ数（既定 100、最大 300）', fr: 'Nombre de messages récents à scanner (défaut 100, max 300)', de: 'Wie viele letzte Nachrichten scannen (Standard 100, max 300)', ru: 'Сколько последних сообщений сканировать (по умолч. 100, макс 300)', 'es-ES': 'Cuántos mensajes recientes escanear (por defecto 100, máx 300)', ko: '스캔할 최근 메시지 수 (기본 100, 최대 300)' },
    cmd_follow: { en: 'Get a DM when someone updates their published collection', 'zh-TW': '有人更新已發佈的收藏時私訊通知你', 'zh-CN': '有人更新已发布的收藏时私信通知你', ja: '公開コレクションの更新時に DM で通知', fr: 'Recevoir un MP quand quelqu\'un met à jour sa collection', de: 'DM erhalten, wenn jemand seine Sammlung aktualisiert', ru: 'Получать ЛС при обновлении чужой опубликованной коллекции', 'es-ES': 'Recibir un MD cuando alguien actualice su colección publicada', ko: '누군가 공개 컬렉션을 업데이트하면 DM 받기' },
    cmd_unfollow: { en: 'Stop following a publisher', 'zh-TW': '取消追蹤某位發佈者', 'zh-CN': '取消关注某位发布者', ja: '発行者のフォローを解除', fr: 'Ne plus suivre un auteur', de: 'Einem Ersteller nicht mehr folgen', ru: 'Отписаться от автора', 'es-ES': 'Dejar de seguir a un autor', ko: '게시자 팔로우 해제' },
    cmd_following: { en: 'List the publishers you follow', 'zh-TW': '列出你追蹤中的發佈者', 'zh-CN': '列出你关注中的发布者', ja: 'フォロー中の発行者一覧', fr: 'Lister les auteurs que tu suis', de: 'Ersteller auflisten, denen du folgst', ru: 'Список авторов, на которых вы подписаны', 'es-ES': 'Listar los autores que sigues', ko: '팔로우 중인 게시자 목록' },
    opt_follow_query: { en: 'Publisher name or collection ID', 'zh-TW': '發佈者名稱或收藏 ID', 'zh-CN': '发布者名称或收藏 ID', ja: '発行者名またはコレクション ID', fr: "Nom d'auteur ou ID de collection", de: 'Name oder Sammlungs-ID des Erstellers', ru: 'Имя автора или ID коллекции', 'es-ES': 'Nombre del autor o ID de la colección', ko: '게시자 이름 또는 컬렉션 ID' },
};

// -> { description, description_localizations }
function d(id) {
    const row = LOC[id];
    const { en, ...rest } = row;
    return { description: en, description_localizations: rest };
}

const MODE_CHOICES = [
    { name: 'osu!', value: 'osu' },
    { name: 'osu!taiko', value: 'taiko' },
    { name: 'osu!catch', value: 'fruits' },
    { name: 'osu!mania', value: 'mania' },
];
const usernameOpt = { type: 3, name: 'username', required: false, ...d('opt_username') };
const modeOpt = { type: 3, name: 'mode', required: false, choices: MODE_CHOICES, ...d('opt_mode') };

// Option types: 3 = STRING, 4 = INTEGER, 5 = BOOLEAN.
const commands = [
    { name: 'collection', ...d('cmd_collection'), options: [{ type: 3, name: 'query', required: true, autocomplete: true, ...d('opt_collection_query') }] },
    { name: 'gallery', ...d('cmd_gallery'), options: [{ type: 4, name: 'page', required: false, ...d('opt_page') }] },
    { name: 'pp', ...d('cmd_pp'), options: [usernameOpt, modeOpt] },
    { name: 'recent', ...d('cmd_recent'), options: [usernameOpt, modeOpt, { type: 4, name: 'index', required: false, ...d('opt_recent_index') }] },
    { name: 'top', ...d('cmd_top'), options: [usernameOpt, modeOpt, { type: 4, name: 'index', required: false, ...d('opt_top_index') }] },
    { name: 'map', ...d('cmd_map'), options: [{ type: 3, name: 'query', required: true, ...d('opt_map_query') }] },
    {
        name: 'practice', ...d('cmd_practice'),
        options: [usernameOpt, { type: 4, name: 'target_pp', required: false, ...d('opt_practice_target') }],
    },
    {
        name: 'mappool', ...d('cmd_mappool'),
        options: [
            { type: 3, name: 'edition', required: true, autocomplete: true, ...d('opt_mappool_edition') },
            { type: 3, name: 'round', required: false, ...d('opt_mappool_round') },
        ],
    },
    {
        name: 'tourneypool', ...d('cmd_tourneypool'),
        options: [
            { type: 3, name: 'tournament', required: true, autocomplete: true, ...d('opt_tourneypool_name') },
            { type: 3, name: 'round', required: false, ...d('opt_tourneypool_round') },
        ],
    },
    { name: 'skin', ...d('cmd_skin'), options: [{ type: 3, name: 'query', required: true, ...d('opt_skin_query') }] },
    {
        name: 'farm', ...d('cmd_farm'),
        options: [
            modeOpt,
            { type: 3, name: 'mods', required: false, choices: ['NM', 'HD', 'HR', 'DT', 'HDDT', 'HDHR'].map(m => ({ name: m, value: m })), ...d('opt_farm_mods') },
            { type: 4, name: 'pp_min', required: false, ...d('opt_pp_min') },
            { type: 4, name: 'pp_max', required: false, ...d('opt_pp_max') },
        ],
    },
    { name: 'collect-channel', ...d('cmd_collect_channel'), options: [{ type: 4, name: 'count', required: false, ...d('opt_collect_count') }] },
    { name: 'follow', ...d('cmd_follow'), options: [{ type: 3, name: 'query', required: true, autocomplete: true, ...d('opt_follow_query') }] },
    { name: 'unfollow', ...d('cmd_unfollow'), options: [{ type: 3, name: 'query', required: true, autocomplete: true, ...d('opt_follow_query') }] },
    { name: 'following', ...d('cmd_following') },
    { name: 'link', ...d('cmd_link'), options: [{ type: 3, name: 'username', required: true, ...d('opt_link_username') }] },
    { name: 'unlink', ...d('cmd_unlink') },
    {
        name: 'language', ...d('cmd_language'),
        options: [{
            type: 3, name: 'lang', required: true, ...d('opt_language_lang'),
            choices: [
                { name: 'Auto (Discord client)', value: 'auto' },
                { name: 'English', value: 'en' },
                { name: '繁體中文', value: 'zh' },
                { name: '简体中文', value: 'zhs' },
                { name: '日本語', value: 'ja' },
                { name: 'Français', value: 'fr' },
                { name: 'Deutsch', value: 'de' },
                { name: 'Русский', value: 'ru' },
                { name: 'Español', value: 'es' },
                { name: '한국어', value: 'ko' },
            ],
        }],
    },
];

async function main() {
    await loadDotEnv();
    const appId = process.env.DISCORD_APP_ID;
    const botToken = process.env.DISCORD_BOT_TOKEN;
    if (!appId || !botToken) {
        console.error('Missing DISCORD_APP_ID or DISCORD_BOT_TOKEN (env or .env).');
        process.exit(1);
    }

    const guildId = process.argv[2];
    const url = guildId
        ? `https://discord.com/api/v10/applications/${appId}/guilds/${guildId}/commands`
        : `https://discord.com/api/v10/applications/${appId}/commands`;

    const res = await fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bot ${botToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(commands),
    });

    const text = await res.text();
    if (!res.ok) {
        console.error(`Discord API ${res.status}:`, text);
        process.exit(1);
    }
    const registered = JSON.parse(text);
    console.log(`Registered ${registered.length} command(s) ${guildId ? `to guild ${guildId}` : 'globally'}:`);
    for (const c of registered) console.log(`  /${c.name} — ${c.description}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
