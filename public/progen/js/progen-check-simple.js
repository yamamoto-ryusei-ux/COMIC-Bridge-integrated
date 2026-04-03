/* =========================================
   簡易チェック機能（誤字・脱字・人名ルビのみ）
   ========================================= */
import { state } from './progen-state.js';
let simpleCheckTxtFiles = []; // 簡易チェック用のTXTファイル

// 簡易チェックモーダルを開く — COMIC-Bridge統合版: 親テキストを自動取得
function openSimpleCheckModal() {
    syncSimpleCheckFromBridge();
    renderSimpleCheckFileList();
    updateSimpleCheckSubmitBtn();
    document.getElementById('simpleCheckModal').style.display = 'flex';
}

// 簡易チェックモーダルを閉じる
function closeSimpleCheckModal() {
    document.getElementById('simpleCheckModal').style.display = 'none';
    simpleCheckTxtFiles = [];
}

// COMIC-Bridge統合版: 親からテキスト同期
function syncSimpleCheckFromBridge() {
    try {
        var bridge = window.parent && window.parent.__COMIC_BRIDGE__;
        if (!bridge) return;
        var content = bridge.getTextContent();
        var fileName = bridge.getTextFileName() || 'text.txt';
        if (content) {
            simpleCheckTxtFiles = [{ name: fileName, content: content, size: new Blob([content]).size }];
        } else {
            simpleCheckTxtFiles = [];
        }
    } catch (e) { /* cross-origin */ }
}

// 簡易チェック用TXTファイル読み込み（COMIC-Bridge統合版: 親から同期）
function loadSimpleCheckTxt(input) {
    syncSimpleCheckFromBridge();
    renderSimpleCheckFileList();
    updateSimpleCheckSubmitBtn();
}

// 簡易チェック用ファイルリスト描画
function renderSimpleCheckFileList() {
    const listEl = document.getElementById('simpleCheckFileList');
    const statusEl = document.getElementById('simpleCheckTxtStatus');

    if (simpleCheckTxtFiles.length === 0) {
        listEl.innerHTML = '<p style="color:#999; text-align:center; padding:15px;">ファイルが選択されていません</p>';
        statusEl.textContent = '';
        return;
    }

    let html = '';
    let totalSize = 0;
    simpleCheckTxtFiles.forEach((file, index) => {
        totalSize += file.size;
        const sizeStr = formatFileSize(file.size);
        html += `
            <div class="txt-file-item">
                <div class="txt-file-info">
                    <span class="txt-file-icon">📄</span>
                    <span class="txt-file-name">${escapeHtml(file.name)}</span>
                    <span class="txt-file-size">${sizeStr}</span>
                </div>
                <button class="txt-file-remove" onclick="removeSimpleCheckTxt(${index})">削除</button>
            </div>
        `;
    });
    listEl.innerHTML = html;
    statusEl.textContent = `${simpleCheckTxtFiles.length}ファイル選択済み`;
    statusEl.style.color = '#27ae60';
}

// 簡易チェック用ファイル削除
function removeSimpleCheckTxt(index) {
    if (index >= 0 && index < simpleCheckTxtFiles.length) {
        simpleCheckTxtFiles.splice(index, 1);
        renderSimpleCheckFileList();
        updateSimpleCheckSubmitBtn();
    }
}

// 送信ボタンの有効/無効を更新
function updateSimpleCheckSubmitBtn() {
    const btn = document.getElementById('simpleCheckSubmitBtn');
    btn.disabled = simpleCheckTxtFiles.length === 0;
}

// 簡易チェックプロンプトを生成してGeminiで開く
function copySimpleCheckAndOpenGemini() {
    if (simpleCheckTxtFiles.length === 0) {
        showToast('セリフTXTファイルを選択してください', 'warning');
        return;
    }

    const prompt = generateSimpleCheckPrompt();
    navigator.clipboard.writeText(prompt).then(() => {
        const msg = document.getElementById('copyMsg');
        msg.style.opacity = 1;
        setTimeout(() => { msg.style.opacity = 0; }, 2000);
        closeSimpleCheckModal();
        window.open('https://gemini.google.com/app', '_blank');
    });
}

