/**
 * ProGen プロンプト生成ユーティリティ（旧プロンプト完全移植版）
 *
 * 元: progen-xml-templates.js + progen-xml-gen.js + progen-check-simple.js + progen-check-variation.js
 *
 * 4種類のプロンプト:
 * 1. 抽出 (Extraction) — PDFから抽出 → 校正 → COMIC-POT形式出力
 * 2. 整形 (Formatting) — テキストのみ → 整形 → 校正 → COMIC-POT形式出力
 * 3. 正誤チェック (Simple) — 誤字/脱字/人名ルビ + 統一表記反映確認 (7-8項目)
 * 4. 提案チェック (Variation) — 表記ゆれ・固有名詞・専門用語など (10項目)
 */

import type { ProofRule, SymbolRule, ProgenOptions, NumberRuleState, NonJoyoWord, TxtFile } from "./progen";

// ═══ ヘルパー ═══

function escapeHtml(str: string | number | null | undefined): string {
  // 旧版完全互換: falsy (null/undefined/0/""/false) を空文字列として扱う
  if (!str) return "";
  return String(str).replace(/[&<>"']/g, (m) => {
    const map: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;",
    };
    return map[m];
  });
}

// 旧API互換 (外部参照用)
export const escapeXml = escapeHtml;

// ═══ 数字サブルール定義（旧版 progen-data.js 完全互換） ═══

// ═══ 外部設定（NGワード / 数字ルール / カテゴリ）═══
//
// 共有ドライブ (G:\...\Pro-Gen\config.json) から読み込まれる動的データ。
// アプリ起動時に initProgenConfig() が同期し、更新があれば ここで参照される。
// 共有ドライブ到達不能時は progenConfig.ts の埋め込み既定値が使われる。
import { getProgenConfig } from "./progenConfig";

const numberSubRules = new Proxy({} as any, {
  get: (_t, prop) => (getProgenConfig().numberSubRules as any)[prop],
});

const ngWordList = new Proxy([] as any[], {
  get: (_t, prop) => {
    const arr = getProgenConfig().ngWordList;
    if (prop === "length") return arr.length;
    if (prop === "forEach" || prop === "map" || prop === "filter" || prop === "reduce") {
      return (arr as any)[prop].bind(arr);
    }
    // 数値インデックスアクセス対応
    const n = typeof prop === "string" ? Number(prop) : NaN;
    if (!Number.isNaN(n)) return arr[n];
    return (arr as any)[prop];
  },
});

// ═══ ProGen用の追加オプション型 ═══

export interface PromptExtras {
  /** 出力形式: 巻数 */
  outputFormatVolume?: number;
  /** 出力形式: 開始ページ */
  outputFormatStartPage?: number;
  /** 出力形式: 読み順 */
  outputFormatSortMode?: "bottomToTop" | "topToBottom";
  /** 検出された常用外漢字 (校正プロンプト用) */
  detectedNonJoyoWords?: NonJoyoWord[];
  /** 原稿テキストファイル群 (抽出/整形プロンプト用、複数対応) */
  manuscriptTxtFiles?: TxtFile[];
}

// ═══ ルール生成ヘルパー ═══

/** 記号置換ルールXML */
function getSymbolRulesXml(symbolRules: SymbolRule[]): string {
  let xml = "";
  symbolRules
    .filter((r) => r.active)
    .forEach((r) => {
      xml += `
                <rule><original>${escapeHtml(r.src)}</original><replacement>${escapeHtml(r.dst)}</replacement></rule>`;
    });
  // 感嘆符・疑問符の全角/半角ルールを追加
  xml += `
                <punctuation_rules>
                    <instruction>感嘆符・疑問符が連続する場合（!?、!!、??など）は半角で出力する</instruction>
                    <instruction>感嘆符・疑問符が単独の場合（！、？）は全角で出力する</instruction>
                    <example>単独：なに？　連続：なんだって!?</example>
                </punctuation_rules>`;
  return xml;
}

/** NGワード伏字XML */
function getNgWordMaskingXml(options: ProgenOptions): string {
  if (!options.ngWordMasking) return "";
  let xml = `
            <ng_word_replacement_rules name="NGワード置き換えルール">`;
  ngWordList.forEach((w) => {
    xml += `
                <rule><original>${w.original}</original><replacement>${w.replacement}</replacement></rule>`;
  });
  xml += `
            </ng_word_replacement_rules>`;
  return xml;
}

