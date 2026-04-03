/* =========================================
   データ定義
   ========================================= */
import { state, defaultSymbolRules } from './progen-state.js';
// カテゴリ定義
const categories = {
    basic: { name: "基本的に表記変更されるもの", color: "#3498db" },
    recommended: { name: "表記が推奨されるもの", color: "#e67e22" },
    auxiliary: { name: "補助動詞は基本ひらきます", color: "#16a085" },
    difficult: { name: "難読文字は基本ひらきます", color: "#9b59b6" },
    number: { name: "数字", color: "#f39c12" },
    pronoun: { name: "人称", color: "#e74c3c" },
    character: { name: "人物名（ルビ用）", color: "#2c3e50" }
};

const numberSubRules = {
    personCount: {
        name: '人数',
        options: [
            'ひとり、ふたり、３人',
            'ひとり、ふたり、三人',
            '一人、二人、３人',
            '一人、二人、三人',
            '1人、2人、3人'
        ]
    },
    thingCount: {
        name: '戸数',
        options: [
            'ひとつ、ふたつ、３つ',
            'ひとつ、ふたつ、三つ',
            '1つ、2つ、3つ',
            '一つ、二つ、三つ'
        ]
    },
    month: {
        name: '月',
        options: [
            '1カ月、2カ月',
            '1か月、2か月',
            '1ヶ月、2ヶ月',
            '一か月、二か月',
            '一ヶ月、二ヶ月',
            '一カ月、二カ月'
        ]
    }
};

// マスタールールをGドライブの外部JSONから読み込む
async function loadMasterRule(labelValue) {
    if (!window.electronAPI || !window.electronAPI.isElectron) {
        console.warn('Electron環境外のため、マスタールールを読み込めません');
        state.currentProofRules = [];
        return;
    }
    try {
        const result = await window.electronAPI.readMasterRule(labelValue);
        if (result.success && result.data && result.data.proofRules) {
            state.currentProofRules = JSON.parse(JSON.stringify(result.data.proofRules.proof || []));
            if (result.data.proofRules.symbol && result.data.proofRules.symbol.length > 0) {
                state.symbolRules = JSON.parse(JSON.stringify(result.data.proofRules.symbol));
            }
            // マスターJSONからオプション設定（数字ルール等）を読み込み
            if (result.data.proofRules.options) {
                const opts = result.data.proofRules.options;
                if (opts.numberRuleBase !== undefined) state.numberRuleBase = opts.numberRuleBase;
                if (opts.numberRulePersonCount !== undefined) state.numberRulePersonCount = opts.numberRulePersonCount;
                if (opts.numberRuleThingCount !== undefined) state.numberRuleThingCount = opts.numberRuleThingCount;
                if (opts.numberRuleMonth !== undefined) state.numberRuleMonth = opts.numberRuleMonth;
                if (opts.numberSubRulesEnabled !== undefined) state.numberSubRulesEnabled = opts.numberSubRulesEnabled;
            }
        } else {
            console.warn('マスタールール読み込み失敗:', labelValue, result.error || '');
            state.currentProofRules = [];
        }
    } catch (e) {
        console.error('マスタールール読み込みエラー:', e);
        state.currentProofRules = [];
    }
}

// defaultSymbolRules は progen-state.js からインポート済み

// 現在の記号ルール（編集可能）
// [moved to state] symbolRules
// [moved to state] currentProofRules
// [moved to state] currentViewMode

// その他表記ルールの状態
// [moved to state] optionNgWordMasking
// [moved to state] optionPunctuationToSpace
// [moved to state] optionDifficultRuby
// [moved to state] optionTypoCheck
// [moved to state] optionMissingCharCheck
// [moved to state] optionNameRubyCheck
// [moved to state] optionNonJoyoCheck

// 数字ルール設定
// [moved to state] numberRuleBase
const numberBaseOptions = [
    'アラビア数字 / 動詞名詞は漢数字',
    'アラビア数字統一',
    '漢数字統一'
];
// [moved to state] numberRulePersonCount
// [moved to state] numberRuleThingCount
// [moved to state] numberRuleMonth
// [moved to state] numberSubRulesEnabled

// 出力形式設定
let outputFormatMode = 'comicpot'; // COMIC-POT形式固定
// state.outputFormatVolume, state.outputFormatStartPage, state.outputFormatSortMode は state に移動済み

