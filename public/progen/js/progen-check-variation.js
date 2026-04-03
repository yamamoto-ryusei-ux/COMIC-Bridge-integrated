/* =========================================
   詳細チェック機能（項目1〜8）
   ========================================= */
import { state } from './progen-state.js';
let variationCheckTxtFiles = []; // 詳細チェック用のTXTファイル

// 詳細チェックモーダルを開く — COMIC-Bridge統合版: 親テキストを自動取得
function openVariationCheckModal() {
    syncVariationCheckFromBridge();
    renderVariationCheckFileList();
    updateVariationCheckSubmitBtn();
    document.getElementById('variationCheckModal').style.display = 'flex';
}

// 詳細チェックモーダルを閉じる
function closeVariationCheckModal() {
    document.getElementById('variationCheckModal').style.display = 'none';
    variationCheckTxtFiles = [];
}

// COMIC-Bridge統合版: 親からテキスト同期
function syncVariationCheckFromBridge() {
    try {
        var bridge = window._getBridge ? window._getBridge() : null;
        if (!bridge) return;
        var content = bridge.getTextContent();
        var fileName = bridge.getTextFileName() || 'text.txt';
        if (content) {
            variationCheckTxtFiles = [{ name: fileName, content: content, size: new Blob([content]).size }];
        } else {
            variationCheckTxtFiles = [];
        }
    } catch (e) { /* cross-origin */ }
}

// 詳細チェック用TXTファイル読み込み（COMIC-Bridge統合版: 親から同期）
function loadVariationCheckTxt(input) {
    syncVariationCheckFromBridge();
    renderVariationCheckFileList();
    updateVariationCheckSubmitBtn();
}

// 詳細チェック用ファイルリスト描画
function renderVariationCheckFileList() {
    const listEl = document.getElementById('variationCheckFileList');
    const statusEl = document.getElementById('variationCheckTxtStatus');

    if (variationCheckTxtFiles.length === 0) {
        listEl.innerHTML = '<p style="color:#999; text-align:center; padding:15px;">ファイルが選択されていません</p>';
        statusEl.textContent = '';
        return;
    }

    let html = '';
    let totalSize = 0;
    variationCheckTxtFiles.forEach((file, index) => {
        totalSize += file.size;
        const sizeStr = formatFileSize(file.size);
        html += `
            <div class="txt-file-item">
                <div class="txt-file-info">
                    <span class="txt-file-icon">📄</span>
                    <span class="txt-file-name">${escapeHtml(file.name)}</span>
                    <span class="txt-file-size">${sizeStr}</span>
                </div>
                <button class="txt-file-remove" onclick="removeVariationCheckTxt(${index})">削除</button>
            </div>
        `;
    });
    listEl.innerHTML = html;
    statusEl.textContent = `${variationCheckTxtFiles.length}ファイル選択済み`;
    statusEl.style.color = '#3498db';
}

// 詳細チェック用ファイル削除
function removeVariationCheckTxt(index) {
    if (index >= 0 && index < variationCheckTxtFiles.length) {
        variationCheckTxtFiles.splice(index, 1);
        renderVariationCheckFileList();
        updateVariationCheckSubmitBtn();
    }
}

// 送信ボタンの有効/無効を更新
function updateVariationCheckSubmitBtn() {
    const btn = document.getElementById('variationCheckSubmitBtn');
    btn.disabled = variationCheckTxtFiles.length === 0;
}

// 詳細チェックプロンプトを生成してGeminiで開く
function copyVariationCheckAndOpenGemini() {
    if (variationCheckTxtFiles.length === 0) {
        showToast('セリフTXTファイルを選択してください', 'warning');
        return;
    }

    const prompt = generateVariationCheckPromptFromFiles(variationCheckTxtFiles);
    navigator.clipboard.writeText(prompt).then(() => {
        const msg = document.getElementById('copyMsg');
        msg.style.opacity = 1;
        setTimeout(() => { msg.style.opacity = 0; }, 2000);
        closeVariationCheckModal();
        window.open('https://gemini.google.com/app', '_blank');
    });
}