/** 句読点→スペースXML（旧プロンプト互換用、現在は未使用） */
// @ts-expect-error - 旧プロンプト互換のため保持
function getPunctuationToSpaceXml(options: ProgenOptions): string {
  if (!options.punctuationToSpace) return "";
  return `
            <punctuation_to_space_rules name="句読点を半角スペースに変換">
                <instruction>句読点（。、）は半角スペースに置換してください。</instruction>
                <rule><original>。</original><replacement> </replacement></rule>
                <rule><original>、</original><replacement> </replacement></rule>
            </punctuation_to_space_rules>`;
}

/** 正誤チェック用：NGワードリストXML */
function getNgWordListXmlForCheck(): string {
  let xml = "";
  ngWordList.forEach((w) => {
    xml += `                        <word><original>${w.original}</original><masked>${w.replacement}</masked></word>\n`;
  });
  return xml.trimEnd();
}

/** 正誤チェック用：登録人物名XML */
function getCharacterListXmlForCheck(proofRules: ProofRule[]): string {
  const characterRules = proofRules.filter((r) => r.category === "character");
  if (characterRules.length === 0) return "";
  let xml = "";
  characterRules.forEach((r) => {
    xml += `                        <character><name>${escapeHtml(r.before)}</name><reading>${escapeHtml(r.after)}</reading></character>\n`;
  });
  return xml.trimEnd();
}

// ═══ 校正ルール XML 生成（カテゴリ別、抽出/整形プロンプト用）═══

interface CategoryDef {
  name: string;
}

// categories は getProgenConfig() から動的取得（外部設定対応）
// Proxyで配列メソッドを一部サポートしているが、Object.keys() 等は直接オブジェクトに対して呼ぶ必要がある
function getCategories(): Record<string, CategoryDef> {
  return getProgenConfig().categories as Record<string, CategoryDef>;
}

