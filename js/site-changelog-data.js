/* Manually maintained release notes for the header's 更新內容 dropdown
   (see toggleChangelogMenu()/renderChangelogMenu() in js/main.js). Add one
   new entry here whenever a user-visible change ships — newest first, plain
   zh-Hant, no dev jargon or internal filenames. Skip internal-only work
   (refactors, crawler tuning, infra) that a visitor wouldn't notice. */
const SITE_CHANGELOG = [
    {
        date: '2026-09-25',
        items: [
            '網站搬新家了，網址改成 osu.hanabirn.xyz（舊網址會自動轉過來）',
            '如果你之前把網站加到主畫面，請移除舊的重新加一次，才能正常登入',
            '「Farm 圖」與「小遊戲」已下架',
            '「曲庫分類」開始收錄 loved 圖，不再只有 ranked',
            '調色盤選到很亮或很暗的顏色時，文字不會再看不見',
            '修正「更新內容」選單會被標題蓋住的問題',
            '修正今日推薦的音樂長條沒有貼齊底部、蓋到曲名的問題',
            '修正「曲庫分類」的播放按鈕沒有置中的問題',
        ],
    },
    {
        date: '2026-09-13',
        items: [
            '「收藏」卡片的語言標籤改放到右下角、難度色徽章旁邊',
            '預覽播放的音樂視覺化長條變多了，會更明顯跟著節奏跳動',
        ],
    },
];