// 常用漢字リスト（2136字）- JS側の前処理用、プロンプトには含めない
const JOYO_KANJI = '亜哀挨愛曖悪握圧扱宛嵐安案暗以衣位囲医依委威為畏胃尉異移萎偉椅彙意違維慰遺緯域育一壱逸茨芋引印因咽姻員院淫陰飲隠韻右宇羽雨唄鬱畝浦運雲永泳英映栄営詠影鋭衛易疫益液駅悦越謁閲円延沿炎怨宴媛援園煙猿遠鉛塩演縁艶汚王凹央応往押旺欧殴桜翁奥横岡屋億憶臆虞乙俺卸音恩温穏下化火加可仮何花佳価果河苛科架夏家荷華菓貨渦過嫁暇禍靴寡歌箇稼課蚊牙瓦我画芽賀雅餓介回灰会快戒改怪拐悔海界皆械絵開階塊楷解潰壊懐諧貝外劾害崖涯街慨蓋該概骸垣柿各角拡革格核殻郭覚較隔閣確獲嚇穫学岳楽額顎掛潟括活喝渇割葛滑褐轄且株釜鎌刈干刊甘汗缶完肝官冠巻看陥乾勘患貫寒喚堪換敢棺款間閑勧寛幹感漢慣管関歓監緩憾還館環簡観韓艦鑑丸含岸岩玩眼頑顔願企伎危机気岐希忌汽奇祈季紀軌既記起飢鬼帰基寄規亀喜幾揮期棋貴棄毀旗器畿輝機騎技宜偽欺義疑儀戯擬犠議菊吉喫詰却客脚逆虐九久及弓丘旧休吸朽臼求究泣急級糾宮救球給嗅窮牛去巨居拒拠挙虚許距魚御漁凶共叫狂京享供協況峡挟狭恐恭胸脅強教郷境橋矯鏡競響驚仰暁業凝曲局極玉巾斤均近金菌勤琴筋僅禁緊錦謹襟吟銀区句苦駆具惧愚空偶遇隅串屈掘窟熊繰君訓勲薫軍郡群兄刑形系径茎係型契計恵啓掲渓経蛍敬景軽傾携継詣慶憬稽憩警鶏芸迎鯨隙劇撃激桁欠穴血決結傑潔月犬件見券肩建研県倹兼剣拳軒健険圏堅検嫌献絹遣権憲賢謙鍵繭顕験懸元幻玄言弦限原現舷減源厳己戸古呼固股虎孤弧故枯個庫湖雇誇鼓錮顧五互午呉後娯悟碁語誤護口工公勾孔功巧広甲交光向后好江考行坑孝抗攻更効幸拘肯侯厚恒洪皇紅荒郊香候校耕航貢降高康控梗黄喉慌港硬絞項溝鉱構綱酵稿興衡鋼講購乞号合拷剛傲豪克告谷刻国黒穀酷獄骨駒込頃今困昆恨根婚混痕紺魂墾懇左佐沙査砂唆差詐鎖座挫才再災妻采砕宰栽彩採済祭斎細菜最裁債催塞歳載際埼在材剤財罪崎作削昨柵索策酢搾錯咲冊札刷刹拶殺察撮擦雑皿三山参桟蚕惨産傘散算酸賛残斬暫士子支止氏仕史司四市矢旨死糸至伺志私使刺始姉枝祉肢姿思指施師恣紙脂視紫詞歯嗣試詩資飼誌雌摯賜諮示字寺次耳自似児事侍治持時滋慈辞磁餌璽鹿式識軸七叱失室疾執湿嫉漆質実芝写社車舎者射捨赦斜煮遮謝邪蛇尺借酌釈爵若弱寂手主守朱取狩首殊珠酒腫種趣寿受呪授需儒樹収囚州舟秀周宗拾秋臭修袖終羞習週就衆集愁酬醜蹴襲十汁充住柔重従渋銃獣縦叔祝宿淑粛縮塾熟出述術俊春瞬旬巡盾准殉純循順準潤遵処初所書庶暑署緒諸女如助序叙徐除小升少召匠床抄肖尚招承昇松沼昭宵将消症祥称笑唱商渉章紹訟勝掌晶焼焦硝粧詔証象傷奨照詳彰障憧衝賞償礁鐘上丈冗条状乗城浄剰常情場畳蒸縄壌嬢錠譲醸色拭食植殖飾触嘱織職辱尻心申伸臣芯身辛侵信津神唇娠振浸真針深紳進森診寝慎新審震薪親人刃仁尽迅甚陣尋腎須図水吹垂炊帥粋衰推酔遂睡穂随髄枢崇数据杉裾寸瀬是井世正生成西声制姓征性青斉政星牲省凄逝清盛婿晴勢聖誠精製誓静請整醒税夕斥石赤昔析席脊隻惜戚責跡積績籍切折拙窃接設雪摂節説舌絶千川仙占先宣専泉浅洗染扇栓旋船戦煎羨腺詮践箋銭潜線遷選薦繊鮮全前善然禅漸膳繕狙阻祖租素措粗組疎訴塑遡礎双壮早争走奏相荘草送倉捜挿桑巣掃曹曽爽窓創喪痩葬装僧想層総遭槽踪操燥霜騒藻造像増憎蔵贈臓即束足促則息捉速側測俗族属賊続卒率存村孫尊損遜他多汰打妥唾堕惰駄太対体耐待怠胎退帯泰堆袋逮替貸隊滞態戴大代台第題滝宅択沢卓拓託濯諾濁但達脱奪棚誰丹旦担単炭胆探淡短嘆端綻誕鍛団男段断弾暖談壇地池知値恥致遅痴稚置緻竹畜逐蓄築秩窒茶着嫡中仲虫沖宙忠抽注昼柱衷酎鋳駐著貯丁弔庁兆町長挑帳張彫眺釣頂鳥朝貼超腸跳徴嘲潮澄調聴懲直勅捗沈珍朕陳賃鎮追椎墜通痛塚漬坪爪鶴低呈廷弟定底抵邸亭貞帝訂庭逓停偵堤提程艇締諦泥的笛摘滴適敵溺迭哲鉄徹撤天典店点展添転填田伝殿電斗吐妬徒途都渡塗賭土奴努度怒刀冬灯当投豆東到逃倒凍唐島桃討透党悼盗陶塔搭棟湯痘登答等筒統稲踏糖頭謄藤闘騰同洞胴動堂童道働銅導瞳峠匿特得督徳篤毒独読栃凸突届屯豚頓貪鈍曇丼那奈内梨謎鍋南軟難二尼弐匂肉虹日入乳尿任妊忍認寧熱年念捻粘燃悩納能脳農濃把波派破覇馬婆罵拝杯背肺俳配排敗廃輩売倍梅培陪媒買賠白伯拍泊迫剥舶博薄麦漠縛爆箱箸畑肌八鉢発髪伐抜罰閥反半氾犯帆汎伴判坂阪板版班畔般販斑飯搬煩頒範繁藩晩番蛮盤比皮妃否批彼披肥非卑飛疲秘被悲扉費碑罷避尾眉美備微鼻膝肘匹必泌筆姫百氷表俵票評漂標苗秒病描猫品浜貧賓頻敏瓶不夫父付布扶府怖阜附訃負赴浮婦符富普腐敷膚賦譜侮武部舞封風伏服副幅復福腹複覆払沸仏物粉紛雰噴墳憤奮分文聞丙平兵併並柄陛閉塀幣弊蔽餅米壁璧癖別蔑片辺返変偏遍編弁便勉歩保哺捕補舗母募墓慕暮簿方包芳邦奉宝抱放法泡胞俸倣峰砲崩訪報蜂豊飽褒縫亡乏忙坊妨忘防房肪某冒剖紡望傍帽棒貿貌暴膨謀頬北木朴牧睦僕墨撲没勃堀本奔翻凡盆麻摩磨魔毎妹枚昧埋幕膜枕又末抹万満慢漫未味魅岬密蜜脈妙民眠矛務無夢霧娘名命明迷冥盟銘鳴滅免面綿麺茂模毛妄盲耗猛網目黙門紋問冶夜野弥厄役約訳薬躍闇由油喩愉諭輸癒唯友有勇幽悠郵湧猶裕遊雄誘憂融優与予余誉預幼用羊妖洋要容庸揚揺葉陽溶腰様瘍踊窯養擁謡曜抑沃浴欲翌翼拉裸羅来雷頼絡落酪辣乱卵覧濫藍欄吏利里理痢裏履璃離陸立律慄略柳流留竜粒隆硫侶旅虜慮了両良料涼猟陵量僚領寮療瞭糧力緑林厘倫輪隣臨瑠涙累塁類令礼冷励戻例鈴零霊隷齢麗暦歴列劣烈裂恋連廉練錬呂炉賂路露老労弄郎朗浪廊楼漏籠六録麓論和話賄脇惑枠湾腕';