function buildProofRulesXml(
  proofRules: ProofRule[],
  numberRules: NumberRuleState,
): string {
  let rulesXML = "";

  const categories = getCategories();
  Object.keys(categories).forEach((catKey) => {
    const cat = categories[catKey];
    const rulesInCat = proofRules.filter((r) => r.category === catKey && r.active);

    // 補助動詞カテゴリ
    if (catKey === "auxiliary") {
      if (rulesInCat.length === 0) return;
      rulesXML += `
            <group name="補助動詞のひらき">
                <instruction>補助動詞は基本的にひらがなで表記してください。</instruction>
                <instruction>補助動詞とは、本来の動詞としての意味が薄れ、他の動詞の後に付いて補助的な意味を添える動詞です。</instruction>
                <general_rule>「〜てもらう」「〜てほしい」「〜ていく」「〜てくる」「〜ておく」「〜てみる」「〜てあげる」「〜てくれる」など、動詞の連用形＋「て」の後に続く場合はひらがなにしてください。</general_rule>
                <examples description="以下は具体例です">`;
      rulesInCat.forEach((r) => {
        rulesXML += `
                    <example><before>${escapeHtml(r.before)}</before><after>${escapeHtml(r.after)}</after></example>`;
      });
      rulesXML += `
                </examples>
            </group>`;
      return;
    }

    // 数字カテゴリ
    if (catKey === "number") {
      const personOpt = numberSubRules.personCount.options[numberRules.personCount];
      const thingOpt = numberSubRules.thingCount.options[numberRules.thingCount];
      const monthOpt = numberSubRules.month.options[numberRules.month];
      let baseInstruction: string;
      if (numberRules.base === 1) {
        baseInstruction = "すべてアラビア数字で統一して表記してください。";
      } else if (numberRules.base === 2) {
        baseInstruction = "すべて漢数字で統一して表記してください。";
      } else {
        baseInstruction =
          "基本的にアラビア数字で表記してください。ただし、動詞・名詞として使われる場合は漢数字で表記してください。";
      }
      rulesXML += `
            <group name="数字の表記">
                <instruction>${escapeHtml(baseInstruction)}</instruction>`;
      if (numberRules.subRulesEnabled) {
        rulesXML += `
                <sub_rule name="人数の表記">
                    <format>${escapeHtml(personOpt)}</format>
                    <note>初出の表記に統一してください。</note>
                </sub_rule>
                <sub_rule name="戸数の表記">
                    <format>${escapeHtml(thingOpt)}</format>
                    <note>初出の表記に統一してください。</note>
                </sub_rule>
                <sub_rule name="月の表記">
                    <format>${escapeHtml(monthOpt)}</format>
                    <note>初出の表記に統一してください。</note>
                </sub_rule>`;
      }
      rulesXML += `
            </group>`;
      return;
    }

    // 難読漢字カテゴリ（旧版互換: modeがない場合はactiveから推定）
    if (catKey === "difficult") {
      const allDifficult = proofRules.filter((r) => r.category === "difficult");
      allDifficult.forEach((r) => {
        if (!r.mode) (r as any).mode = r.active ? "open" : "none";
      });
      const openRules = allDifficult.filter((r) => r.mode === "open");
      const rubyRules = allDifficult.filter((r) => r.mode === "ruby");

      if (openRules.length > 0) {
        rulesXML += `
            <group name="難読漢字のひらき">
                <instruction>難読漢字は基本的にひらがなで表記してください。</instruction>
                <instruction>一般的に読みにくい漢字、常用漢字表にない漢字、または読み方が特殊な漢字はひらがなに置き換えてください。</instruction>
                <general_rule>文脈から意味が通じやすく、読者がスムーズに読めるようひらがなを優先してください。</general_rule>
                <examples description="以下は具体例です">`;
        openRules.forEach((r) => {
          rulesXML += `
                    <example><before>${escapeHtml(r.before)}</before><after>${escapeHtml(r.after)}</after></example>`;
        });
        rulesXML += `
                </examples>
            </group>`;
      }

      if (rubyRules.length > 0) {
        rulesXML += `
            <group name="難読漢字（ルビ用）">
                <instruction>このグループのルールは置換ではなく、[親文字](ルビ) の形式で出力してください。</instruction>
                <instruction>ルビは各難読漢字の初出時のみ付けてください。2回目以降の出現時は親文字のみ（ルビなし）で出力してください。</instruction>
                <example>初出：[嗚咽](おえつ)　→　2回目以降：嗚咽</example>`;
        rubyRules.forEach((r) => {
          const safeSrc = escapeHtml(r.before);
          const safeDst = escapeHtml(r.after);
          rulesXML += `
                <rule type="ruby">
                    <kanji>${safeSrc}</kanji>
                    <reading>${safeDst}</reading>
                    <output_format>[${safeSrc}](${safeDst})</output_format>
                </rule>`;
        });
        rulesXML += `
            </group>`;
      }
      return;
    }

    // 人物名カテゴリ
    if (catKey === "character") {
      const allCharacters = proofRules.filter((r) => r.category === "character");
      const rubyCharacters = allCharacters.filter((r) => r.addRuby !== false);
      if (rubyCharacters.length === 0) return;

      rulesXML += `
            <group name="${cat.name}">
                <instruction>このグループのルールは置換ではなく、[親文字](ルビ) の形式で出力してください。</instruction>
                <instruction>ルビは各人物名の初出時のみ付けてください。2回目以降の出現時は親文字のみ（ルビなし）で出力してください。</instruction>
                <example>初出：[田中](たなか)　→　2回目以降：田中</example>`;
      rubyCharacters.forEach((r) => {
        const safeSrc = escapeHtml(r.before);
        const safeDst = escapeHtml(r.after);
        rulesXML += `
                <rule type="ruby">
                    <character>${safeSrc}</character>
                    <reading>${safeDst}</reading>
                    <output_format>[${safeSrc}](${safeDst})</output_format>
                </rule>`;
      });
      rulesXML += `
            </group>`;
      return;
    }

    if (rulesInCat.length === 0) return;

    rulesXML += `
            <group name="${cat.name}">`;
    rulesInCat.forEach((r) => {
      const safeSrc = escapeHtml(r.before);
      const safeDst = escapeHtml(r.after);
      const safeNote = escapeHtml(r.note);
      if (r.note && r.note.trim() !== "") {
        rulesXML += `
                <rule>
                    <before>${safeSrc}</before>
                    <after>${safeDst}</after>
                    <condition>${safeNote}</condition>
                </rule>`;
      } else {
        rulesXML += `
                <rule>
                    <before>${safeSrc}</before>
                    <after>${safeDst}</after>
                </rule>`;
      }
    });
    rulesXML += `
            </group>`;
  });

  return rulesXML;
}

// ═══ 出力フォーマット XML ═══