// ランディング画面から簡易チェックを開始
function startSimpleCheckFromLanding(input) {
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
                // すべてのファイルが読み込まれたらプロンプトを生成
                const prompt = generateSimpleCheckPromptFromFiles(tempFiles);
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

// ファイル配列から簡易チェックプロンプトを生成
function generateSimpleCheckPromptFromFiles(files) {
    let manuscriptText = '';
    if (files.length === 1) {
        manuscriptText = files[0].content;
    } else {
        files.forEach((file, index) => {
            manuscriptText += `=== ${file.name} ===\n${file.content}\n\n`;
        });
    }

    return generateSimpleCheckPromptWithText(manuscriptText);
}

// テキストを受け取って簡易チェックプロンプトを生成
function generateSimpleCheckPromptWithText(manuscriptText) {
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
        <task>入力された漫画のセリフ原稿について、誤字・脱字・人名ルビのチェックを5回実行してください。</task>

        <execution_details>
            <iterations>5</iterations>
            <output_requirement>
                原稿全体に対して、指定された3つのチェック項目すべて（網羅的）の視点から、チェックを合計5回繰り返してください。
                この繰り返しは、チェック漏れを防ぐための「見直し」プロセスとして機能させます。

                <b>■ 各回の実行内容：</b>
                <ul>
                    <li><b>1回目：</b> 3項目すべて（網羅的）の視点で原稿をチェックし、見つかった候補を報告してください。</li>
                    <li><b>2回目〜5回目：</b> 再度、3項目すべて（網羅的）の視点で原稿をチェックし、<b>前回までのチェックで見落としていた箇所や、新たに見つかった候補のみ</b>を報告してください。</li>
                </ul>

                <b>■ 報告ルール：</b>
                <b>各回のチェックが完了するごとに、</b>その回で見つかった候補を、後述の「報告フォーマット」に従ったテーブル形式で出力してください。
                <b>（重要）1回目〜5回目の経過出力も、最終リストと同一のテーブル形式（「種別」「該当箇所 (ページ)」「セリフの抜粋」「指摘内容」の4列）で出力してください。</b>

                <b>（重要）その回の網羅的チェック（見直し）において、新たに見つかった項目が1件もなかった場合でも、作業を省略せず、必ず「該当なし」と明記した上で報告してください。</b>

                最後に、5回分のすべての結果を統合し、重複を除いた網羅的な「最終チェック結果リスト」を、同様のテーブル形式で報告してください。
            </output_requirement>
        </execution_details>

        <special_notes>
            <title>チェック時の特記事項</title>

            <rule type="paging">
                <description>原稿のページカウントに関するルール</description>
                <condition check="yes">原稿に明示的なページ番号（例: P1, P2）がない場合、テキストブロックの区切りとして使用されている「-」が10個（----------）をページの区切りと見なしてください。</condition>
                <condition check="yes">その場合、最初のテキストブロックを「1ページ目」、次の「----------」の後のブロックを「2ページ目」としてカウントし、「該当箇所 (ページ)」列に報告してください。</condition>
            </rule>
            <reporting_instruction>報告の際は、該当箇所とセリフの抜粋を分かりやすく提示してください。</reporting_instruction>
            <rule type="shiteki_format">
                <description>「指摘内容」列の記載フォーマット</description>
                <condition>「指摘内容」列は簡潔に記載してください。以下のフォーマットに従ってください。</condition>
                <format_by_category>
                    <category items="1" label="誤字（項目1）">
                        <format>正しくは「XXX」です。</format>
                    </category>
                    <category items="2" label="脱字（項目2）">
                        <format>「XXX」が脱落しています。</format>
                    </category>
                    <category items="3" label="人名のルビふり確認（項目3）">
                        <format>「XXX」のルビの確認が必要です。</format>
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
                <action>巻をまたいだチェックも実施してください。</action>
            </rule>
        </volume_format>

        <check_items>
            <title>チェック項目（3項目のみ）</title>
            <item id="1">
                <name>誤字</name>
                <description>漢字の変換ミスや、単純なタイプミスを検出します。（例：「行って」→「言って」）</description>
            </item>
            <item id="2">
                <name>脱字</name>
                <description>必要な文字が抜けている箇所を検出します。（例：「ことじないか」→「ことじゃないか」）</description>
            </item>
            <item id="3">
                <name>人名のルビふり確認</name>
                <description>漢字表記の人物名が初めて登場した箇所について、「ルビをふるかどうか」の確認を促す指摘を行います。同一の名前がページをまたいで複数出てきた場合は、最初に登場したページのみを該当箇所として指摘してください。</description>
                <exclusion>肩書・役職名（例：「社長」「先生」「部長」など）は人名に該当しないため、指摘対象から除外してください。また、ひらがな・カタカナのみで表記された人名も対象外とします。</exclusion>
            </item>
        </check_items>

        <report_format>
            <title>報告フォーマット</title>
            <instruction>
                <b>1回目から5回目までの各チェック結果</b>、および<b>最終的な統合リスト</b>は、それぞれ以下の形式で報告してください。
            </instruction>
            <instruction id="1">1．見つかった項目を、<b>カテゴリで分類せず、単一のテーブル（表）形式</b>で提示してください。</instruction>
            <instruction id="2">2．テーブルには「<b>種別</b>」「<b>該当箇所 (ページ)</b>」「<b>セリフの抜粋</b>」「<b>指摘内容</b>」の列を含めてください。</instruction>

            <format_constraint type="critical">
                <rule>このプロンプトはXML形式で記述されていますが、あなたの出力にXMLタグを使用しないでください。</rule>
                <rule>必ずMarkdownテーブル形式で出力してください。</rule>
            </format_constraint>
        </report_format>

        <self_check>
            <title>出力前の内部検証（必須）</title>
            <mode>この検証プロセスは内部で実行し、結果は出力しないでください。</mode>

            <validation_checklist>
                <item id="V1">
                    <question>すべての報告がテーブル形式（4列）になっているか？</question>
                    <on_fail>テーブル形式に修正する</on_fail>
                </item>
                <item id="V2">
                    <question>報告したページ番号とセリフ抜粋は原稿と一致しているか？</question>
                    <on_fail>原稿を再確認し修正する</on_fail>
                </item>
                <item id="V3">
                    <question>チェック対象外（肩書き等）を誤って報告していないか？</question>
                    <on_fail>対象外項目を除外する</on_fail>
                </item>
            </validation_checklist>

            <execution>すべての項目がOKになるまで内部で修正を繰り返し、完成版のみを出力してください。</execution>
        </self_check>

        <output_rules>
            <rule>上記の自己点検（V1〜V3）の検証過程は出力しないでください。</rule>
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

// 校正プロンプト用の常用外漢字チェック項目XMLを生成
function getNonJoyoCheckItemXml() {
    // 選択された項目のみを取得
    const selectedItems = getSelectedNonJoyoLines();
    if (!state.optionNonJoyoCheck || selectedItems.length === 0) {
        return '';
    }
    let xml = `
                <item id="8">
                    <name>常用外漢字チェック</name>
                    <description>以下の常用漢字表（2136字）に含まれない漢字を含む行が事前検出されました。</description>
                    <detected_lines>`;
    selectedItems.forEach(item => {
        xml += `
                        <line page="${escapeHtml(item.page)}" non_joyo="${item.nonJoyoChars.map(c => escapeHtml(c)).join(',')}">${escapeHtml(item.line)}</line>`;
    });
    xml += `
                    </detected_lines>
                    <instruction>
                        上の行を見て、常用外漢字を含む単語を見つけたら、ルビの要否を判断し、以下の形式で指摘してください。
                    </instruction>
                    <report_format>
                        1行につき1つの指摘を、以下の形式で記述してください。
                        「○○（読み）にルビを付けてください。」
                        例：「綺麗（きれい）にルビを付けてください。」「嗚咽（おえつ）にルビを付けてください。」
                        ひらがなに開くべき場合は「○○は『ひらがな表記』に開いてください。」としてください。
                        例：「溢れる は『あふれる』に開いてください。」
                        各指摘の前にページ番号を付けてください（例：3ページ：）。
                    </report_format>
                    <check_points>
                        <point>常用外漢字を含む単語を見つけてください</point>
                        <point>読者の年齢に合った表記かどうか確認してください</point>
                        <point>ルビで対応するか、ひらがなに開くか判断してください</point>
                    </check_points>
                </item>`;
    return xml;
}

// 簡易チェック + 統一表記ルール反映確認プロンプトを生成
function generateSimpleCheckWithRulesPromptWithText(manuscriptText) {
    // 現在のレーベルの統一表記ルールをXML形式で取得
    const rulesXml = generateUnificationRulesXmlForCheck();
    // 常用外漢字チェック項目（検出結果がある場合のみ）
    const nonJoyoCheckXml = getNonJoyoCheckItemXml();
    const hasNonJoyoCheck = nonJoyoCheckXml.length > 0;
    const checkItemCount = hasNonJoyoCheck ? 8 : 7;

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
        <task>入力された漫画のセリフ原稿について、誤字・脱字・人名ルビのチェック、および統一表記ルールの反映確認を5回実行してください。</task>

        <execution_details>
            <iterations>5</iterations>
            <output_requirement>
                原稿全体に対して、指定されたチェック項目すべて（網羅的）の視点から、チェックを合計5回繰り返してください。
                この繰り返しは、チェック漏れを防ぐための「見直し」プロセスとして機能させます。

                <b>■ 各回の実行内容：</b>
                <ul>
                    <li><b>1回目：</b> すべての項目（網羅的）の視点で原稿をチェックし、見つかった候補を報告してください。</li>
                    <li><b>2回目〜5回目：</b> 再度、すべての項目（網羅的）の視点で原稿をチェックし、<b>前回までのチェックで見落としていた箇所や、新たに見つかった候補のみ</b>を報告してください。</li>
                </ul>

                <b>■ 報告ルール：</b>
                <b>各回のチェックが完了するごとに、</b>その回で見つかった候補を、後述の「報告フォーマット」に従ったテーブル形式で出力してください。
                <b>（重要）1回目〜5回目の経過出力も、最終リストと同一のテーブル形式（「種別」「該当箇所 (ページ)」「セリフの抜粋」「指摘内容」の4列）で出力してください。</b>

                <b>（重要）その回の網羅的チェック（見直し）において、新たに見つかった項目が1件もなかった場合でも、作業を省略せず、必ず「該当なし」と明記した上で報告してください。</b>

                最後に、5回分のすべての結果を統合し、重複を除いた網羅的な「最終チェック結果リスト」を、同様のテーブル形式で報告してください。
            </output_requirement>
        </execution_details>

        <special_notes>
            <title>チェック時の特記事項</title>

            <rule type="paging">
                <description>原稿のページカウントに関するルール</description>
                <condition check="yes">原稿に明示的なページ番号（例: P1, P2）がない場合、テキストブロックの区切りとして使用されている「-」が10個（----------）をページの区切りと見なしてください。</condition>
                <condition check="yes">その場合、最初のテキストブロックを「1ページ目」、次の「----------」の後のブロックを「2ページ目」としてカウントし、「該当箇所 (ページ)」列に報告してください。</condition>
            </rule>
            <reporting_instruction>報告の際は、該当箇所とセリフの抜粋を分かりやすく提示してください。</reporting_instruction>
            <rule type="shiteki_format">
                <description>「指摘内容」列の記載フォーマット</description>
                <condition>「指摘内容」列は簡潔に記載してください。以下のフォーマットに従ってください。</condition>
                <format_by_category>
                    <category items="1" label="誤字">
                        <format>正しくは「XXX」です。</format>
                    </category>
                    <category items="2" label="脱字">
                        <format>「XXX」が脱落しています。</format>
                    </category>
                    <category items="3" label="人名ルビ">
                        <format>「XXX」のルビの確認が必要です。</format>
                    </category>
                    <category items="4" label="単位の誤り">
                        <format>正しくは「XXX」です。</format>
                    </category>
                    <category items="5" label="伏字チェック">
                        <format>「XXX」→「YYY」に伏字化してください。</format>
                    </category>
                    <category items="6" label="人物名誤記">
                        <format>正しくは「XXX」です。</format>
                    </category>
                    <category items="7" label="熟字訓">
                        <format>「XXX」のルビの確認が必要です。</format>
                    </category>
                    <category items="rules" label="ルール未反映">
                        <format>「XXX」→「YYY」が未反映です。</format>
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
                <action>巻をまたいだチェックも実施してください。</action>
            </rule>
        </volume_format>

        <check_items>
            <title>チェック項目</title>

            <section name="基本チェック（${checkItemCount}項目）">
                <item id="1">
                    <name>誤字</name>
                    <description>漢字の変換ミスや、単純なタイプミスを検出します。（例：「行って」→「言って」）</description>
                </item>
                <item id="2">
                    <name>脱字</name>
                    <description>必要な文字が抜けている箇所を検出します。（例：「ことじないか」→「ことじゃないか」）</description>
                </item>
                <item id="3">
                    <name>人名のルビふり確認</name>
                    <description>漢字表記の人物名が初めて登場した箇所について、「ルビをふるかどうか」の確認を促す指摘を行います。同一の名前がページをまたいで複数出てきた場合は、最初に登場したページのみを該当箇所として指摘してください。</description>
                    <exclusion>肩書・役職名（例：「社長」「先生」「部長」など）は人名に該当しないため、指摘対象から除外してください。また、ひらがな・カタカナのみで表記された人名も対象外とします。</exclusion>
                </item>
                <item id="4">
                    <name>単位の誤り</name>
                    <description>文脈上明らかに不自然な単位の使用を検出します。（例：「100m先の隣町」→距離感から「100km」が適切、「3秒で着く電車」→「3分」や「3時間」が適切など）</description>
                    <note>常識的な数値・単位の組み合わせから逸脱しているものを指摘してください。ファンタジーや超常現象を描いた文脈での意図的な誇張表現は除外してください。</note>
                </item>
                <item id="5">
                    <name>伏字チェック</name>
                    <description>以下のNGワード（伏字対象語）が原稿内に伏字化されずにそのまま残っていないかを確認します。伏字化されていない箇所があれば報告してください。</description>
                    <ng_word_list>
${getNgWordListXmlForCheck()}
                    </ng_word_list>
                    <note>伏字化されるべき単語が「〇」などで伏せられず、そのまま表記されている場合は「伏字未適用」として報告してください。</note>
                </item>
                <item id="6">
                    <name>人物名の誤記載・揺れチェック</name>
                    <description>以下に登録されている人物名について、原稿全体を通して表記が統一されているか、誤記載がないかを確認します。</description>
                    <registered_characters>
${getCharacterListXmlForCheck()}
                    </registered_characters>
                    <detection_target>
                        <case>登録名と異なる表記（例：「鈴木太郎」が登録されているのに「鈴木太朗」と誤記）</case>
                        <case>同一人物の表記揺れ（例：「山田」と「山田さん」が混在、フルネームと名前だけの混在）</case>
                        <case>類似した別の漢字への誤変換（例：「佐藤」→「佐籐」、「渡辺」→「渡邊」など意図しない異体字）</case>
                    </detection_target>
                    <note>登録されている人物名が正しい表記です。それと異なる表記が見つかった場合は「人物名誤記」として報告してください。</note>
                </item>
                <item id="7">
                    <name>熟字訓チェック</name>
                    <description>熟字訓（複数の漢字に特殊な読みを当てる語）を検出し、ルビを振るべきか確認します。</description>
                    <examples>
                        <example><word>海老</word><reading>えび</reading></example>
                        <example><word>時雨</word><reading>しぐれ</reading></example>
                        <example><word>紅葉</word><reading>もみじ</reading></example>
                        <example><word>田舎</word><reading>いなか</reading></example>
                        <example><word>土産</word><reading>みやげ</reading></example>
                        <example><word>相撲</word><reading>すもう</reading></example>
                        <example><word>五月雨</word><reading>さみだれ</reading></example>
                        <example><word>雪崩</word><reading>なだれ</reading></example>
                        <example><word>梅雨</word><reading>つゆ</reading></example>
                        <example><word>吹雪</word><reading>ふぶき</reading></example>
                    </examples>
                    <detection_target>
                        <case>一般的でない読み方を持つ熟字訓（読者が読めない可能性がある語）</case>
                        <case>初出の熟字訓でルビが付いていないもの</case>
                    </detection_target>
                    <exclusion>
                        <case>「今日」「明日」「昨日」「大人」「下手」「上手」など日常的に使用され誰でも読める語</case>
                        <case>既にルビが振られている語</case>
                    </exclusion>
                    <note>読者層（対象年齢）を考慮し、ルビを振るべきかどうかを判断してください。漫画の読者が小中学生の場合は基準を厳しく、成人向けの場合は緩めに判断してください。</note>
                </item>${nonJoyoCheckXml}
            </section>

            <section name="統一表記ルール反映確認">
                <description>
                    以下の統一表記ルールが原稿に正しく反映されているかを確認してください。
                    ルール通りになっていない箇所があれば、「ルール未反映」として報告してください。
                </description>
${rulesXml}
            </section>
        </check_items>

        <report_format>
            <title>報告フォーマット</title>
            <instruction>
                <b>1回目から5回目までの各チェック結果</b>、および<b>最終的な統合リスト</b>は、それぞれ以下の形式で報告してください。
            </instruction>
            <instruction id="1">1．見つかった項目を、<b>カテゴリごとに分けず、単一のテーブル（表）形式</b>で提示してください。</instruction>
            <instruction id="2">2．テーブルには「<b>ページ</b>」「<b>種別</b>」「<b>セリフの抜粋</b>」「<b>指摘内容</b>」の4列を含めてください。</instruction>
            <instruction id="3">3．<b>ページ番号の昇順</b>でソートして報告してください。同一ページ内では種別順で並べてください。</instruction>
            <instruction id="4">4．「種別」列には「誤字」「脱字」「人名ルビ」「熟字訓」${hasNonJoyoCheck ? '「常用外漢字」' : ''}「単位誤り」「伏字未適用」「人物名誤記」「ルール未反映」のいずれかを記載してください。</instruction>

            <format_constraint type="critical">
                <rule>このプロンプトはXML形式で記述されていますが、あなたの出力にXMLタグを使用しないでください。</rule>
                <rule>必ずMarkdownテーブル形式で出力してください。</rule>
            </format_constraint>
        </report_format>

        <self_check>
            <title>出力前の内部検証（必須）</title>
            <mode>この検証プロセスは内部で実行し、結果は出力しないでください。</mode>

            <validation_checklist>
                <item id="V1">
                    <question>すべての報告がテーブル形式（4列）になっているか？</question>
                    <on_fail>テーブル形式に修正する</on_fail>
                </item>
                <item id="V2">
                    <question>報告したページ番号とセリフ抜粋は原稿と一致しているか？</question>
                    <on_fail>原稿を再確認し修正する</on_fail>
                </item>
                <item id="V3">
                    <question>チェック対象外（肩書き等）を誤って報告していないか？</question>
                    <on_fail>対象外項目を除外する</on_fail>
                </item>
                <item id="V4">
                    <question>統一表記ルールに反している箇所を見落としていないか？</question>
                    <on_fail>原稿を再スキャンして追加する</on_fail>
                </item>
                <item id="V5">
                    <question>伏字化されるべきNGワードがそのまま残っていないか？</question>
                    <on_fail>NGワードリストと照合して追加する</on_fail>
                </item>
                <item id="V6">
                    <question>登録されている人物名と異なる表記が見落とされていないか？</question>
                    <on_fail>登録人物名リストと照合して追加する</on_fail>
                </item>
            </validation_checklist>

            <execution>すべての項目がOKになるまで内部で修正を繰り返し、完成版のみを出力してください。</execution>
        </self_check>

        <output_rules>
            <rule>上記の自己点検（V1〜V6）の検証過程は出力しないでください。</rule>
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

// 統一表記ルールをチェック用XMLとして生成
function generateUnificationRulesXmlForCheck() {
    let xml = '';

    // 記号ルール
    const activeSymbolRules = state.symbolRules.filter(r => r.active);
    if (activeSymbolRules.length > 0) {
        xml += `
                <rule_group name="記号・句読点置換ルール">
                    <instruction>以下の記号変換が正しく適用されているか確認してください。</instruction>`;
        activeSymbolRules.forEach(r => {
            xml += `
                    <rule><from>${escapeHtml(r.src)}</from><to>${escapeHtml(r.dst)}</to></rule>`;
        });
        xml += `
                    <punctuation_rules>
                        <rule>感嘆符・疑問符が連続する場合（!?、!!、??など）は半角</rule>
                        <rule>感嘆符・疑問符が単独の場合（！、？）は全角</rule>
                    </punctuation_rules>
                </rule_group>`;
    }

    // カテゴリ定義
    const categories = {
        'basic': { name: '基本的に表記変更', color: '🔴' },
        'recommended': { name: '表記が推奨', color: '🔵' },
        'auxiliary': { name: '補助動詞', color: '🟢' },
        'difficult': { name: '難読文字', color: '🟡' },
        'pronoun': { name: '人称', color: '🟣' },
        'character': { name: '人物名（ルビ用）', color: '👤' }
    };

    // 統一表記ルール
    Object.keys(categories).forEach(catKey => {
        const cat = categories[catKey];
        const rulesInCat = state.currentProofRules.filter(r => r.category === catKey && r.active);

        if (rulesInCat.length === 0) return;

        if (catKey === 'character') {
            // 人物名（ルビ用）は特別処理
            xml += `
                <rule_group name="${cat.name}">
                    <instruction>以下の人物名について、初出時にルビが付いているか確認してください。</instruction>`;
            rulesInCat.forEach(r => {
                xml += `
                    <rule><character>${escapeHtml(r.src)}</character><reading>${escapeHtml(r.dst)}</reading><format>${escapeHtml(r.src)}(${escapeHtml(r.dst)})</format></rule>`;
            });
        } else if (catKey === 'auxiliary') {
            xml += `
                <rule_group name="${cat.name}">
                    <instruction>補助動詞がひらがなで表記されているか確認してください。</instruction>
                    <general_rule>「〜てもらう」「〜てほしい」「〜ていく」「〜てくる」「〜ておく」「〜てみる」など</general_rule>`;
            rulesInCat.forEach(r => {
                xml += `
                    <rule><before>${escapeHtml(r.src)}</before><after>${escapeHtml(r.dst)}</after></rule>`;
            });
        } else if (catKey === 'difficult') {
            xml += `
                <rule_group name="${cat.name}">
                    <instruction>難読漢字がひらがなで表記されているか確認してください。</instruction>`;
            rulesInCat.forEach(r => {
                xml += `
                    <rule><before>${escapeHtml(r.src)}</before><after>${escapeHtml(r.dst)}</after></rule>`;
            });
        } else {
            xml += `
                <rule_group name="${cat.name}">
                    <instruction>以下のルールが正しく適用されているか確認してください。</instruction>`;
            rulesInCat.forEach(r => {
                if (r.note && r.note.trim() !== "") {
                    xml += `
                    <rule><before>${escapeHtml(r.src)}</before><after>${escapeHtml(r.dst)}</after><condition>${escapeHtml(r.note)}</condition></rule>`;
                } else {
                    xml += `
                    <rule><before>${escapeHtml(r.src)}</before><after>${escapeHtml(r.dst)}</after></rule>`;
                }
            });
        }
        xml += `
                </rule_group>`;
    });

    if (xml === '') {
        xml = `
                <note>統一表記ルールが設定されていません。</note>`;
    }

    return xml;
}

// 簡易チェックプロンプト生成（項目8〜10のみ）- モーダル用
function generateSimpleCheckPrompt() {
    // 共通関数を使用
    return generateSimpleCheckPromptFromFiles(simpleCheckTxtFiles);
}


// ES Module exports
export { openSimpleCheckModal, closeSimpleCheckModal, loadSimpleCheckTxt, renderSimpleCheckFileList, removeSimpleCheckTxt, updateSimpleCheckSubmitBtn, copySimpleCheckAndOpenGemini, startSimpleCheckFromLanding, generateSimpleCheckPromptFromFiles, generateSimpleCheckPromptWithText, getNonJoyoCheckItemXml, generateSimpleCheckWithRulesPromptWithText, generateUnificationRulesXmlForCheck, generateSimpleCheckPrompt };

// Expose to window for inline HTML handlers
Object.assign(window, { openSimpleCheckModal, closeSimpleCheckModal, loadSimpleCheckTxt, renderSimpleCheckFileList, removeSimpleCheckTxt, updateSimpleCheckSubmitBtn, copySimpleCheckAndOpenGemini, startSimpleCheckFromLanding, generateSimpleCheckPromptFromFiles, generateSimpleCheckPromptWithText, getNonJoyoCheckItemXml, generateSimpleCheckWithRulesPromptWithText, generateUnificationRulesXmlForCheck, generateSimpleCheckPrompt });