// 常用外漢字を含む単語を検出する関数（旧形式・互換用）
function detectNonJoyoWords(text) {
    const results = [];
    // テキストから漢字を含む単語（連続した漢字）を抽出
    const kanjiPattern = /[\u4e00-\u9faf]+/g;
    const matches = text.match(kanjiPattern) || [];

    matches.forEach(word => {
        const nonJoyoChars = [...word].filter(c => !JOYO_KANJI.includes(c));
        if (nonJoyoChars.length > 0) {
            results.push({ word, nonJoyoChars });
        }
    });
    // 重複を除去
    const uniqueResults = [];
    const seen = new Set();
    results.forEach(r => {
        const key = r.word;
        if (!seen.has(key)) {
            seen.add(key);
            uniqueResults.push(r);
        }
    });
    return uniqueResults;
}

// 常用外漢字を含む行を検出する関数（ページ情報付き）
// files: { name: string, content: string }[] の配列
// 「----------」（ハイフン10個）または「<<XPage>>」形式によるページ区切りに対応
// 「[XX巻]」形式による巻番号にも対応
// 同じ常用外漢字は初出のみ検出（2回目以降は無視）
function detectNonJoyoLinesWithPageInfo(files) {
    const results = [];
    const seenNonJoyoChars = new Set(); // 既出の常用外漢字を追跡

    // ページ区切りパターンの正規表現
    const pageMarkerRegex = /^<<(\d+)Page>>$/;
    // 巻番号パターンの正規表現
    const volumeMarkerRegex = /^\[(\d+)巻\]$/;

    // 各ファイルを処理
    files.forEach(file => {
        const content = file.content;
        const lines = content.split(/\r?\n/);

        // このファイル内のマーカーの有無をチェック
        const hasHyphenDelimiter = content.includes('----------');
        const hasPageMarker = /<<\d+Page>>/.test(content);
        const hasVolumeMarker = /\[\d+巻\]/.test(content);

        // マーカーがある場合はマーカーベースでページ追跡
        if (hasHyphenDelimiter || hasPageMarker || hasVolumeMarker) {
            let currentPage = 1;
            let currentVolume = null;
            let isFirstLine = true;

            // 冒頭が「----------」で始まる場合の処理（<<XPage>>形式がない場合のみ）
            let i = 0;
            if (!hasPageMarker && !hasVolumeMarker) {
                while (i < lines.length && lines[i].trim() === '----------') {
                    if (!isFirstLine) {
                        currentPage++;
                    }
                    isFirstLine = false;
                    i++;
                }
                if (i > 0) {
                    isFirstLine = false;
                }
            }

            for (; i < lines.length; i++) {
                const line = lines[i];
                const trimmedLine = line.trim();

                // [XX巻]形式の巻マーカーを検出
                const volumeMarkerMatch = trimmedLine.match(volumeMarkerRegex);
                if (volumeMarkerMatch) {
                    currentVolume = parseInt(volumeMarkerMatch[1], 10);
                    // 巻が変わったらページは1からリセット（<<XPage>>形式がない場合）
                    if (!hasPageMarker) {
                        currentPage = 1;
                    }
                    continue;
                }

                // <<XPage>>形式のページマーカーを検出
                const pageMarkerMatch = trimmedLine.match(pageMarkerRegex);
                if (pageMarkerMatch) {
                    currentPage = parseInt(pageMarkerMatch[1], 10);
                    continue;
                }

                // ページ区切り「----------」の検出（<<XPage>>形式がない場合のみカウント）
                if (trimmedLine === '----------') {
                    if (!hasPageMarker) {
                        currentPage++;
                    }
                    continue;
                }

                if (!trimmedLine) continue; // 空行はスキップ

                // この行に含まれる常用外漢字を検出（初出のみ）
                const nonJoyoChars = [];
                for (const char of line) {
                    if (/[\u4e00-\u9faf]/.test(char)) {
                        if (!JOYO_KANJI.includes(char) && !nonJoyoChars.includes(char) && !seenNonJoyoChars.has(char)) {
                            nonJoyoChars.push(char);
                        }
                    }
                }

                if (nonJoyoChars.length > 0) {
                    nonJoyoChars.forEach(char => seenNonJoyoChars.add(char));
                    // ページ表示文字列を生成（巻番号がある場合は「X巻 YP」形式）
                    const pageDisplay = currentVolume !== null
                        ? `${currentVolume}巻 ${currentPage}P`
                        : String(currentPage);
                    results.push({
                        page: pageDisplay,
                        volume: currentVolume,
                        pageNum: currentPage,
                        line: line.trim(),
                        nonJoyoChars: nonJoyoChars
                    });
                }
            }
        } else {
            // マーカーがない場合はファイル名からページ番号を抽出
            const pageMatch = file.name.match(/(\d+)/);
            const page = pageMatch ? pageMatch[1] : file.name.replace(/\.txt$/i, '');

            lines.forEach(line => {
                if (!line.trim()) return;

                const nonJoyoChars = [];
                for (const char of line) {
                    if (/[\u4e00-\u9faf]/.test(char)) {
                        if (!JOYO_KANJI.includes(char) && !nonJoyoChars.includes(char) && !seenNonJoyoChars.has(char)) {
                            nonJoyoChars.push(char);
                        }
                    }
                }

                if (nonJoyoChars.length > 0) {
                    nonJoyoChars.forEach(char => seenNonJoyoChars.add(char));
                    results.push({
                        page: page,
                        line: line.trim(),
                        nonJoyoChars: nonJoyoChars
                    });
                }
            });
        }
    });

    return results;
}