function getOutputFormatXml(extras: PromptExtras): string {
  const volume = extras.outputFormatVolume ?? 1;
  const startPage = extras.outputFormatStartPage ?? 1;
  const sortMode = extras.outputFormatSortMode ?? "bottomToTop";
  const vol = String(volume).padStart(2, "0");
  const p2 = startPage + 1;
  return `<output_format>
            <instruction>テキストは、ヘッダー部分に「Plaintext」と表示されるコードブロックに書き込む</instruction>
            <instruction>出力の先頭行に [COMIC-POT:${sortMode}] ヘッダーを記述する</instruction>
            <instruction>ヘッダーの次の行に [${vol}巻] のように巻番号マーカーを記述する（巻数=${volume}、2桁ゼロ埋め）</instruction>
            <instruction>各ページの先頭に &lt;&lt;${startPage}Page&gt;&gt;、&lt;&lt;${p2}Page&gt;&gt;… のように &lt;&lt;ページ番号Page&gt;&gt; 形式のページマーカーを付与する（開始ページ=${startPage}）</instruction>
            <instruction>ページ間に「----------」は使用せず、&lt;&lt;XPage&gt;&gt; マーカーをページ区切りとする</instruction>
            <instruction critical="true">【必須】吹き出し（フキダシ）ごとに1行の空白行を入れて区切る。これは絶対に守ること。</instruction>
            <instruction>出力するテキストには、ダブルクォーテーションや行番号など、余分な情報を追記しない</instruction>
            <instruction>ページに抽出対象となるテキストが一切存在しない場合は、次のページマーカーが直後に続くようにする</instruction>
        </output_format>
        <citation_marker_removal>
            <instruction>出力テキストから以下のシステムタグを完全に削除すること：</instruction>
            <target>[cite:...]、[cite_end]、[source:...]など、角括弧で囲まれた参照タグ</target>
            <target>脚注番号や参照元のファイル番号</target>
            <goal>人間が手書きで清書したかのような、システム的な注釈記号が一切ない純粋なテキストに仕上げる</goal>
        </citation_marker_removal>
        <example description="COMIC-POT形式の正しい出力例">
            <![CDATA[
[COMIC-POT:${sortMode}]
[${vol}巻]
<<${startPage}Page>>
気分は
どうですか
姐さん？

あんたっ
私にこんな事して
後でどうなるか
分かってるの!?

なによ その目…

<<${p2}Page>>
こんなのっ
あの人が知ったら
タダじゃ
済まないわよっ

あぁ もう
大丈夫だって

ほら
こっち向けよ

ちょっ

やめて…っ
            ]]>
        </example>`;
}

// ═══ 見直しチェックXML（抽出/整形プロンプト用） ═══

function getReviewCheckXml(
  options: ProgenOptions,
  detectedNonJoyoWords: NonJoyoWord[],
): string {
  let xml = "";
  const hasNonJoyoWords = options.nonJoyoCheck && detectedNonJoyoWords.length > 0;

  if (
    options.typoCheck ||
    options.missingCharCheck ||
    options.nameRubyCheck ||
    hasNonJoyoWords
  ) {
    xml += `
        <additional_review_checks name="追加見直しチェック">
            <instruction>以下の項目についても追加でチェックを行い、該当箇所があれば後述の報告フォーマットに従って報告してください。</instruction>

            <paging_rules name="ページカウントルール">
                <rule>テキストブロックの区切りとして使用されている「----------」（ハイフン10個）をページの区切りと見なしてください。</rule>
                <rule>最初のテキストブロックを「1ページ目」、次の「----------」の後のブロックを「2ページ目」としてカウントしてください。</rule>
                <rule>空ページ（テキストがなく「----------」が連続する箇所）も1ページとしてカウントしてください。</rule>
                <volume_format>原稿に「[XX巻]」形式の巻番号がある場合は、「8巻 3ページ」のように巻番号も含めて報告してください。</volume_format>
            </paging_rules>`;

    if (options.typoCheck) {
      xml += `
            <check_item name="誤字チェック">
                <description>漢字の変換ミス、タイプミスを検出します。</description>
                <examples>
                    <example>「行って」→「言って」（文脈に合わない漢字変換）</example>
                    <example>「意外」→「以外」（同音異義語の誤用）</example>
                </examples>
            </check_item>`;
    }
    if (options.missingCharCheck) {
      xml += `
            <check_item name="脱字チェック">
                <description>文字の抜け落ちを検出します。</description>
                <examples>
                    <example>「ことじないか」→「ことじゃないか」（「ゃ」の脱落）</example>
                    <example>「だいじぶ」→「だいじょうぶ」（「ょう」の脱落）</example>
                </examples>
            </check_item>`;
    }
    if (options.nameRubyCheck) {
      xml += `
            <check_item name="人名ルビふり確認">
                <description>漢字表記の人物名が初めて登場した箇所について、ルビをふるかどうかの確認を促します。</description>
                <exclusion>肩書・役職名（例：「社長」「先生」「部長」など）は人名に該当しないため、対象外です。</exclusion>
                <exclusion>ひらがな・カタカナのみで表記された人名も対象外とします。</exclusion>
                <note>同一の名前が複数出てきた場合は、最初に登場したページのみを報告してください。</note>
            </check_item>`;
    }
    if (hasNonJoyoWords) {
      xml += `
            <check_item name="常用外漢字チェック">
                <description>以下の常用漢字表（2136字）に含まれない漢字を含む単語が検出されました。ルビの要否や表記の適切性を確認してください。</description>
                <detected_words>`;
      detectedNonJoyoWords.forEach((item) => {
        const nonJoyoChars = (item as any).nonJoyoChars as string[] | undefined;
        const nonJoyoAttr = nonJoyoChars && nonJoyoChars.length > 0
          ? ` non_joyo="${nonJoyoChars.map((c) => escapeHtml(c)).join(",")}"`
          : "";
        xml += `
                    <word kanji="${escapeHtml(item.word)}"${nonJoyoAttr} />`;
      });
      xml += `
                </detected_words>
                <check_points>
                    <point>読み手の対象年齢に対して適切な表記か</point>
                    <point>ルビを振る必要があるか</point>
                    <point>ひらがなに開くべきか</point>
                </check_points>
            </check_item>`;
    }

    const checkTypes = ["誤字", "脱字", "人名ルビ"];
    if (hasNonJoyoWords) checkTypes.push("常用外漢字");

    let exampleRows = `| 誤字 | 3ページ目 | 「そんなこと言ってないよ」 | 「言って」→「行って」の可能性 |
| 脱字 | 5ページ目 | 「そうじないか？」 | 「じ」→「じゃ」の脱落 |
| 人名ルビ | 1ページ目 | 「田中さんが来た」 | 「田中」の初出：ルビ要否確認 |`;
    if (hasNonJoyoWords) {
      exampleRows += `
| 常用外漢字 | 2ページ目 | 「嗚咽を漏らす」 | 「嗚咽（おえつ）」にルビを付けてください |`;
    }

    xml += `
            <report_format name="報告フォーマット">
                <instruction>見直しチェックの結果は、以下のMarkdownテーブル形式で報告してください。</instruction>
                <columns>
                    <column name="チェック項目">${checkTypes.join("/")} のいずれか</column>
                    <column name="該当箇所">ページ番号（例：3ページ目、または 8巻 5ページ）</column>
                    <column name="セリフの抜粋">該当するセリフの一部を抜粋</column>
                    <column name="指摘内容">問題点と修正案（誤字・脱字の場合）、ルビ要否の確認（人名の場合）${hasNonJoyoWords ? "、「○○（読み）」にルビを付けてください の形式（常用外漢字の場合）" : ""}</column>
                </columns>
                <example><![CDATA[
| チェック項目 | 該当箇所 | セリフの抜粋 | 指摘内容 |
|------------|---------|------------|---------|
${exampleRows}
]]></example>
                <note>該当箇所がない場合は「該当なし」と報告してください。</note>
            </report_format>
        </additional_review_checks>`;
  }

  return xml;
}