// ランディング画面から詳細チェックを開始
function startVariationCheckFromLanding(input) {
    const files = input.files;
    if (!files || files.length === 0) return;

    let loadedCount = 0;
    const totalFiles = files.length;
    const tempFiles = [];

    Array.from(files).forEach(file => {
        const reader = new FileReader();
        reader.onload = function(e) {
            tempFiles.push({
                name: file.name,
                content: e.target.result,
                size: file.size
            });

            loadedCount++;
            if (loadedCount === totalFiles) {
                const prompt = generateVariationCheckPromptFromFiles(tempFiles);
                navigator.clipboard.writeText(prompt).then(() => {
                    showToast('プロンプトをコピーしました。Geminiを開きます', 'success');
                    window.open('https://gemini.google.com/app', '_blank');
                });
            }
        };
        reader.readAsText(file, 'UTF-8');
    });

    input.value = '';
}

// ファイル配列から詳細チェックプロンプトを生成
function generateVariationCheckPromptFromFiles(files) {
    let manuscriptText = '';
    if (files.length === 1) {
        manuscriptText = files[0].content;
    } else {
        files.forEach((file, index) => {
            manuscriptText += `=== ${file.name} ===\n${file.content}\n\n`;
        });
    }

    return generateVariationCheckPromptWithText(manuscriptText);
}