// 検出された常用外漢字を含む単語（TXT読み込み時に更新）
// [moved to state] detectedNonJoyoWords
// [moved to state] manuscriptTxtFiles
// [moved to state] txtGuideDismissed
function loadManuscriptTxt(input) {
    const files = input.files;
    if (!files || files.length === 0) return;

    let loadedCount = 0;
    const totalFiles = files.length;

    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            state.manuscriptTxtFiles.push({
                name: file.name,
                content: e.target.result,
                size: file.size
            });

            loadedCount++;
            if (loadedCount === totalFiles) {
                updateTxtUploadStatus();
                generateXML();
                hideTxtGuide(); // ファイル読み込み後はガイドを非表示

                // TXTファイル読み込み後、Geminiボタンを有効化
                const geminiBtn = document.getElementById('extractionGeminiBtn');
                if (geminiBtn) {
                    geminiBtn.removeAttribute('disabled');
                }
            }
        };
        reader.readAsText(file, 'UTF-8');
    });

    // input要素をリセット（同じファイルを再度選択可能にする）
    input.value = '';
}

// セリフTXTファイルを追加（管理モーダルから）
function addManuscriptTxt(input) {
    loadManuscriptTxt(input);
}

// 常用外漢字検出結果を更新
function updateNonJoyoDetection() {
    if (state.manuscriptTxtFiles.length === 0) {
        state.detectedNonJoyoWords = [];
        return;
    }
    // 全TXTファイルの内容を結合して検出
    const allText = state.manuscriptTxtFiles.map(f => f.content).join('\n');
    state.detectedNonJoyoWords = detectNonJoyoWords(allText);
}