// ═══ セリフTXTデータXML ═══

function getManuscriptTxtXml(manuscriptTxtFiles: TxtFile[]): string {
  if (!manuscriptTxtFiles || manuscriptTxtFiles.length === 0) return "";

  if (manuscriptTxtFiles.length === 1) {
    const file = manuscriptTxtFiles[0];
    const escapedText = file.content.replace(/]]>/g, "]]]]><![CDATA[>");
    return `
    <manuscript_text name="校正対象セリフデータ" source="${escapeHtml(file.name)}">
        <instruction>以下のテキストデータは校正対象となるセリフ原稿です。上記の校正ルールを適用して修正してください。</instruction>
        <raw_text><![CDATA[
${escapedText}
]]></raw_text>
    </manuscript_text>
`;
  } else {
    let xml = `
    <manuscript_texts name="校正対象セリフデータ" file_count="${manuscriptTxtFiles.length}">
        <instruction>以下のテキストデータは校正対象となるセリフ原稿です。複数ファイルが含まれています。各ファイルを順番に処理し、上記の校正ルールを適用して修正してください。</instruction>`;
    manuscriptTxtFiles.forEach((file, index) => {
      const escapedText = file.content.replace(/]]>/g, "]]]]><![CDATA[>");
      xml += `
        <file number="${index + 1}" source="${escapeHtml(file.name)}">
            <raw_text><![CDATA[
${escapedText}
]]></raw_text>
        </file>`;
    });
    xml += `
    </manuscript_texts>
`;
    return xml;
  }
}

// ═══ 自己点検 + final_output XML ═══