// テキストを受け取って詳細チェックプロンプトを生成（項目1〜8）
function generateVariationCheckPromptWithText(manuscriptText) {
    return `<?xml version="1.0" encoding="UTF-8"?>
<prompt>
    <system_role>
        あなたはプロの漫画編集者、および校閲担当AIです。
        ユーザーがチャット欄に入力（または貼り付け）したテキストを「漫画のセリフ原稿」として扱い、以下の定義されたルールに従って校正・推敲を行ってください。
    </system_role>

    <behavior_trigger>
        ユーザーからテキストが送信されたら、挨拶や前置きは省略し、直ちに以下の \`<process_instruction>\` に基づくチェックを開始してください。
    </behavior_trigger>

    <process_instruction>
        <task>入力された漫画のセリフ原稿について、表記・固有名詞のチェックを5回実行してください。</task>

        <execution_details>
            <iterations>5</iterations>
            <output_requirement>
                原稿全体に対して、指定された10のチェック項目すべて（網羅的）の視点から、表記・固有名詞のチェックを合計5回繰り返してください。
                この繰り返しは、チェック漏れを防ぐための「見直し」プロセスとして機能させます。

                <b>■ 各回の実行内容：</b>
                <ul>
                    <li><b>1回目：</b> 10項目すべて（網羅的）の視点で原稿をチェックし、見つかった候補を報告してください。</li>
                    <li><b>2回目〜5回目：</b> 再度、10項目すべて（網羅的）の視点で原稿をチェックし、<b>前回までのチェックで見落としていた箇所や、新たに見つかった候補のみ</b>を報告してください。</li>
                </ul>

                <b>■ 報告ルール：</b>
                <b>各回のチェックが完了するごとに、</b>その回で見つかった表記・固有名詞の指摘候補を、後述の「報告フォーマット」に従ったテーブル形式で出力してください。
                <b>（重要）1回目〜5回目の経過出力も、最終リストと同一のテーブル形式（「チェック項目」「該当箇所 (ページ)」「セリフの抜粋」「指摘内容」の4列）で出力してください。</b>

                <b>（重要）その回の網羅的チェック（見直し）において、新たな指摘が1件もなかった場合でも、作業を省略せず、必ず「該当なし」と明記した上で報告してください。</b>

                最後に、5回分のすべての結果を統合し、重複を除いた網羅的な「最終指摘候補リスト」を、同様のテーブル形式で報告してください。
            </output_requirement>
        </execution_details>

        <special_notes>
            <title>チェック時の特記事項</title>

            <rule type="paging">
                <description>原稿のページカウントに関するルール</description>
                <condition check="yes">原稿に明示的なページ番号（例: P1, P2）がない場合、テキストブロックの区切りとして使用されている「-」が10個（----------）をページの区切りと見なしてください。</condition>
                <condition check="yes">その場合、最初のテキストブロックを「1ページ目」、次の「----------」の後のブロックを「2ページ目」としてカウントし、「該当箇所 (ページ)」列に報告してください。</condition>
            </rule>
            <rule type="loanword_choonpu">
                <description>外来語の長音記号については、以下のルールに従ってください。</description>
                <condition check="yes">長音記号の<b>有無</b>（例：「サーバー」と「サーバ」）は、チェック対象として<b>検出してください。</b></condition>
                <condition check="no">ただし、長音記号として使われる記号の<b>種類</b>（「ー」と「～」の違いなど）や、その記号自体の<b>全角・半角の違い</b>は、チェック対象外とし、<b>検出しないでください。</b></condition>
            </rule>
            <rule type="trademark_check">
                <description>固有名詞・商標チェックに関するルール</description>
                <condition check="yes">知名度の高低にかかわらず、実在する企業名・製品名・サービス名・店舗名・ブランド名を検出してください。</condition>
                <condition check="yes">固有名詞かどうか判断に迷う単語は、安全のため検出対象に含めてください。</condition>
                <condition check="no">地名（東京、渋谷、ハワイ等の国・都市・地域・ランドマーク）は検出対象外です。</condition>
                <condition check="no">明らかなパロディ表現（WcDonald's、Somy等の意図的なもじり）は検出対象外です。ただし、パロディか誤植か判断に迷う場合は検出してください。</condition>
            </rule>
            <reporting_instruction>報告の際は、該当箇所とセリフの抜粋を分かりやすく提示してください。</reporting_instruction>
            <reporting_instruction>固有名詞の報告時は、【固有名詞】のラベルと種類（企業名/製品名/サービス名/店舗名）を併記してください。</reporting_instruction>
            <rule type="shiteki_format">
                <description>「指摘内容」列の記載フォーマット</description>
                <condition>「指摘内容」列は簡潔に記載してください。以下のフォーマットに従ってください。</condition>
                <format_by_category>
                    <category items="1,2,3,4,5,6,7" label="表記の統一性チェック（項目1〜7）">
                        <format>「（別の表記A）」（出現ページ一覧）「（別の表記B）」（出現ページ一覧）との混在があります。</format>
                        <format_detail>各「別の表記」の後ろに、その表記が出現する全ページを（P●、P●）形式で付記してください。巻がある場合は（●巻P●、●巻P●）形式にしてください。</format_detail>
                    </category>
                    <category items="8" label="固有名詞・商標（項目8）">
                        <format>【固有名詞】種類（企業名/製品名/サービス名/店舗名/ブランド名）です。</format>
                    </category>
                    <category items="9" label="専門用語・事実の正確性（項目9）">
                        <format>正しい用語が特定できる場合は「正しくは「XXX」です。」、特定できない場合は「事実と異なる可能性あり。」等の短い表現</format>
                    </category>
                    <category items="10" label="未成年に関する表現チェック（項目10）">
                        <format>「（未成年を示す語句）」＋（描写の種類）です。</format>
                    </category>
                </format_by_category>
                <note>長文での説明は不要です。上記フォーマットに従い、1行25文字以内を目安に簡潔に記載してください。</note>
            </rule>
        </special_notes>

        <paging_clarification>
            <title>ページカウントの補足ルール</title>
            <rule id="1">
                <case>空ページ（テキストがなく「----------」が連続する箇所）</case>
                <action>空ページも1ページとしてカウントしてください。</action>
                <example>「セリフA → ---------- → ---------- → セリフB」の場合、セリフAは1ページ目、セリフBは3ページ目です。</example>
            </rule>
            <rule id="2">
                <case>原稿の冒頭が「----------」なしでテキストから始まる場合</case>
                <action>そのテキストを1ページ目として扱ってください。</action>
            </rule>
            <rule id="3">
                <case>原稿の冒頭が「----------」で始まる場合</case>
                <action>冒頭の「----------」が1行のみの場合は、その直後のテキストを1ページ目として扱ってください。</action>
                <action>冒頭の「----------」が2行以上連続する場合は、連続する数だけ空ページがあると見なし、その後のテキストを該当ページ番号で報告してください。</action>
            </rule>
        </paging_clarification>

        <volume_format>
            <title>巻・ページ表記のあるフォーマットへの対応</title>
            <description>原稿に巻番号やページ番号が明示されている場合は、以下のルールに従ってください。</description>
            <rule id="1">
                <pattern>「[XX巻]」形式（例：[08巻]、[09巻]）</pattern>
                <action>巻の区切りとして認識し、該当箇所の報告時に「8巻 3ページ」のように巻番号を含めてください。</action>
            </rule>
            <rule id="2">
                <pattern>「&lt;&lt;XPage&gt;&gt;」形式（例：&lt;&lt;1Page&gt;&gt;、&lt;&lt;12Page&gt;&gt;）</pattern>
                <action>ページ番号として認識し、そのまま該当箇所の報告に使用してください。</action>
            </rule>
            <rule id="3">
                <case>複数巻が連続して入力された場合</case>
                <action>巻をまたいだ表記の不統一も検出対象としてください。</action>
                <example>8巻で「魔法」、9巻で「まほう」と表記されている場合、巻をまたいだ表記の不統一として報告してください。</example>
                <report_format>「該当箇所」列には「8巻 5ページ / 9巻 12ページ」のように、巻とページを明記してください。</report_format>
            </rule>
        </volume_format>

        <check_items>
            <title>チェック項目（10項目）</title>
            <item id="1">
                <name>文字種による違い</name>
                <description>同じ意味を持つ言葉で、漢字・ひらがな・カタカナの表記が混在している箇所。（例: 「して頂く」と「していただく」、「おすすめ」と「オススメ」）</description>
            </item>
            <item id="2">
                <name>送り仮名の違い</name>
                <description>同じ単語で送り仮名が統一されていない箇所。（例: 「申し込み」「申込み」「申込」）</description>
            </item>
            <item id="3">
                <name>外来語・アルファベット表記の違い</name>
                <description>長音符の有無、大文字・小文字、全角・半角、カタカナ・アルファベットの混在など。（例: 「サーバー」と「サーバ」、「Webサイト」と「WEBサイト」）</description>
            </item>
            <item id="4">
                <name>数字・漢数字の違い</name>
                <description>数字表記のルール：動詞名詞（動作や数量を伴う表現）は漢数字、それ以外はアラビア数字とする。このルールに従っていない箇所を指摘してください。（例：「一人」「二発」「三回」など動作・数量を伴う表現は漢数字が正しい。「3時」「10分」「5kg」など単なる数値・単位はアラビア数字が正しい。）</description>
            </item>
            <item id="5">
                <name>略称や別の表現</name>
                <description>同じ対象を指す言葉で、正式名称、略称、あるいは別の同義語が混在している箇所。（例: 「スマートフォン」と「スマホ」、「ホームページ」と「Webサイト」）</description>
            </item>
            <item id="6">
                <name>漢字の字体による違い</name>
                <description>同じ読み方で、異なる漢字が使われている箇所（異体字や、ニュアンスの違う同音異義語など）。（例: 「渡辺」と「渡邊」、「思う」と「想う」）</description>
            </item>
            <item id="7">
                <name>文体の違い</name>
                <description>ナレーションや特定のキャラクターのセリフ内で文体（丁寧語、常体、口語表現など）が不自然に混在している箇所。（例: 「私たち」と「我々」、「きちんと」と「ちゃんと」）</description>
            </item>
            <item id="8">
                <name>固有名詞・商標</name>
                <description>
                    セリフ内に実在する企業名・製品名・サービス名・店舗名・ブランド名が含まれている箇所。
                    知名度の高低にかかわらず、権利関係の確認が必要な可能性がある固有名詞をすべて検出する。
                    （例: 「LINEするね」→LINE、「ポカリ買ってくる」→ポカリ/ポカリスエット、「スタバ寄っていこう」→スタバ/スターバックス）
                </description>
                <detection_target>
                    <category>企業名（例: Google, ソニー, オリエンタルランド）</category>
                    <category>製品名・商品名（例: iPhone, ポカリスエット, うまい棒）</category>
                    <category>サービス名（例: LINE, YouTube, Instagram, Uber Eats）</category>
                    <category>店舗名・ブランド名（例: セブン-イレブン, ユニクロ, スターバックス）</category>
                </detection_target>
                <exclusion>
                    <item>地名（国、都市、地域、通り、ランドマーク等は対象外）</item>
                    <item>明らかなパロディ表現（WcDonald's、Somy等の意図的なもじりは対象外）</item>
                </exclusion>
                <note>固有名詞か判断に迷う場合は、安全のため検出対象に含めてください。</note>
            </item>
            <item id="9">
                <name>専門用語・事実の正確性</name>
                <description>
                    法律、医療、科学、警察、ビジネス等の専門分野において、用語の用法が不正確であったり、
                    実在の制度・法律・役職名・組織名・手続き等が現実と異なっている可能性がある箇所を検出する。
                </description>
                <detection_target>
                    <category>専門用語の誤用（例: 「心神耗弱」と「心神喪失」の取り違え、「判例」を個人の「前例」の意味で使用）</category>
                    <category>実在しない組織・役職名（例: 「保護観察局」→実在しない、正しくは「保護観察所」）</category>
                    <category>法的・制度的な不正確さ（例: 無罪判決者への「仮釈放」→仮釈放は有罪確定者が対象）</category>
                    <category>科学的・医学的な事実との矛盾（例: 明らかに不可能な症状や治療法の描写）</category>
                </detection_target>
                <exclusion>
                    <item>ファンタジーや超常現象など、作品世界の設定として意図的に現実と異なる描写</item>
                    <item>単純な誤字脱字（専門用語の誤用ではなく、一般的な変換ミス）</item>
                </exclusion>
                <note>専門用語や制度について少しでも正確性に疑問がある場合は、検出対象に含めてください。</note>
            </item>
            <item id="10">
                <name>未成年に関する表現チェック</name>
                <description>
                    未成年者が関わる犯罪行為や、未成年者への性的行為を明示的・暗示的に示唆する表現を検出する。
                    掲載基準やコンプライアンス上の問題となりうる箇所を事前に洗い出すためのチェック。
                </description>
                <detection_target>
                    <category>未成年であることを示す表現と性的行為の組み合わせ（例: 「高校生」「中学生」「○歳」等の年齢表記と性的描写が同一文脈に存在）</category>
                    <category>未成年者が加害者・被害者となる犯罪行為の明示的な描写（例: 未成年による暴力、窃盗、薬物使用等）</category>
                    <category>年齢を曖昧にしているが制服描写等から未成年と推定される状況での性的表現</category>
                    <category>児童・生徒を対象とした性的な言動や行為の描写</category>
                </detection_target>
                <keywords>
                    <word>小学生、中学生、高校生、○年生、○歳（18歳未満）</word>
                    <word>未成年、子供、少年、少女、児童、生徒</word>
                    <word>制服、ランドセル、学校</word>
                </keywords>
                <exclusion>
                    <item>年齢設定が18歳以上であることが明確に示されている場合</item>
                    <item>犯罪行為が作中で否定的に描かれ、教訓として機能している場合</item>
                    <item>過去の回想として言及されるだけで、直接的な描写がない場合</item>
                </exclusion>
                <note>少しでも問題となりうる可能性がある表現は、安全のため検出対象に含めてください。編集者による最終判断が必要な箇所として報告してください。</note>
            </item>
            <sub_numbering>
                <rule>同一チェック項目内に複数の異なる揺れグループが検出された場合、チェック項目名の末尾に①②③...のサブ番号を必ず付けてグループを区別してください。</rule>
                <example>「していただく/して頂く」と「嫌/いや/イヤ」は両方「1. 文字種による違い」だが、異なるグループなので「1. 文字種による違い①」「1. 文字種による違い②」と区別する。</example>
                <example>揺れグループが1つしかない場合でも「1. 文字種による違い①」のように①を付けてください。</example>
            </sub_numbering>
        </check_items>

        <report_format>
            <title>報告フォーマット</title>

            <section type="each_round">
                <title>1回目〜5回目の各チェック結果</title>
                <instruction>各回のチェック結果は、最終統合リストと同一の形式で報告してください。</instruction>
                <instruction id="1">1．最初に「## ○回目チェック結果」という見出しを記載してください。</instruction>
                <instruction id="2">2．<b>4列の単一テーブル</b>として出力してください。列は「<b>チェック項目</b>」「<b>該当箇所 (ページ)</b>」「<b>セリフの抜粋</b>」「<b>指摘内容</b>」の順です。</instruction>
                <instruction id="3">3．チェック項目列には「1. 文字種による違い①」「1. 文字種による違い②」のように番号付きで記載してください。<b>同一チェック項目内で異なる揺れグループ（例：「していただく/して頂く」と「嫌/いや/イヤ」）には、①②③...のサブ番号を付けて区別してください。</b></instruction>
                <instruction id="4">4．<b>表記の揺れが検出された場合、その単語・表現が使われているすべての箇所</b>（両方の表記のすべての出現）を個別の行として記載してください。原稿内でその表現が登場するすべてのページを網羅してください。</instruction>
                <instruction id="5">5．テーブル全体を<b>チェック項目番号順（1→10）</b>でソートし、同一チェック項目内では<b>同じ表記ゆれのグループ（例：『お前』『おまえ』『オマエ』は同一グループ）に同じサブ番号①②③を付けてグループ化</b>し、各グループ内では<b>ページ番号の昇順</b>でソートしてください。</instruction>
                <instruction id="6">6．該当する指摘がないチェック項目は<b>省略</b>してください（行を作成しない）。</instruction>
                <instruction id="7">7．その回で新たに見つかった指摘が1件もなかった場合は、見出しの後に「該当なし」と記載してください。</instruction>
                <example>
                    <title>各回チェック結果の出力例</title>
                    <code>
## 1回目チェック結果

| チェック項目 | 該当箇所 (ページ) | セリフの抜粋 | 指摘内容 |
|---|---|---|---|
| 1. 文字種による違い① | 3ページ | 「していただく」 | 「して頂く」（P5、P8）との混在があります。 |
| 1. 文字種による違い① | 5ページ | 「して頂く」 | 「していただく」（P3、P12）との混在があります。 |
| 1. 文字種による違い② | 7ページ | 「嫌」 | 「いや」（P3）「イヤ」（P10）との混在があります。 |
| 1. 文字種による違い② | 3ページ | 「いや」 | 「嫌」（P7）「イヤ」（P10）との混在があります。 |
| 1. 文字種による違い② | 10ページ | 「イヤ」 | 「嫌」（P7）「いや」（P3）との混在があります。 |
| 3. 外来語・アルファベット表記の違い① | 10ページ | 「サーバー」 | 「サーバ」（P15）との混在があります。 |
| 4. 数字・漢数字の違い① | 6ページ | 「3回」 | 「三回」（P18）との混在があります。 |
| 5. 略称や別の表現① | 4ページ | 「スマホ」 | 「スマートフォン」（P9）との混在があります。 |
| 9. 専門用語・事実の正確性① | 11ページ | 「保護観察局」 | 正しくは「保護観察所」です。 |
| 10. 未成年に関する表現チェック① | 14ページ | 「高校生の彼女と…」 | 「高校生」＋性的描写です。 |
                    </code>
                </example>
            </section>

            <section type="final_list">
                <title>最終統合リストのフォーマット</title>
                <instruction>5回分のチェック結果を統合した<b>最終統合リスト</b>は、以下の特別な形式で報告してください。</instruction>
                <instruction id="F1">1．最初に「## 最終統合リスト」という見出しを記載してください。</instruction>
                <instruction id="F2">2．<b>4列の単一テーブル</b>として出力してください。列は「<b>チェック項目</b>」「<b>該当箇所 (ページ)</b>」「<b>セリフの抜粋</b>」「<b>指摘内容</b>」の順です。</instruction>
                <instruction id="F3">3．チェック項目列には「1. 文字種による違い①」「1. 文字種による違い②」のように番号付きで記載してください。<b>同一チェック項目内で異なる揺れグループ（例：「していただく/して頂く」と「嫌/いや/イヤ」）には、①②③...のサブ番号を付けて区別してください。</b></instruction>
                <instruction id="F4">4．<b>表記の揺れが検出された場合、その単語・表現が使われているすべての箇所</b>（両方の表記のすべての出現）を個別の行として記載してください。原稿内でその表現が登場するすべてのページを網羅してください。</instruction>
                <instruction id="F5">5．テーブル全体を<b>チェック項目番号順（1→10）</b>でソートし、同一チェック項目内では<b>同じ表記ゆれのグループ（例：『お前』『おまえ』『オマエ』は同一グループ）に同じサブ番号①②③を付けてグループ化</b>し、各グループ内では<b>ページ番号の昇順</b>でソートしてください。</instruction>
                <instruction id="F6">6．該当する指摘がないチェック項目は<b>省略</b>してください（行を作成しない）。</instruction>
                <example>
                    <title>最終統合リストの出力例</title>
                    <code>
## 最終統合リスト

| チェック項目 | 該当箇所 (ページ) | セリフの抜粋 | 指摘内容 |
|---|---|---|---|
| 1. 文字種による違い① | 3ページ | 「していただく」 | 「して頂く」（P5、P8）との混在があります。 |
| 1. 文字種による違い① | 5ページ | 「して頂く」 | 「していただく」（P3、P12）との混在があります。 |
| 1. 文字種による違い② | 7ページ | 「嫌」 | 「いや」（P3）「イヤ」（P10）との混在があります。 |
| 1. 文字種による違い② | 3ページ | 「いや」 | 「嫌」（P7）「イヤ」（P10）との混在があります。 |
| 1. 文字種による違い② | 10ページ | 「イヤ」 | 「嫌」（P7）「いや」（P3）との混在があります。 |
| 2. 送り仮名の違い① | 8ページ | 「申込み」 | 「申し込み」（P12）との混在があります。 |
| 2. 送り仮名の違い① | 12ページ | 「申し込み」 | 「申込み」（P8）との混在があります。 |
| 4. 数字・漢数字の違い① | 6ページ | 「3回」 | 「三回」（P18）との混在があります。 |
| 4. 数字・漢数字の違い① | 18ページ | 「三回」 | 「3回」（P6）との混在があります。 |
| 5. 略称や別の表現① | 4ページ | 「スマホ」 | 「スマートフォン」（P9）との混在があります。 |
| 5. 略称や別の表現① | 9ページ | 「スマートフォン」 | 「スマホ」（P4）との混在があります。 |
| 6. 漢字の字体による違い① | 2ページ | 「渡辺」 | 「渡邊」（P13）との混在があります。 |
| 6. 漢字の字体による違い① | 13ページ | 「渡邊」 | 「渡辺」（P2）との混在があります。 |
| 7. 文体の違い① | 5ページ | 「我々」 | 「私たち」（P16）との混在があります。 |
| 7. 文体の違い① | 16ページ | 「私たち」 | 「我々」（P5）との混在があります。 |
| 8. 固有名詞・商標① | 15ページ | 「LINEするね」 | 【固有名詞】サービス名です。 |
| 9. 専門用語・事実の正確性① | 11ページ | 「保護観察局」 | 正しくは「保護観察所」です。 |
| 9. 専門用語・事実の正確性② | 20ページ | 「仮釈放された」 | 制度上の誤りの可能性あり。 |
| 10. 未成年に関する表現チェック① | 14ページ | 「高校生の彼女と…」 | 「高校生」＋性的描写です。 |
                    </code>
                </example>
            </section>

            <format_constraint type="critical">
                <rule>このプロンプトはXML形式で記述されていますが、あなたの出力にXMLタグを使用しないでください。</rule>
                <rule>必ずMarkdownテーブル形式で出力してください。</rule>
                <rule><b>【重要】最終統合リストを含むすべての報告において、検出された表記ゆれ・指摘事項のすべての出現箇所を省略せずに記載してください。</b>「〜など」「他多数」といった省略表現は使用せず、該当するすべてのページとセリフを1行ずつ漏れなくテーブルに記載してください。</rule>
            </format_constraint>
        </report_format>

        <self_check>
            <title>出力前の内部検証（必須）</title>
            <mode>この検証プロセスは内部で実行し、結果は出力しないでください。</mode>

            <validation_checklist>
                <item id="V1">
                    <question>すべてのチェック項目が見出し付きで、テーブル形式（3列）になっているか？</question>
                    <on_fail>チェック項目ごとに見出しとテーブル形式で修正する</on_fail>
                </item>
                <item id="V2">
                    <question>報告した指摘内容は、原稿内に複数の異なる表記が存在するか？（固有名詞は単独でも報告対象）</question>
                    <on_fail>単独表記のみの誤検出を除外する（固有名詞を除く）</on_fail>
                </item>
                <item id="V3">
                    <question>報告したページ番号とセリフ抜粋は原稿と一致しているか？</question>
                    <on_fail>原稿を再確認し修正する</on_fail>
                </item>
                <item id="V4">
                    <question>同じグループの指摘をすべて拾えているか？</question>
                    <on_fail>漏れている箇所を追加する</on_fail>
                </item>
                <item id="V5">
                    <question>チェック対象外（長音記号の種類等）を誤って報告していないか？</question>
                    <on_fail>対象外項目を除外する</on_fail>
                </item>
                <item id="V6">
                    <question>同一チェック項目内に複数の揺れグループがある場合、①②③のサブ番号で区別しているか？揺れグループが1つの場合でも①を付けているか？</question>
                    <on_fail>サブ番号を付与してグループを区別する（例：「1. 文字種による違い①」「1. 文字種による違い②」）</on_fail>
                </item>
            </validation_checklist>

            <execution>すべての項目がOKになるまで内部で修正を繰り返し、完成版のみを出力してください。</execution>
        </self_check>

        <output_rules>
            <rule>上記の自己点検（V1〜V5）の検証過程は出力しないでください。</rule>
            <rule>1回目〜5回目の各テーブルと最終統合リストは、必ず出力してください。</rule>
        </output_rules>
    </process_instruction>

    <manuscript_data>
        <title>校正対象セリフ原稿</title>
        <instruction>以下のテキストが校正対象の漫画セリフ原稿です。上記のルールに従ってチェックを実行してください。</instruction>
        <raw_text><![CDATA[
${manuscriptText}
]]></raw_text>
    </manuscript_data>
</prompt>`;
}


// ES Module exports
export { openVariationCheckModal, closeVariationCheckModal, loadVariationCheckTxt, renderVariationCheckFileList, removeVariationCheckTxt, updateVariationCheckSubmitBtn, copyVariationCheckAndOpenGemini, startVariationCheckFromLanding, generateVariationCheckPromptFromFiles, generateVariationCheckPromptWithText };

// Expose to window for inline HTML handlers
Object.assign(window, { openVariationCheckModal, closeVariationCheckModal, loadVariationCheckTxt, renderVariationCheckFileList, removeVariationCheckTxt, updateVariationCheckSubmitBtn, copyVariationCheckAndOpenGemini, startVariationCheckFromLanding, generateVariationCheckPromptFromFiles, generateVariationCheckPromptWithText });