// 常用外漢字検出結果ポップアップを表示
// forceShow: trueの場合はチェックボックスの状態に関係なく表示
function showNonJoyoResultPopup(detectedLines, forceShow = false) {
    if (!forceShow && !state.optionNonJoyoCheck) return;

    const modal = document.getElementById('nonJoyoResultModal');
    const body = document.getElementById('nonJoyoResultBody');

    if (!modal || !body) return;

    // 選択状態を初期化（全て選択状態）
    state.proofreadingSelectedNonJoyoIndexes = detectedLines ? detectedLines.map((_, i) => i) : [];

    let html;
    if (!detectedLines || detectedLines.length === 0) {
        html = '<p style="color:#888; text-align:center; padding:20px;">常用外漢字は検出されませんでした。</p>';
    } else {
        html = '<p style="margin-bottom:8px;">プロンプトに含める項目にチェックを入れてください：</p>';
        html += '<div style="margin-bottom:8px; display:flex; gap:8px;">';
        html += '<button class="btn btn-small btn-gray" onclick="toggleAllNonJoyoCheckboxes(true)" style="padding:4px 10px; font-size:0.85em;">全選択</button>';
        html += '<button class="btn btn-small btn-gray" onclick="toggleAllNonJoyoCheckboxes(false)" style="padding:4px 10px; font-size:0.85em;">全解除</button>';
        html += '</div>';
        html += '<div style="max-height:350px; overflow-y:auto;">';
        html += '<table style="width:100%; border-collapse:collapse; font-size:0.9em;">';
        html += '<tr style="background:var(--surface-dim);">';
        html += '<th style="padding:8px; border:1px solid #ddd; width:40px;"><input type="checkbox" id="nonJoyoSelectAll" checked onchange="toggleAllNonJoyoCheckboxes(this.checked)"></th>';
        html += '<th style="padding:8px; border:1px solid #ddd; width:90px;">該当箇所</th>';
        html += '<th style="padding:8px; border:1px solid #ddd;">該当行</th>';
        html += '<th style="padding:8px; border:1px solid #ddd; width:80px;">常用外</th>';
        html += '</tr>';
        detectedLines.forEach((item, index) => {
            // 該当行をハイライト（常用外漢字を赤色に）
            let highlightedLine = escapeHtml(item.line);
            item.nonJoyoChars.forEach(char => {
                highlightedLine = highlightedLine.replace(new RegExp(char, 'g'), `<span style="color:#e74c3c; font-weight:bold;">${char}</span>`);
            });
            html += `<tr>`;
            html += `<td style="padding:8px; border:1px solid #ddd; text-align:center;"><input type="checkbox" class="nonJoyoItemCheckbox" data-index="${index}" checked onchange="updateNonJoyoSelection(${index}, this.checked)"></td>`;
            html += `<td style="padding:8px; border:1px solid #ddd; text-align:center; font-weight:bold;">${escapeHtml(item.page)}</td>`;
            html += `<td style="padding:8px; border:1px solid #ddd;">${highlightedLine}</td>`;
            html += `<td style="padding:8px; border:1px solid #ddd; color:#e74c3c; font-weight:bold; text-align:center;">${item.nonJoyoChars.join(', ')}</td>`;
            html += `</tr>`;
        });
        html += '</table></div>';
        html += `<p style="margin-top:12px; color:#666; font-size:0.9em;">計 ${detectedLines.length} 行（<span id="nonJoyoSelectedCount">${detectedLines.length}</span> 件選択中）</p>`;
    }

    body.innerHTML = html;
    modal.style.display = 'flex';
}

// 常用外漢字の選択状態を更新
function updateNonJoyoSelection(index, isChecked) {
    if (isChecked) {
        if (!state.proofreadingSelectedNonJoyoIndexes.includes(index)) {
            state.proofreadingSelectedNonJoyoIndexes.push(index);
        }
    } else {
        state.proofreadingSelectedNonJoyoIndexes = state.proofreadingSelectedNonJoyoIndexes.filter(i => i !== index);
    }
    // 選択件数を更新
    const countEl = document.getElementById('nonJoyoSelectedCount');
    if (countEl) {
        countEl.textContent = state.proofreadingSelectedNonJoyoIndexes.length;
    }
    // 全選択チェックボックスの状態を更新
    updateNonJoyoSelectAllCheckbox();
}

// 全選択/全解除
function toggleAllNonJoyoCheckboxes(selectAll) {
    const checkboxes = document.querySelectorAll('.nonJoyoItemCheckbox');
    if (selectAll) {
        state.proofreadingSelectedNonJoyoIndexes = state.proofreadingDetectedNonJoyoWords.map((_, i) => i);
    } else {
        state.proofreadingSelectedNonJoyoIndexes = [];
    }
    checkboxes.forEach(cb => {
        cb.checked = selectAll;
    });
    // 全選択チェックボックスの状態を更新
    const selectAllCb = document.getElementById('nonJoyoSelectAll');
    if (selectAllCb) {
        selectAllCb.checked = selectAll;
    }
    // 選択件数を更新
    const countEl = document.getElementById('nonJoyoSelectedCount');
    if (countEl) {
        countEl.textContent = state.proofreadingSelectedNonJoyoIndexes.length;
    }
}

// 全選択チェックボックスの状態を更新
function updateNonJoyoSelectAllCheckbox() {
    const selectAllCb = document.getElementById('nonJoyoSelectAll');
    if (!selectAllCb) return;
    const total = state.proofreadingDetectedNonJoyoWords.length;
    const selected = state.proofreadingSelectedNonJoyoIndexes.length;
    selectAllCb.checked = total === selected;
    selectAllCb.indeterminate = selected > 0 && selected < total;
}