function getFinalOutputXml(
  options: ProgenOptions,
  extras: PromptExtras,
): string {
  const reviewCheckXml = getReviewCheckXml(options, extras.detectedNonJoyoWords ?? []);
  return `
    <step number="3" name="Self-Check">
        <task>
            出力前に以下の自己点検を実施し、不備があれば修正してから出力する。
        </task>
        <checklist>
            <item>指定されたフォーマット・条件に完全に適合しているか</item>
            <item>校正ルールが正しく適用されているか</item>
            <item>【重要】吹き出しごとに1行の空白行で区切られているか</item>
            <item>【重要】書き文字（擬音語・擬態語・オノマトペ）が含まれていないか</item>
            <item>抜け漏れや誤字がないか</item>
            <item>推測や補完で追加した情報がないか</item>
            <item>余計な説明文や前置きが混じっていないか</item>
        </checklist>
        <action>
            不備が見つかった場合は、修正後の完成版のみを出力する。
            チェック作業そのものは出力に含めない。
        </action>${reviewCheckXml}
    </step>

    <final_output>
        <task>
            ステップ3で点検・修正した校正済みのテキストを、以下の形式で出力してください。
        </task>
        ${getOutputFormatXml(extras)}
    </final_output>
</task_workflow>`;
}

// ═══ 抽出プロンプト (PDF only) ═══

export function generateExtractionPrompt(
  symbolRules: SymbolRule[] = [],
  proofRules: ProofRule[] = [],
  options: ProgenOptions = {} as ProgenOptions,
  numberRules: NumberRuleState = {} as NumberRuleState,
  extras: PromptExtras = {},
): string {
  const symbolRulesXml = getSymbolRulesXml(symbolRules);
  const ngWordMaskingXml = getNgWordMaskingXml(options);
  const rulesXML = buildProofRulesXml(proofRules, numberRules);
  const manuscriptTxtXml = getManuscriptTxtXml(extras.manuscriptTxtFiles ?? []);

  return `<?xml version="1.0" encoding="UTF-8"?>
<task_workflow>
    <trigger>
        <condition type="attachment">PDF</condition>
        <condition type="user_prompt">お願いします</condition>
        <action>添付されたPDFファイルに対して、以下のテキスト抽出および校正タスクを連続して実行します。</action>
    </trigger>

    <objective>
        漫画原稿のPDFからテキストを抽出し、指定された校正ルールに基づいて内容を書き換えた後、最終的な写植用テキストデータを出力する。
    </objective>

    <step number="1" name="Text Extraction">
        <role>あなたはエロ漫画の編集者です。</role>
        <task>
            漫画原稿の画像データから吹き出し内のセリフ、モノローグ、ナレーションを抽出し、一時的なテキストデータを生成します。
        </task>
        <extraction_rules>
            <basic_rules>
                <rule>吹き出しの中の文字だけ出力</rule>
            </basic_rules>
            <exclude_handwritten_sfx critical="true">
                <rule>【必須】書き文字（擬音語・擬態語・オノマトペ）は絶対に抽出しない</rule>
                <rule>吹き出しの外に描かれた効果音（ドキドキ、ゾクッ、ビクッ等）は出力禁止</rule>
                <rule>コマの背景や余白の手書き装飾文字は除外する</rule>
                <exclude_examples>ドキドキ、バクバク、ゾクッ、ビクッ、ハァハァ、ピチャ、ヌチュ、ズブッ等</exclude_examples>
            </exclude_handwritten_sfx>
            <extraction_completeness critical="true">
                <rule>【必須】吹き出し内のテキストは、記号を含めすべて漏れなく抽出すること。</rule>
                <rule>♡ ♪ … ！ ？ ～ などの記号も必ず出力に含める。省略しない。</rule>
                <rule>「っ…」「あ」「ん」など1〜2文字の短いセリフも必ず抽出する。</rule>
                <rule>吹き出し内に文字が存在する限り、どんなに短くても省略禁止。</rule>
                <important>文字数が少ない・記号だけのセリフでも、それは重要な台詞である。</important>
                <examples>
                    <must_extract>♡</must_extract>
                    <must_extract>っ…</must_extract>
                    <must_extract>あ</must_extract>
                    <must_extract>ん♡</must_extract>
                </examples>
            </extraction_completeness>
            <reading_order critical="true">
                <format>右とじ（日本の漫画標準形式）</format>
                <principle>右から左、上から下の順序で読む</principle>
                <panel_order>
                    <rule>ページ内のコマは「右上 → 左上 → 右下 → 左下」の順に処理する</rule>
                    <rule>同じ高さにあるコマは、右側のコマを先に処理する</rule>
                    <rule>段が変わったら（下に移動したら）、再び右側から処理する</rule>
                </panel_order>
                <balloon_order>
                    <rule>コマ内の吹き出しも「右上 → 左 → 下」の順に処理する</rule>
                    <rule>同じ高さにある吹き出しは、右側を先に出力する</rule>
                </balloon_order>
            </reading_order>
            <balloon_identification critical="true">
                <definition>「吹き出し」とは、輪郭線（枠線）で囲まれたひとつの閉じた領域のこと。</definition>
                <rule>同じ輪郭線の内側にあるテキストは、すべて「1つの吹き出し」として扱う。</rule>
                <rule>吹き出し内部での改行・行間・文字配置に関わらず、枠が同じなら同一の吹き出しである。</rule>
                <rule>輪郭線が別々であれば、たとえ近接していても「別の吹き出し」である。</rule>
                <caution>【注意】吹き出し内の改行位置で分割しないこと。枠線の境界のみが吹き出しの区切りである。</caution>
            </balloon_identification>
            <format_rules>
                <rule>画像データ内で改行されている位置で改行</rule>
                <rule critical="true">【必須】吹き出し（フキダシ）ごとに必ず1行の空白行を入れて区切る</rule>
            </format_rules>
            <symbol_replacement_rules>${symbolRulesXml}
            </symbol_replacement_rules>${ngWordMaskingXml}
        </extraction_rules>
    </step>

    <step number="2" name="Proofreading and Correction">
        <task>
            ステップ1で生成したテキスト全体に対し、以下の「proofreading_rules」を厳密に適用して、テキストを書き換えてください。
        </task>
        <proofreading_rules>
${rulesXML}
        </proofreading_rules>
    </step>
${manuscriptTxtXml}${getFinalOutputXml(options, extras)}`;
}