// 選択された常用外漢字のリストを取得
function getSelectedNonJoyoLines() {
    return state.proofreadingDetectedNonJoyoWords.filter((_, i) => state.proofreadingSelectedNonJoyoIndexes.includes(i));
}

// 常用外漢字検出結果ポップアップを閉じる
function closeNonJoyoResultModal() {
    document.getElementById('nonJoyoResultModal').style.display = 'none';
}

// 常用外漢字の選択を確定してモーダルを閉じる
function confirmNonJoyoSelection() {
    closeNonJoyoResultModal();
    // プロンプトを再生成
    updateProofreadingPrompt();
}

// 常用外漢字の選択をキャンセルしてモーダルを閉じる（×ボタン用）
function cancelNonJoyoSelection() {
    // 選択をすべてクリア（プロンプトに含めない）
    state.proofreadingSelectedNonJoyoIndexes = [];
    closeNonJoyoResultModal();
    // プロンプトを再生成（常用外漢字チェック項目なし）
    updateProofreadingPrompt();
}

// 特定のセリフTXTファイルを削除
function removeManuscriptTxt(index) {
    if (index >= 0 && index < state.manuscriptTxtFiles.length) {
        state.manuscriptTxtFiles.splice(index, 1);
        updateTxtUploadStatus();
        updateNonJoyoDetection();
        renderTxtFileList();
        generateXML();
    }
}

// すべてのセリフTXTファイルをクリア
function clearAllManuscriptTxt() {
    if (state.manuscriptTxtFiles.length === 0) return;
    if (!confirm('すべてのセリフTXTファイルをクリアしますか？')) return;

    state.manuscriptTxtFiles = [];
    state.detectedNonJoyoWords = [];
    updateTxtUploadStatus();
    renderTxtFileList();
    generateXML();
}

// セリフTXTステータス表示の更新
function updateTxtUploadStatus() {
    // COMIC-Bridge統合版: 親アプリのテキストを自動同期（エラー無視）
    try { syncTextFromComicBridge(); } catch (e) { /* ignore */ }

    var statusEl = document.getElementById('txtBridgeStatus') || document.getElementById('txtUploadStatus');
    if (!statusEl) return;

    if (state.manuscriptTxtFiles.length > 0) {
        var f = state.manuscriptTxtFiles[0];
        statusEl.textContent = '✓ ' + f.name;
        statusEl.style.color = '#27ae60';
    } else {
        statusEl.textContent = '';
    }
}

// COMIC-Bridgeの親ウィンドウからテキストを取得して state に反映
function syncTextFromComicBridge() {
    try {
        var bridge = window._getBridge ? window._getBridge() : null;
        if (!bridge) return;
        var content = bridge.getTextContent();
        var fileName = bridge.getTextFileName() || 'text.txt';
        if (content) {
            // 既に同じ内容なら更新しない
            if (state.manuscriptTxtFiles.length === 1
                && state.manuscriptTxtFiles[0].content === content
                && state.manuscriptTxtFiles[0].name === fileName) return;
            state.manuscriptTxtFiles = [{
                name: fileName,
                content: content,
                size: new Blob([content]).size
            }];
            state.txtGuideDismissed = true;
        } else {
            if (state.manuscriptTxtFiles.length === 0) return;
            state.manuscriptTxtFiles = [];
        }
    } catch (e) {
        // cross-origin error: 無視
    }
}

// TXT管理モーダルを開く
function openTxtManageModal() {
    renderTxtFileList();
    document.getElementById('txtManageModal').style.display = 'flex';
}

// TXT管理モーダルを閉じる
function closeTxtManageModal() {
    document.getElementById('txtManageModal').style.display = 'none';
}

// TXTファイルリストの描画
function renderTxtFileList() {
    const listEl = document.getElementById('txtFileList');
    const totalInfoEl = document.getElementById('txtTotalInfo');

    if (state.manuscriptTxtFiles.length === 0) {
        listEl.innerHTML = '<p style="color:#999; text-align:center; padding:20px;">読み込まれたファイルはありません</p>';
        totalInfoEl.textContent = '';
        return;
    }

    let html = '';
    let totalSize = 0;
    state.manuscriptTxtFiles.forEach((file, index) => {
        totalSize += file.size;
        const sizeStr = formatFileSize(file.size);
        html += `
            <div class="txt-file-item">
                <div class="txt-file-info">
                    <span class="txt-file-icon">📄</span>
                    <span class="txt-file-name">${escapeHtml(file.name)}</span>
                    <span class="txt-file-size">${sizeStr}</span>
                </div>
                <button class="txt-file-remove" onclick="removeManuscriptTxt(${index})">削除</button>
            </div>
        `;
    });
    listEl.innerHTML = html;
    totalInfoEl.textContent = `${state.manuscriptTxtFiles.length}ファイル / ${formatFileSize(totalSize)}`;
}

// ファイルサイズのフォーマット
function formatFileSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
}