// ═══ 整形プロンプト (TXT only) ═══

export function generateFormattingPrompt(
  symbolRules: SymbolRule[] = [],
  proofRules: ProofRule[] = [],
  options: ProgenOptions = {} as ProgenOptions,
  numberRules: NumberRuleState = {} as NumberRuleState,
  extras: PromptExtras = {},
): string {
  const symbolRulesXml = getSymbolRulesXml(symbolRules);
  const ngWordMaskingXml = getNgWordMaskingXml(options);
  const rulesXML = buildProofRulesXml(proofRules, numberRules);
  const manuscriptTxtXml = getManuscriptTxtXml(extras.manuscriptTxtFiles ?? []);

  return `<?xml version="1.0" encoding="UTF-8"?>
<task_workflow>
    <trigger>
        <condition type="attachment">Text File</condition>
        <condition type="user_prompt">お願いします</condition>
        <action>添付されたテキストファイルに対して、整形および校正タスクを実行します。</action>
    </trigger>

    <objective>
        添付テキストに対し、「校正ルール」および「フォーマットルール」を適用して全面的に書き換え、写植用データを出力する。
    </objective>

    <step number="1" name="Text Formatting">
        <role>あなたはエロ漫画の編集者です。</role>
        <task>
            添付テキストの内容を読み込み、フォーマットを整えます。
        </task>
        <formatting_rules>
            <format_rules>
                <rule>テキストデータ内で改行されている位置で改行</rule>
                <rule critical="true">【必須】吹き出し（フキダシ）ごとに必ず1行の空白行を入れて区切る</rule>
            </format_rules>
            <symbol_replacement_rules>${symbolRulesXml}
            </symbol_replacement_rules>${ngWordMaskingXml}
        </formatting_rules>
    </step>

    <step number="2" name="Proofreading and Correction">
        <task>
            ステップ1で整形したテキスト全体に対し、以下の「proofreading_rules」を厳密に適用して、テキストを書き換えてください。
        </task>
        <proofreading_rules>
${rulesXML}
        </proofreading_rules>
    </step>
${manuscriptTxtXml}${getFinalOutputXml(options, extras)}`;
}

// ═══ 統一表記ルール（正誤チェック用） ═══