// データ種別変更ハンドラ
function onDataTypeChange() {
    const dataType = document.getElementById('dataTypeSelector').value;
    const txtUploadGroup = document.getElementById('txtUploadGroup');

    // PDFのみの場合はセリフTXT読込ボタンを非表示し、TXTデータをクリア
    if (dataType === 'pdf_only') {
        if (txtUploadGroup) txtUploadGroup.style.display = 'none';
        hideTxtGuide();

        // TXTデータをクリア（プレビューに残らないようにする）
        if (state.manuscriptTxtFiles.length > 0) {
            state.manuscriptTxtFiles = [];
            state.detectedNonJoyoWords = [];
            updateTxtUploadStatus();
        }
    } else {
        if (txtUploadGroup) txtUploadGroup.style.display = '';
        // COMIC-Bridge統合版: テキストガイドは表示しない（親から自動同期）
        try { syncTextFromComicBridge(); } catch (e) { /* ignore */ }
    }

    generateXML();
}

// データ種別ドロップダウンの開閉
function toggleDataTypeDropdown() {
    // Legacy — no longer needed with segment toggle
}

function enableDataTypeToggle() {
    const toggle = document.getElementById('dataTypeToggle');
    if (toggle) {
        toggle.querySelectorAll('.data-type-option').forEach(btn => btn.removeAttribute('disabled'));
    }
}

function disableDataTypeToggle() {
    const toggle = document.getElementById('dataTypeToggle');
    if (toggle) {
        toggle.querySelectorAll('.data-type-option').forEach(btn => btn.setAttribute('disabled', 'disabled'));
    }
}

// データ種別を選択
function selectDataType(value) {
    const hiddenInput = document.getElementById('dataTypeSelector');
    if (!hiddenInput) return;

    // hidden inputの値を更新
    hiddenInput.value = value;

    // セグメントトグルのアクティブ状態を更新
    const toggle = document.getElementById('dataTypeToggle');
    if (toggle) {
        toggle.querySelectorAll('.data-type-option').forEach(btn => {
            if (btn.dataset.value === value) {
                btn.classList.add('active');
            } else {
                btn.classList.remove('active');
            }
        });
    }

    // データ種別変更処理を呼び出す
    onDataTypeChange();

    // 添付ファイル設定に応じてモードスイッチャーを連動
    const extractionBtn = document.getElementById('extractionModeBtn');
    const formattingBtn = document.getElementById('formattingModeBtn');
    if (extractionBtn && formattingBtn) {
        if (value === 'txt_only') {
            extractionBtn.classList.remove('active');
            formattingBtn.classList.add('active');
        } else {
            formattingBtn.classList.remove('active');
            extractionBtn.classList.add('active');
        }
    }

    // 抽出プロンプトモード時：Geminiボタンは常に有効
    const geminiBtn = document.getElementById('extractionGeminiBtn');
    if (geminiBtn && !geminiBtn.hasAttribute('disabled')) {
        // 既に有効なら何もしない（初期ロック中は触らない）
    } else if (geminiBtn && document.getElementById('labelSelector').value) {
        // レーベルが選択済みなら有効化
        geminiBtn.removeAttribute('disabled');
    }

    // TXTモード時のみセリフTXT読込ボタンを表示
    const txtUploadGroup = document.getElementById('txtUploadGroup');
    if (txtUploadGroup) {
        const needsTxt = (value === 'pdf_and_txt' || value === 'txt_only');
        txtUploadGroup.style.display = needsTxt ? 'flex' : 'none';
    }
}

function onOutputFormatVolumeChange(val) {
    state.outputFormatVolume = parseInt(val) || 1;
    generateXML();
}

function onOutputFormatStartPageChange(val) {
    state.outputFormatStartPage = parseInt(val) || 1;
    generateXML();
}

function onOutputFormatSortModeChange(val) {
    state.outputFormatSortMode = val;
    generateXML();
}

// Geminiボタンのロック解除とポップアップ表示
function unlockExtractionGeminiButton() {
    const geminiBtn = document.getElementById('extractionGeminiBtn');
    if (geminiBtn && geminiBtn.hasAttribute('disabled')) {
        geminiBtn.removeAttribute('disabled');
        showExtractionGeminiPopup();
    }
}

// 抽出プロンプトモードのGeminiボタン用ポップアップ表示
function showExtractionGeminiPopup() {
    // 既存のポップアップがあれば削除
    const existingPopup = document.getElementById('extractionGeminiPopup');
    if (existingPopup) {
        existingPopup.remove();
    }

    // ポップアップ要素を作成
    const popup = document.createElement('div');
    popup.id = 'extractionGeminiPopup';
    popup.className = 'extraction-gemini-popup';
    popup.innerHTML = `
        <div class="popup-content">
            <span class="popup-icon"><img src="logo/gemini_logo.png" alt="Gemini" style="width:20px; height:20px;"></span>
            <span class="popup-text">プロンプトがコピーされました。ボタンからGeminiに移動してペーストしてください</span>
            <button class="popup-close" onclick="closeExtractionGeminiPopup()">&times;</button>
        </div>
    `;
    document.body.appendChild(popup);

    // アニメーション用にすぐに表示
    setTimeout(() => {
        popup.classList.add('show');
    }, 10);

    // 5秒後に自動で閉じる
    setTimeout(() => {
        closeExtractionGeminiPopup();
    }, 5000);
}