function generateUnificationRulesXmlForCheck(
  symbolRules: SymbolRule[],
  proofRules: ProofRule[],
): string {
  let xml = "";

  // 記号ルール
  const activeSymbolRules = symbolRules.filter((r) => r.active);
  if (activeSymbolRules.length > 0) {
    xml += `
                <rule_group name="記号・句読点置換ルール">
                    <instruction>以下の記号変換が正しく適用されているか確認してください。</instruction>`;
    activeSymbolRules.forEach((r) => {
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

  // カテゴリ別校正ルール
  const checkCategories: Record<string, { name: string }> = {
    basic: { name: "基本的に表記変更" },
    recommended: { name: "表記が推奨" },
    auxiliary: { name: "補助動詞" },
    difficult: { name: "難読文字" },
    pronoun: { name: "人称" },
    character: { name: "人物名（ルビ用）" },
  };

  Object.keys(checkCategories).forEach((catKey) => {
    const cat = checkCategories[catKey];
    const rulesInCat = proofRules.filter((r) => r.category === catKey && r.active);
    if (rulesInCat.length === 0) return;

    if (catKey === "character") {
      xml += `
                <rule_group name="${cat.name}">
                    <instruction>以下の人物名について、初出時にルビが付いているか確認してください。</instruction>`;
      rulesInCat.forEach((r) => {
        xml += `
                    <rule><character>${escapeHtml(r.before)}</character><reading>${escapeHtml(r.after)}</reading><format>${escapeHtml(r.before)}(${escapeHtml(r.after)})</format></rule>`;
      });
    } else if (catKey === "auxiliary") {
      xml += `
                <rule_group name="${cat.name}">
                    <instruction>補助動詞がひらがなで表記されているか確認してください。</instruction>
                    <general_rule>「〜てもらう」「〜てほしい」「〜ていく」「〜てくる」「〜ておく」「〜てみる」など</general_rule>`;
      rulesInCat.forEach((r) => {
        xml += `
                    <rule><before>${escapeHtml(r.before)}</before><after>${escapeHtml(r.after)}</after></rule>`;
      });
    } else if (catKey === "difficult") {
      xml += `
                <rule_group name="${cat.name}">
                    <instruction>難読漢字がひらがなで表記されているか確認してください。</instruction>`;
      rulesInCat.forEach((r) => {
        xml += `
                    <rule><before>${escapeHtml(r.before)}</before><after>${escapeHtml(r.after)}</after></rule>`;
      });
    } else {
      xml += `
                <rule_group name="${cat.name}">
                    <instruction>以下のルールが正しく適用されているか確認してください。</instruction>`;
      rulesInCat.forEach((r) => {
        if (r.note && r.note.trim() !== "") {
          xml += `
                    <rule><before>${escapeHtml(r.before)}</before><after>${escapeHtml(r.after)}</after><condition>${escapeHtml(r.note)}</condition></rule>`;
        } else {
          xml += `
                    <rule><before>${escapeHtml(r.before)}</before><after>${escapeHtml(r.after)}</after></rule>`;
        }
      });
    }
    xml += `
                </rule_group>`;
  });

  if (xml === "") {
    xml = `
                <note>統一表記ルールが設定されていません。</note>`;
  }
  return xml;
}

// ═══ 常用外漢字チェック項目XML（正誤チェック用） ═══

function getNonJoyoCheckItemXml(
  options: ProgenOptions,
  detectedNonJoyoWords: NonJoyoWord[],
): string {
  if (!options.nonJoyoCheck || detectedNonJoyoWords.length === 0) return "";
  let xml = `
                <item id="8">
                    <name>常用外漢字チェック</name>
                    <description>以下の常用漢字表（2136字）に含まれない漢字を含む行が事前検出されました。</description>
                    <detected_lines>`;
  detectedNonJoyoWords.forEach((item) => {
    const nonJoyoChars = (item as any).nonJoyoChars as string[] | undefined;
    const nonJoyoAttr = nonJoyoChars && nonJoyoChars.length > 0
      ? ` non_joyo="${nonJoyoChars.map((c) => escapeHtml(c)).join(",")}"`
      : "";
    xml += `
                        <line page="${escapeHtml(item.page)}"${nonJoyoAttr}>${escapeHtml(item.line)}</line>`;
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

// ═══ 正誤チェックプロンプト（フル版：7-8項目 + ルール反映確認） ═══

export function generateSimpleCheckPrompt(
  manuscriptText: string,
  symbolRules: SymbolRule[] = [],
  proofRules: ProofRule[] = [],
  options: ProgenOptions = {} as ProgenOptions,
  _numberRules: NumberRuleState = {} as NumberRuleState,
  extras: PromptExtras = {},
): string {
  const rulesXml = generateUnificationRulesXmlForCheck(symbolRules, proofRules);
  const nonJoyoCheckXml = getNonJoyoCheckItemXml(options, extras.detectedNonJoyoWords ?? []);
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
${getCharacterListXmlForCheck(proofRules)}
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
            <instruction id="4">4．「種別」列には「誤字」「脱字」「人名ルビ」「熟字訓」${hasNonJoyoCheck ? "「常用外漢字」" : ""}「単位誤り」「伏字未適用」「人物名誤記」「ルール未反映」のいずれかを記載してください。</instruction>

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

// ═══ 提案チェックプロンプト（10項目） ═══

export function generateVariationCheckPrompt(
  manuscriptText: string,
  _symbolRules: SymbolRule[] = [],
  _proofRules: ProofRule[] = [],
  _options: ProgenOptions = {} as ProgenOptions,
  _numberRules: NumberRuleState = {} as NumberRuleState,
  _extras: PromptExtras = {},
): string {
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