// 抽出プロンプトモードのGeminiボタン用ポップアップを閉じる
function closeExtractionGeminiPopup() {
    const popup = document.getElementById('extractionGeminiPopup');
    if (popup) {
        popup.classList.remove('show');
        setTimeout(() => {
            popup.remove();
        }, 300);
    }
}

// ドロップダウン外クリックで閉じる
document.addEventListener('click', function(e) {
    const dropdownGroups = document.querySelectorAll('.dropdown-group');
    dropdownGroups.forEach(group => {
        if (!group.contains(e.target)) {
            group.classList.remove('open');
        }
    });
});

// TXT読み込みガイドの表示
function showTxtGuide() {
    const guideEl = document.getElementById('txtGuideNotification');
    if (guideEl) guideEl.style.display = 'flex';

    // ドロップゾーンの初期化（初回のみ）
    const dropZone = document.getElementById('txtGuideDropZone');
    if (dropZone && !dropZone._dropZoneInitialized) {
        setupDropZone(dropZone, loadManuscriptTxt);
        dropZone._dropZoneInitialized = true;
    }
}

// TXT読み込みガイドの非表示
function hideTxtGuide() {
    const guideEl = document.getElementById('txtGuideNotification');
    if (guideEl) guideEl.style.display = 'none';
}

// TXT読み込みガイドを閉じる（ユーザー操作）
function dismissTxtGuide() {
    state.txtGuideDismissed = true;
    hideTxtGuide();
}


// ドロップゾーン: Tauri D&D イベント経由でTXTファイル読み込み
// dragDropEnabled: true なので HTML5 drop イベントは発火しない
// 要素の可視性でターゲットを判定（位置情報は使わない）
function setupDropZone(element, loadFn) {
    // ドラッグ中のビジュアルフィードバック
    document.addEventListener('tauri-drag-enter', () => {
        if (_isElementVisible(element)) element.classList.add('dragover');
    });
    document.addEventListener('tauri-drag-leave', () => {
        element.classList.remove('dragover');
    });

    // Tauri D&D ハンドラを登録
    window._registerDragDropHandler((paths) => {
        if (!_isElementVisible(element)) return false;

        element.classList.remove('dragover');

        // TXTファイルをパスから読み込み
        const txtPaths = paths.filter(p => p.toLowerCase().endsWith('.txt'));
        if (txtPaths.length === 0) return false;

        window.electronAPI.readDroppedTxtFiles(txtPaths).then(result => {
            if (!result.success || result.files.length === 0) return;
            const fakeFiles = result.files.map(f => {
                const blob = new Blob([f.content], { type: 'text/plain' });
                const file = new File([blob], f.name, { type: 'text/plain' });
                return file;
            });
            const fakeInput = { files: fakeFiles, value: '' };
            loadFn(fakeInput);
        });
        return true;
    });
}

function _isElementVisible(el) {
    if (!el) return false;
    const style = window.getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') return false;
    return el.offsetParent !== null || el.style.position === 'fixed';
}

// ES Module exports
export { loadMasterRule, detectNonJoyoWords, detectNonJoyoLinesWithPageInfo, loadManuscriptTxt, addManuscriptTxt, updateNonJoyoDetection, showNonJoyoResultPopup, updateNonJoyoSelection, toggleAllNonJoyoCheckboxes, updateNonJoyoSelectAllCheckbox, getSelectedNonJoyoLines, closeNonJoyoResultModal, confirmNonJoyoSelection, cancelNonJoyoSelection, removeManuscriptTxt, clearAllManuscriptTxt, updateTxtUploadStatus, openTxtManageModal, closeTxtManageModal, renderTxtFileList, formatFileSize, onDataTypeChange, toggleDataTypeDropdown, selectDataType, enableDataTypeToggle, disableDataTypeToggle, onOutputFormatVolumeChange, onOutputFormatStartPageChange, onOutputFormatSortModeChange, unlockExtractionGeminiButton, showExtractionGeminiPopup, closeExtractionGeminiPopup, showTxtGuide, hideTxtGuide, dismissTxtGuide, setupDropZone };

// Expose to window for inline HTML handlers
Object.assign(window, { categories, numberSubRules, numberBaseOptions, loadMasterRule, detectNonJoyoWords, detectNonJoyoLinesWithPageInfo, loadManuscriptTxt, addManuscriptTxt, updateNonJoyoDetection, showNonJoyoResultPopup, updateNonJoyoSelection, toggleAllNonJoyoCheckboxes, updateNonJoyoSelectAllCheckbox, getSelectedNonJoyoLines, closeNonJoyoResultModal, confirmNonJoyoSelection, cancelNonJoyoSelection, removeManuscriptTxt, clearAllManuscriptTxt, updateTxtUploadStatus, syncTextFromComicBridge, openTxtManageModal, closeTxtManageModal, renderTxtFileList, formatFileSize, onDataTypeChange, toggleDataTypeDropdown, selectDataType, enableDataTypeToggle, disableDataTypeToggle, onOutputFormatVolumeChange, onOutputFormatStartPageChange, onOutputFormatSortModeChange, unlockExtractionGeminiButton, showExtractionGeminiPopup, closeExtractionGeminiPopup, showTxtGuide, hideTxtGuide, dismissTxtGuide, setupDropZone });
